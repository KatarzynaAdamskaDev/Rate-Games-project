/**
 * Wymaga, aby użytkownik był zalogowany. W przeciwnym razie
 * przekierowuje na stronę logowania.
 */
function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Musisz się zalogować, aby zobaczyć tę stronę.');
  return res.redirect('/auth/signin');
}

/**
 * Wymaga, aby użytkownik NIE był zalogowany (np. formularze logowania).
 */
function ensureGuest(req, res, next) {
  if (!req.session || !req.session.user) return next();
  return res.redirect('/');
}

/**
 * Wymaga roli administratora (np. dodawanie gier / wpisów na blogu).
 */
function ensureAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  req.flash('error', 'Nie masz uprawnień do wykonania tej akcji.');
  return res.redirect('/');
}

module.exports = { ensureAuthenticated, ensureGuest, ensureAdmin };
