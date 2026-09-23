/**
 * Limity zapytań (ochrona przed brute-force, botami i zalewaniem serwisu treścią).
 * Licznik trzyma się w pamięci procesu - tak jak sesje - więc restart go zeruje.
 * Limity można wyłączyć w panelu admina (Ustawienia); administratorzy nie są limitowani
 * w akcjach po zalogowaniu, żeby nic nie blokowało moderacji.
 */
const { getModeration } = require('../utils/moderationSettings');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MAX_RECENT_BLOCKS = 20;

const rules = []; // rejestr reguł do podglądu w panelu admina
const stats = { blocked: 0, recent: [] };
const stores = new Set();

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function wantsJson(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

/** Adres, na który wracamy po odrzuceniu formularza (tylko w obrębie serwisu). */
function safeBackPath(req) {
  try {
    const url = new URL(req.get('Referer') || '', `http://${req.get('host')}`);
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch (err) {
    // niepoprawny nagłówek Referer
  }
  return '/';
}

function recordBlock(name, key) {
  stats.blocked += 1;
  stats.recent.unshift({ name, key: String(key).slice(0, 60), at: new Date() });
  if (stats.recent.length > MAX_RECENT_BLOCKS) stats.recent.length = MAX_RECENT_BLOCKS;
}

/**
 * @param {object} options
 * @param {string} options.name     krótka nazwa reguły (w dzienniku blokad)
 * @param {string} options.label    opis reguły dla administratora
 * @param {number} options.windowMs długość okna czasowego
 * @param {number} options.max      maksymalna liczba zapytań w oknie
 * @param {'ip'|'user'|Function} [options.key] czyj to licznik (domyślnie adres IP)
 * @param {string} [options.message] komunikat dla użytkownika
 */
function rateLimit({ name, label, windowMs, max, key = 'ip', message }) {
  const hits = new Map(); // klucz -> { count, resetAt }
  stores.add(hits);
  rules.push({ name, label: label || name, windowMs, max });

  const userMessage =
    message || 'Za dużo prób w krótkim czasie. Odczekaj chwilę i spróbuj ponownie.';

  return function rateLimitMiddleware(req, res, next) {
    if (!getModeration().rateLimitEnabled) return next();

    const sessionUser = req.session && req.session.user;
    if (sessionUser && sessionUser.role === 'admin') return next();

    let bucket;
    if (typeof key === 'function') bucket = key(req);
    else if (key === 'user') bucket = sessionUser ? `u:${sessionUser.id}` : `ip:${clientIp(req)}`;
    else bucket = `ip:${clientIp(req)}`;

    const now = Date.now();
    let entry = hits.get(bucket);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(bucket, entry);
    }
    entry.count += 1;

    if (entry.count <= max) return next();

    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    recordBlock(name, bucket);
    res.set('Retry-After', String(retryAfter));

    const waitText =
      retryAfter > 90 ? `${Math.ceil(retryAfter / 60)} min` : `${retryAfter} s`;
    const fullMessage = `${userMessage} (spróbuj za ${waitText})`;

    if (wantsJson(req)) {
      return res.status(429).json({ success: false, ok: false, error: fullMessage, message: fullMessage });
    }
    req.flash('error', fullMessage);
    return res.redirect(safeBackPath(req));
  };
}

// Sprzątanie wygasłych liczników, żeby mapy nie rosły w nieskończoność.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  stores.forEach((hits) => {
    hits.forEach((entry, bucket) => {
      if (entry.resetAt <= now) hits.delete(bucket);
    });
  });
}, MINUTE);
cleanupTimer.unref();

function getRules() {
  return rules.slice();
}

function getStats() {
  return { blocked: stats.blocked, recent: stats.recent.slice() };
}

/* ------------------------------ reguły serwisu ------------------------------ */

const limiters = {
  // Cała aplikacja: zapytania zmieniające dane (POST) z jednego adresu IP.
  writes: rateLimit({
    name: 'writes',
    label: 'Wszystkie formularze i akcje (POST) z jednego adresu IP',
    windowMs: MINUTE,
    max: 200,
  }),
  signin: rateLimit({
    name: 'signin',
    label: 'Logowanie - próby z jednego adresu IP',
    windowMs: 15 * MINUTE,
    max: 20,
    message: 'Zbyt wiele prób logowania.',
  }),
  signinAccount: rateLimit({
    name: 'signin-account',
    label: 'Logowanie - próby na jedno konto',
    windowMs: 15 * MINUTE,
    max: 7,
    key: (req) => `acc:${clientIp(req)}:${String((req.body && req.body.identifier) || '').toLowerCase().slice(0, 80)}`,
    message: 'Zbyt wiele prób logowania na to konto.',
  }),
  twoFactor: rateLimit({
    name: '2fa',
    label: 'Kod 2FA - próby z jednego adresu IP',
    windowMs: 10 * MINUTE,
    max: 8,
    message: 'Zbyt wiele prób wpisania kodu.',
  }),
  signup: rateLimit({
    name: 'signup',
    label: 'Rejestracja - nowe konta z jednego adresu IP',
    windowMs: HOUR,
    max: 6,
    message: 'Z tego adresu utworzono już zbyt wiele kont.',
  }),
  passwordReset: rateLimit({
    name: 'password-reset',
    label: 'Reset hasła - wysyłka wiadomości z jednego adresu IP',
    windowMs: HOUR,
    max: 6,
  }),
  review: rateLimit({
    name: 'review',
    label: 'Dodawanie i edycja recenzji - na użytkownika',
    windowMs: HOUR,
    max: 15,
    key: 'user',
    message: 'Dodajesz recenzje zbyt szybko.',
  }),
  comment: rateLimit({
    name: 'comment',
    label: 'Komentarze pod recenzjami i wpisami bloga - na użytkownika',
    windowMs: 5 * MINUTE,
    max: 15,
    key: 'user',
    message: 'Komentujesz zbyt szybko.',
  }),
  like: rateLimit({
    name: 'like',
    label: 'Polubienia - na użytkownika',
    windowMs: MINUTE,
    max: 60,
    key: 'user',
  }),
  chatMessage: rateLimit({
    name: 'chat',
    label: 'Wiadomości na czacie - na użytkownika',
    windowMs: MINUTE,
    max: 30,
    key: 'user',
    message: 'Piszesz zbyt szybko.',
  }),
  chatCreate: rateLimit({
    name: 'chat-create',
    label: 'Zakładanie rozmów i grup - na użytkownika',
    windowMs: 10 * MINUTE,
    max: 12,
    key: 'user',
  }),
  gifSearch: rateLimit({
    name: 'gif-search',
    label: 'Wyszukiwanie GIF-ów na czacie - na użytkownika',
    windowMs: MINUTE,
    max: 30,
    key: 'user',
  }),
  report: rateLimit({
    name: 'report',
    label: 'Zgłoszenia recenzji - na użytkownika',
    windowMs: HOUR,
    max: 10,
    key: 'user',
  }),
  upload: rateLimit({
    name: 'upload',
    label: 'Wgrywanie zdjęcia profilowego - na użytkownika',
    windowMs: HOUR,
    max: 10,
    key: 'user',
  }),
  follow: rateLimit({
    name: 'follow',
    label: 'Obserwowanie i przestawanie obserwowania - na użytkownika',
    windowMs: 10 * MINUTE,
    max: 60,
    key: 'user',
  }),
};

module.exports = { rateLimit, limiters, getRules, getStats };
