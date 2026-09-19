/**
 * Moderacja treści dodawanych przez użytkowników: antyspam i filtr wulgaryzmów.
 * Tryby (panel admina -> Ustawienia): wulgaryzmy wyłączone / zamaskowane gwiazdkami /
 * odrzucane z komunikatem. Nazwy użytkowników i grup są zawsze odrzucane, nie maskowane.
 */
const crypto = require('crypto');
const { getModeration } = require('./moderationSettings');

/* ------------------------------ wulgaryzmy ------------------------------ */

// Początki słów (po zamianie na małe litery bez polskich znaków). Dopasowanie dotyczy
// całych wyrazów, więc np. "kurwa" i "kurwy" wpadają, a "kurczak" nie.
const PROFANITY_PREFIXES = [
  // polskie
  'kurw', 'skurw', 'chuj', 'huj', 'pierdol', 'spierdal', 'zapierdal', 'wypierdal', 'odpierdal',
  'napierdal', 'rozpierdal', 'pizd', 'jebac', 'jebn', 'jebi', 'jebany', 'jebana', 'jebane',
  'zajeb', 'wyjeb', 'odjeb', 'pojeb', 'dojeb', 'rozjeb', 'ujeb', 'cwel', 'szmat',
  // angielskie
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'motherfuck', 'whore', 'slut', 'nigger', 'nigga',
  'faggot',
];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
const POLISH = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };

/** Normalizacja znak po znaku (długość tekstu się nie zmienia, więc pozycje pasują do oryginału). */
function normalizeChar(char) {
  const lower = char.toLowerCase();
  if (POLISH[lower]) return POLISH[lower];
  return LEET[lower] || lower;
}

function normalize(text) {
  return Array.from(String(text), normalizeChar).join('');
}

function extraPrefixes() {
  return getModeration()
    .profanityWords.split(/[\n,;]+/)
    .map((word) => normalize(word.trim()))
    .filter((word) => word.length >= 3);
}

/** Zwraca listę przedziałów [start, koniec) w tekście, które są wulgaryzmami. */
function findProfanity(text) {
  const source = String(text || '');
  const normalized = normalize(source);
  const prefixes = PROFANITY_PREFIXES.concat(extraPrefixes());
  const hits = [];
  const wordPattern = /[a-z0-9]+/g;
  let match;
  while ((match = wordPattern.exec(normalized)) !== null) {
    const word = match[0];
    if (prefixes.some((prefix) => word.startsWith(prefix))) {
      hits.push([match.index, match.index + word.length]);
    }
  }
  return hits;
}

function maskProfanity(text) {
  const source = String(text || '');
  const chars = Array.from(source);
  findProfanity(source).forEach(([start, end]) => {
    for (let i = start; i < end; i += 1) chars[i] = '*';
  });
  return chars.join('');
}

function hasProfanity(text) {
  return findProfanity(text).length > 0;
}

/* -------------------------------- antyspam -------------------------------- */

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const DUPLICATE_MIN_LENGTH = 15;
const recentTexts = new Map(); // userId -> [{ hash, at }]

function textHash(text) {
  return crypto
    .createHash('sha1')
    .update(String(text).toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex');
}

function detectSpam(text, userId, checkDuplicates) {
  const links = (text.match(/https?:\/\/|www\./gi) || []).length;
  if (links > 2) return 'Wiadomość zawiera zbyt wiele linków.';

  if (/(.)\1{11,}/u.test(text)) return 'Wiadomość zawiera za dużo powtarzających się znaków.';

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 8) {
    const counts = new Map();
    words.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
    if (Math.max(...counts.values()) > Math.ceil(words.length * 0.6)) {
      return 'Wiadomość wygląda na spam (ciągle to samo słowo).';
    }
  }

  const letters = text.replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '');
  const upper = letters.replace(/[^A-ZĄĆĘŁŃÓŚŹŻ]/g, '');
  if (letters.length >= 30 && upper.length / letters.length > 0.7) {
    return 'Wyłącz Caps Lock - wiadomość jest napisana samymi wielkimi literami.';
  }

  if (checkDuplicates && userId && text.length >= DUPLICATE_MIN_LENGTH) {
    const now = Date.now();
    const hash = textHash(text);
    const history = (recentTexts.get(userId) || []).filter((item) => now - item.at < DUPLICATE_WINDOW_MS);
    if (history.some((item) => item.hash === hash)) {
      recentTexts.set(userId, history);
      return 'Wysłano już identyczną treść przed chwilą.';
    }
    history.push({ hash, at: now });
    recentTexts.set(userId, history.slice(-20));
  }

  return null;
}

// Sprzątanie historii, żeby mapa nie rosła w nieskończoność.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  recentTexts.forEach((history, userId) => {
    const fresh = history.filter((item) => now - item.at < DUPLICATE_WINDOW_MS);
    if (fresh.length === 0) recentTexts.delete(userId);
    else recentTexts.set(userId, fresh);
  });
}, 5 * 60 * 1000);
cleanupTimer.unref();

/* --------------------------------- API --------------------------------- */

const PROFANITY_MESSAGE = 'Treść zawiera niedozwolone słownictwo. Popraw ją i spróbuj ponownie.';

/**
 * Sprawdza treść (recenzję, komentarz, wiadomość, opis).
 * @param {string} text
 * @param {{ userId?: string, duplicates?: boolean }} [options] duplicates: false przy edycji
 *   (ta sama treść z inną oceną nie jest spamem)
 * @returns {{ ok: boolean, text: string, error?: string, masked?: boolean }}
 */
function moderateText(text, { userId, duplicates = true } = {}) {
  const settings = getModeration();
  const value = String(text || '');

  if (settings.antispamEnabled) {
    const spam = detectSpam(value, userId, duplicates);
    if (spam) return { ok: false, text: value, error: spam };
  }

  if (settings.profanityMode !== 'off' && hasProfanity(value)) {
    if (settings.profanityMode === 'block') {
      return { ok: false, text: value, error: PROFANITY_MESSAGE };
    }
    return { ok: true, text: maskProfanity(value), masked: true };
  }

  return { ok: true, text: value };
}

/** Nazwy (użytkownika, grupy): wulgaryzm jest zawsze odrzucany, o ile filtr nie jest wyłączony. */
function moderateName(name) {
  if (getModeration().profanityMode !== 'off' && hasProfanity(name)) {
    return { ok: false, error: 'Ta nazwa zawiera niedozwolone słownictwo.' };
  }
  return { ok: true };
}

module.exports = { moderateText, moderateName, hasProfanity, maskProfanity };
