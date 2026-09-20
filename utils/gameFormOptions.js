/**
 * Opcje formularza ręcznego dodawania gry (panel admina): platformy do zaznaczenia,
 * kategorie do wyboru, lata wydania i przetwarzanie pól formularza.
 */
const { getGenres } = require('./igdbService');

// Skróty w takiej postaci, w jakiej platformy pokazują się na kartach gier z IGDB.
const PLATFORM_CHOICES = [
  { value: 'PC', label: 'PC', icon: 'bi-pc-display' },
  { value: 'PS5', label: 'PlayStation 5', icon: 'bi-playstation' },
  { value: 'PS4', label: 'PlayStation 4', icon: 'bi-playstation' },
  { value: 'Xbox Series X|S', label: 'Xbox Series X|S', icon: 'bi-xbox' },
  { value: 'Xbox One', label: 'Xbox One', icon: 'bi-xbox' },
  { value: 'Switch', label: 'Nintendo Switch', icon: 'bi-nintendo-switch' },
  { value: 'Switch 2', label: 'Nintendo Switch 2', icon: 'bi-nintendo-switch' },
  { value: 'macOS', label: 'macOS', icon: 'bi-apple' },
  { value: 'Linux', label: 'Linux', icon: 'bi-ubuntu' },
  { value: 'Mobilne', label: 'Mobilne (Android / iOS)', icon: 'bi-phone' },
  { value: 'VR', label: 'VR', icon: 'bi-headset-vr' },
  { value: 'Przeglądarka', label: 'Przeglądarka', icon: 'bi-globe2' },
];

// Używane, gdy nie da się pobrać listy gatunków z IGDB (brak połączenia lub kluczy).
const FALLBACK_GENRES = [
  'Adventure', 'Arcade', 'Card & Board Game', 'Fighting', 'Hack and slash/Beat \'em up', 'Indie',
  'MOBA', 'Music', 'Pinball', 'Platform', 'Point-and-click', 'Puzzle', 'Quiz/Trivia', 'Racing',
  'Real Time Strategy (RTS)', 'Role-playing (RPG)', 'Shooter', 'Simulator', 'Sport', 'Strategy',
  'Tactical', 'Turn-based strategy (TBS)', 'Visual Novel',
];

const MIN_YEAR = 1970;

/** Lata do listy rozwijanej: od przyszłego roku wstecz do 1970. */
function yearOptions() {
  const newest = new Date().getFullYear() + 2;
  const years = [];
  for (let y = newest; y >= MIN_YEAR; y -= 1) years.push(y);
  return years;
}

async function genreOptions() {
  let names = [];
  try {
    names = (await getGenres()).map((genre) => genre.name);
  } catch (err) {
    names = [];
  }
  return names.length > 0 ? names : FALLBACK_GENRES;
}

/** Zaznaczone platformy z formularza -> lista dozwolonych wartości (bez duplikatów). */
function parsePlatforms(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const allowed = new Set(PLATFORM_CHOICES.map((p) => p.value));
  return [...new Set(list.map(String))].filter((v) => allowed.has(v));
}

/** Zapisany ciąg "PC, PS5" -> lista wartości do zaznaczenia w formularzu edycji. */
function splitStoredPlatforms(text) {
  return String(text || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

// Nazwy platform z IGDB -> wartości pól wyboru z formularza (kilka platform IGDB może dać jedną).
const IGDB_PLATFORM_MAP = new Map([
  ['PC (Microsoft Windows)', 'PC'],
  ['PlayStation 5', 'PS5'],
  ['PlayStation 4', 'PS4'],
  ['Xbox Series X|S', 'Xbox Series X|S'],
  ['Xbox One', 'Xbox One'],
  ['Nintendo Switch', 'Switch'],
  ['Nintendo Switch 2', 'Switch 2'],
  ['Mac', 'macOS'],
  ['Linux', 'Linux'],
  ['Android', 'Mobilne'],
  ['iOS', 'Mobilne'],
  ['Web browser', 'Przeglądarka'],
]);
const IGDB_VR_PATTERN = /\bVR\b|oculus|quest|vive|valve index|mixed reality/i;

/** Platformy gry z IGDB ({ name }) -> wartości pól wyboru, w kolejności z formularza. */
function mapIgdbPlatforms(platforms) {
  const found = new Set();
  (platforms || []).forEach((platform) => {
    const name = platform && platform.name;
    if (!name) return;
    if (IGDB_PLATFORM_MAP.has(name)) found.add(IGDB_PLATFORM_MAP.get(name));
    else if (IGDB_VR_PATTERN.test(name)) found.add('VR');
  });
  return PLATFORM_CHOICES.map((p) => p.value).filter((value) => found.has(value));
}

module.exports = {
  PLATFORM_CHOICES,
  MIN_YEAR,
  yearOptions,
  genreOptions,
  parsePlatforms,
  splitStoredPlatforms,
  mapIgdbPlatforms,
};
