const { findById } = require('../utils/userHelpers');
const { getAnnouncement } = require('../utils/adminHelpers');
const { isBanActive, banMessage } = require('../utils/moderationStatus');

const SESSION_REFRESH_MS = 60 * 1000;

/**
 * Udostępnia w każdym widoku (res.locals):
 * - currentUser: dane zalogowanego użytkownika (lub null), wraz z avatarUrl i rolą
 * - announcement: ogłoszenie administratora wyświetlane na górze strony (lub null)
 * - messages: komunikaty flash (success/error)
 * - recaptchaSiteKey: klucz publiczny do formularzy z reCAPTCHA
 *
 * Dane zalogowanego użytkownika w sesji są odświeżane co minutę: zmiana roli lub awatara
 * jest widoczna bez ponownego logowania, a konto usunięte lub zablokowane przez
 * administratora traci sesję.
 */
async function exposeLocals(req, res, next) {
  try {
    const sessionUser = req.session.user;
    if (
      sessionUser &&
      (sessionUser.avatarUrl === undefined ||
        Date.now() - (sessionUser.checkedAt || 0) > SESSION_REFRESH_MS)
    ) {
      const fresh = await findById(sessionUser.id);
      if (!fresh) {
        delete req.session.user;
      } else if (isBanActive(fresh)) {
        delete req.session.user;
        req.flash('error', banMessage(fresh));
      } else {
        sessionUser.avatarUrl = fresh.avatarUrl || null;
        sessionUser.role = fresh.role;
        sessionUser.username = fresh.username;
        sessionUser.checkedAt = Date.now();
      }
    }

    res.locals.currentUser = req.session.user || null;
    // Niedokończone logowanie z 2FA: okno z kodem otwiera się samo (partials/two-factor-modal.ejs).
    const pending = req.session.pendingTwoFactor;
    res.locals.pendingTwoFactor = !!(pending && pending.expiresAt > Date.now() && !req.session.user);
    res.locals.announcement = await getAnnouncement();
    res.locals.recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || '';
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.currentPath = req.path;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = exposeLocals;
