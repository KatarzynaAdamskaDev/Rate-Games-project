const { getCategories } = require('../utils/gameHelpers');

/**
 * Udostępnia w każdym widoku (res.locals):
 * - currentUser: dane zalogowanego użytkownika (lub null)
 * - categories: lista kategorii gier (do menu / filtrów)
 * - messages: komunikaty flash (success/error)
 * - recaptchaSiteKey: klucz publiczny do formularzy z reCAPTCHA
 */
function exposeLocals(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.categories = getCategories();
  res.locals.recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || '';
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentPath = req.path;
  next();
}

module.exports = exposeLocals;
