/**
 * Wyciszony użytkownik może czytać serwis, ale nie może niczego publikować:
 * recenzji, komentarzy ani wiadomości. Stan wyciszenia czytamy z bazy przy każdej
 * takiej akcji, więc zmiana z panelu admina działa od razu.
 */
const User = require('../models/User');
const { isMuted, isPermanentMute, formatUntil } = require('../utils/moderationStatus');

function wantsJson(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

function backPath(req) {
  try {
    const url = new URL(req.get('Referer') || '', `http://${req.get('host')}`);
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch (err) {
    // niepoprawny nagłówek Referer
  }
  return '/';
}

async function blockIfMuted(req, res, next) {
  try {
    if (!req.session || !req.session.user) return next();
    const user = await User.findByPk(req.session.user.id, { attributes: ['mutedUntil', 'muteReason'] });
    if (!isMuted(user)) return next();

    const until = isPermanentMute(user) ? 'bezterminowo' : `do ${formatUntil(user.mutedUntil)}`;
    const message = `Twoje konto jest wyciszone ${until} - nie możesz teraz nic publikować.${user.muteReason ? ` Powód: ${user.muteReason}` : ''}`;

    if (wantsJson(req)) {
      return res.status(403).json({ success: false, ok: false, error: message, message });
    }
    req.flash('error', message);
    return res.redirect(backPath(req));
  } catch (err) {
    return next(err);
  }
}

module.exports = { blockIfMuted };
