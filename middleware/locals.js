const { findById } = require('../utils/userHelpers');

/**
 * Udostępnia w każdym widoku (res.locals):
 * - currentUser: dane zalogowanego użytkownika (lub null), wraz z avatarUrl
 * - messages: komunikaty flash (success/error)
 * - recaptchaSiteKey: klucz publiczny do formularzy z reCAPTCHA
 */
async function exposeLocals(req, res, next) {
  try {
    // Sesje utworzone przed dodaniem avatarUrl doczytują je jednorazowo z bazy.
    // Jeśli konto już nie istnieje (np. zostało usunięte), użytkownik jest wylogowywany.
    if (req.session.user && req.session.user.avatarUrl === undefined) {
      const fresh = await findById(req.session.user.id);
      if (fresh) {
        req.session.user.avatarUrl = fresh.avatarUrl || null;
      } else {
        delete req.session.user;
      }
    }

    res.locals.currentUser = req.session.user || null;
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
