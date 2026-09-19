const axios = require('axios');

let cachedToken = null;
let tokenExpirationTime = 0;

// Automatyczne pobieranie/odświeżanie tokena z Twitcha
async function getAccessToken() {
  const now = Date.now();
  // Jeśli token istnieje i nie wygaśnie w ciągu najbliższych 5 minut, użyj go ponownie
  if (cachedToken && now < tokenExpirationTime - 300000) {
    return cachedToken;
  }

  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials',
      },
    });

    cachedToken = response.data.access_token;
    // expires_in jest podawane w sekundach -> przeliczamy na ms
    tokenExpirationTime = now + response.data.expires_in * 1000;
    
    console.log('[IGDB] OK: pobrano nowy token dostępowy');
    return cachedToken;
  } catch (error) {
    console.error('[IGDB] BŁĄD: nie udało się wygenerować tokena Twitch:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Rodzaje wpisów IGDB, które pokazujemy jako gry: gra główna (0), samodzielny dodatek (4),
 * remake (8), remaster (9) i rozszerzona wersja (10). Pomijamy m.in. porty (11), DLC, mody,
 * pakiety i aktualizacje - mają własne, mylące daty wydania i platformy (np. "Minecraft" jako
 * port z 2016 r. na Amazon Fire TV zamiast gry z 2011 r.).
 */
const GAME_TYPE_FILTER = 'game_type = (0,4,8,9,10)';

/** Pola gry pobierane z IGDB przy listach i wyszukiwaniu. */
const IGDB_GAME_FIELDS =
  'fields name, cover.url, summary, genres.name, platforms.name, first_release_date, total_rating_count;';

/**
 * Platformy dostępne w filtrach (klucz -> etykieta i identyfikatory platform w IGDB).
 * Grupy (np. Xbox, VR) łączą kilka platform IGDB w jedną pozycję filtra.
 */
const PLATFORM_OPTIONS = [
  { key: 'pc', label: 'PC (Windows)', ids: [6] },
  { key: 'mac', label: 'macOS', ids: [14] },
  { key: 'linux', label: 'Linux', ids: [3] },
  { key: 'ps5', label: 'PlayStation 5', ids: [167] },
  { key: 'ps4', label: 'PlayStation 4', ids: [48] },
  { key: 'xbox', label: 'Xbox (Series X|S i One)', ids: [169, 49] },
  { key: 'switch', label: 'Nintendo Switch (1 i 2)', ids: [130, 508] },
  { key: 'mobile', label: 'Mobilne (Android i iOS)', ids: [34, 39] },
  { key: 'vr', label: 'VR', ids: [162, 163, 165, 384, 385, 386, 390, 471] },
  { key: 'web', label: 'Przeglądarka', ids: [82] },
];

/** Klucz platformy -> identyfikatory IGDB (do budowania zapytań). */
const PLATFORM_FILTERS = Object.fromEntries(PLATFORM_OPTIONS.map((p) => [p.key, p.ids]));

async function fetchIGDB(endpoint, query) {
  try {
    const token = await getAccessToken();

    const response = await axios({
      url: `https://api.igdb.com/v4/${endpoint}`,
      method: 'POST',
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      data: query,
    });

    return response.data || [];
  } catch (error) {
    console.error('[IGDB] BŁĄD: zapytanie do API nie powiodło się:', error.response ? error.response.data : error.message);
    return [];
  }
}

function fetchIGDBGames(query) {
  return fetchIGDB('games', query);
}

/* ----------------------- KATEGORIE (GATUNKI Z IGDB) ----------------------- */

const GENRES_TTL_MS = 12 * 60 * 60 * 1000;
const GENRES_RETRY_MS = 30 * 1000;
let genresCache = { list: [], fetchedAt: 0, lastAttempt: 0 };

/**
 * Zwraca listę gatunków ({ id, name, slug }) pobraną z IGDB - dokładnie tych,
 * które mają przypisane gry. Wynik jest cache'owany, a przy błędzie API
 * zwracana jest ostatnia znana lista.
 */
async function getGenres() {
  const now = Date.now();
  const fresh = genresCache.list.length && now - genresCache.fetchedAt < GENRES_TTL_MS;
  if (fresh || now - genresCache.lastAttempt < GENRES_RETRY_MS) return genresCache.list;

  genresCache.lastAttempt = now;
  const rows = await fetchIGDB('genres', 'fields name, slug; sort name asc; limit 100;');
  if (rows.length > 0) {
    genresCache = {
      list: rows.map(({ id, name, slug }) => ({ id, name, slug })),
      fetchedAt: now,
      lastAttempt: now,
    };
  }
  return genresCache.list;
}

/** Skrócone nazwy platform + kolejność wyświetlania (najważniejsze pierwsze). */
const PLATFORM_DISPLAY = [
  ['PC (Microsoft Windows)', 'PC'],
  ['PlayStation 5', 'PS5'],
  ['Xbox Series X|S', 'Xbox Series X|S'],
  ['Nintendo Switch 2', 'Switch 2'],
  ['Nintendo Switch', 'Switch'],
  ['PlayStation 4', 'PS4'],
  ['Xbox One', 'Xbox One'],
  ['Mac', 'macOS'],
  ['Linux', 'Linux'],
  ['Android', 'Android'],
  ['iOS', 'iOS'],
];
const PLATFORM_ORDER = new Map(PLATFORM_DISPLAY.map(([name], index) => [name, index]));
const PLATFORM_SHORT = new Map(PLATFORM_DISPLAY);

/**
 * IGDB zwraca platformy w przypadkowej kolejności (stąd np. "Amazon Fire TV" jako
 * pierwsza platforma Minecrafta), więc porządkujemy je: najważniejsze platformy
 * pierwsze, reszta alfabetycznie.
 * @returns {string[]} pełna lista skróconych nazw platform
 */
function orderedPlatformNames(platforms) {
  return (platforms || [])
    .map((p) => p.name)
    .filter(Boolean)
    .sort((a, b) => {
      const ia = PLATFORM_ORDER.has(a) ? PLATFORM_ORDER.get(a) : Infinity;
      const ib = PLATFORM_ORDER.has(b) ? PLATFORM_ORDER.get(b) : Infinity;
      return ia - ib || a.localeCompare(b);
    })
    .map((name) => PLATFORM_SHORT.get(name) || name);
}

/** Krótki opis platform do kart gier: pierwsze cztery i liczba pozostałych ("PC, PS5, Switch +6"). */
function summarizePlatforms(names, max = 4) {
  if (names.length === 0) return 'Brak danych';
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

function formatIGDBGame(game) {
  if (!game) return null;

  const platformNames = orderedPlatformNames(game.platforms);

  return {
    id: game.id,
    title: game.name || 'Bez tytułu',
    category: game.genres && game.genres.length > 0 ? game.genres[0].name : 'Inne',
    platform: summarizePlatforms(platformNames),
    platformsFull: platformNames,
    releaseYear: game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : 'Brak danych',
    coverImage: game.cover && game.cover.url 
      ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` 
      : '/images/game-placeholder.svg',
    description: game.summary || 'Brak opisu dla tej gry.',
  };
}

// Pobiera listę popularnych/wysoko ocenianych gier z IGDB
// i zwraca ją już sformatowaną (gotową do użycia w widokach)
const POPULAR_TTL_MS = 30 * 60 * 1000;
const popularCache = new Map(); // limit -> { games, at }

async function getPopularGames(limit = 6) {
  const cached = popularCache.get(limit);
  if (cached && Date.now() - cached.at < POPULAR_TTL_MS) return cached.games;

  const query = `
    fields name, genres.name, platforms.name, first_release_date, cover.url, summary;
    sort total_rating desc;
    where total_rating_count > 50 & ${GAME_TYPE_FILTER};
    limit ${limit};
  `;

  const games = (await fetchIGDBGames(query)).map(formatIGDBGame);
  if (games.length > 0) popularCache.set(limit, { games, at: Date.now() });
  return games;
}

module.exports = {
  GAME_TYPE_FILTER,
  IGDB_GAME_FIELDS,
  PLATFORM_OPTIONS,
  PLATFORM_FILTERS,
  fetchIGDB,
  fetchIGDBGames,
  formatIGDBGame,
  getGenres,
  getPopularGames,
};