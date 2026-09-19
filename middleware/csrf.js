/**
 * Ochrona przed CSRF (podszywaniem się pod zalogowanego użytkownika przez obcą stronę).
 *
 * Każda sesja ma losowy token. Wszystkie żądania zmieniające dane (POST, PUT, PATCH, DELETE)
 * muszą go przysłać: w polu formularza "_csrf" albo w nagłówku "X-CSRF-Token".
 * Token trafia do stron na dwa sposoby, więc szablony nie wymagają ręcznych zmian:
 *  - do każdego <form method="POST"> serwer dokleja ukryte pole _csrf (patrz injectToken),
 *  - meta tag "csrf-token" w <head> i skrypt, który dodaje nagłówek do żądań fetch.
 * Formularze multipart (wgrywanie plików) sprawdzają token dopiero po odczytaniu pól -
 * pole _csrf jest w formularzu pierwsze, więc niepoprawne żądanie nie zapisuje pliku.
 */
const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FORM_TAG = /<form\b[^>]*\bmethod\s*=\s*["']?post["']?[^>]*>/gi;
const MESSAGE = 'Formularz wygasł lub jest nieprawidłowy. Odśwież stronę i spróbuj ponownie.';

function ensureToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function tokensMatch(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isValid(req) {
  const given = (req.body && req.body._csrf) || req.get('x-csrf-token');
  return tokensMatch(given, req.session && req.session.csrfToken);
}

function wantsJson(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

/** Wraca na stronę, z której przyszło żądanie (tylko w obrębie serwisu). */
function backPath(req) {
  try {
    const url = new URL(req.get('Referer') || '', `http://${req.get('host')}`);
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch (err) {
    // niepoprawny nagłówek Referer
  }
  return '/';
}

function reject(req, res) {
  console.warn(`[csrf] odrzucono ${req.method} ${req.originalUrl}`);
  if (wantsJson(req)) {
    return res.status(403).json({ success: false, ok: false, error: MESSAGE, message: MESSAGE });
  }
  req.flash('error', MESSAGE);
  return res.redirect(backPath(req));
}

/** Dokleja ukryte pole z tokenem do każdego formularza POST w wyrenderowanej stronie. */
function injectToken(html, token) {
  const field = `<input type="hidden" name="_csrf" value="${token}">`;
  return html.replace(FORM_TAG, (tag) => tag + field);
}

function csrfProtection(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  const originalRender = res.render.bind(res);
  res.render = function render(view, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    }
    originalRender(view, options, (err, html) => {
      if (callback) return callback(err, err ? html : injectToken(html, token));
      if (err) return next(err);
      return res.send(injectToken(html, token));
    });
  };

  if (SAFE_METHODS.has(req.method)) return next();
  // Formularze multipart są sprawdzane po odczytaniu pól (verifyAfterUpload / checkUploadField).
  if (req.is('multipart/form-data')) return next();
  if (isValid(req)) return next();
  return reject(req, res);
}

/** Dla tras z wgrywaniem plików: sprawdza token po przetworzeniu formularza przez multera. */
function verifyAfterUpload(req, res, next) {
  if (isValid(req)) return next();
  if (req.file && req.file.path) require('fs').unlink(req.file.path, () => {});
  return reject(req, res);
}

/** Do fileFilter multera: nie zapisujemy pliku, jeśli pole _csrf (wysłane przed plikiem) jest złe. */
function checkUploadToken(req) {
  return tokensMatch(req.body && req.body._csrf, req.session && req.session.csrfToken);
}

module.exports = { csrfProtection, verifyAfterUpload, checkUploadToken, reject, isValid };
