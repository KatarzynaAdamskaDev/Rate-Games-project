/**
 * Ustawienia moderacji i bezpieczeństwa edytowane w panelu admina (Ustawienia):
 * limity zapytań, antyspam, filtr wulgaryzmów i wymóg 2FA dla administratorów.
 *
 * Middleware i filtry potrzebują wartości synchronicznie, więc trzymamy je w pamięci
 * i odświeżamy z bazy przy starcie, po zapisie w panelu oraz co minutę (gdyby aplikacja
 * działała na kilku instancjach).
 */
const { getSetting, setSetting } = require('./adminHelpers');

const REFRESH_MS = 60 * 1000;
const PROFANITY_MODES = ['off', 'mask', 'block'];
const MAX_EXTRA_WORDS_LENGTH = 1500;

const DEFAULTS = {
  rateLimitEnabled: true,
  antispamEnabled: true,
  profanityMode: 'mask',
  profanityWords: '',
  require2fa: false,
};

let state = { ...DEFAULTS };
let refreshTimer = null;

async function loadModerationSettings() {
  const [rateLimit, antispam, mode, words, require2fa] = await Promise.all([
    getSetting('rate_limit_enabled', '1'),
    getSetting('antispam_enabled', '1'),
    getSetting('profanity_mode', DEFAULTS.profanityMode),
    getSetting('profanity_words', ''),
    getSetting('require_admin_2fa', '0'),
  ]);

  state = {
    rateLimitEnabled: rateLimit === '1',
    antispamEnabled: antispam === '1',
    profanityMode: PROFANITY_MODES.includes(mode) ? mode : DEFAULTS.profanityMode,
    profanityWords: words || '',
    require2fa: require2fa === '1',
  };
  return state;
}

/** Wczytuje ustawienia i odświeża je w tle. Wywoływane raz przy starcie serwera. */
async function startModerationSettings() {
  await loadModerationSettings();
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      loadModerationSettings().catch(() => {});
    }, REFRESH_MS);
    refreshTimer.unref();
  }
}

function getModeration() {
  return state;
}

/** Zapisuje wybrane ustawienia (tylko znane klucze) i od razu aktualizuje pamięć podręczną. */
async function saveModeration(patch) {
  const writes = [];
  if (typeof patch.rateLimitEnabled === 'boolean') {
    writes.push(setSetting('rate_limit_enabled', patch.rateLimitEnabled ? '1' : '0'));
  }
  if (typeof patch.antispamEnabled === 'boolean') {
    writes.push(setSetting('antispam_enabled', patch.antispamEnabled ? '1' : '0'));
  }
  if (PROFANITY_MODES.includes(patch.profanityMode)) {
    writes.push(setSetting('profanity_mode', patch.profanityMode));
  }
  if (typeof patch.profanityWords === 'string') {
    writes.push(setSetting('profanity_words', patch.profanityWords.slice(0, MAX_EXTRA_WORDS_LENGTH)));
  }
  if (typeof patch.require2fa === 'boolean') {
    writes.push(setSetting('require_admin_2fa', patch.require2fa ? '1' : '0'));
  }
  await Promise.all(writes);
  return loadModerationSettings();
}

module.exports = {
  PROFANITY_MODES,
  MAX_EXTRA_WORDS_LENGTH,
  startModerationSettings,
  getModeration,
  saveModeration,
};
