/**
 * Wymaga, aby użytkownik był zalogowany. W przeciwnym razie
 * przekierowuje na stronę główną z komunikatem (wyświetlanym jako toast).
 */
function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash(
    'error',
    'Sesja wygasła lub nie jesteś zalogowany. Zaloguj się ponownie, aby kontynuować.'
  );
  return res.redirect('/');
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