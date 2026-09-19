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
    
    console.log('✅ Pobrano nowy token dostępowy IGDB');
    return cachedToken;
  } catch (error) {
    console.error('❌ Błąd podczas generowania tokena Twitch:', error.response?.data || error.message);
    throw error;
  }
}

/** Pola gry pobierane z IGDB przy listach i wyszukiwaniu. */
const IGDB_GAME_FIELDS =
  'fields name, cover.url, summary, genres.name, platforms.name, first_release_date, total_rating_count;';

/** Filtry platform w widoku kategorii -> identyfikatory platform w IGDB. */
const PLATFORM_FILTERS = {
  pc: [6],
  ps5: [167],
  xbox: [169, 49],
  switch: [130],
  konsole: [167, 48, 169, 49, 130],
  android: [34],
  ios: [39],
  mobile: [34, 39],
  vr: [162, 163, 165, 384, 385, 386, 390, 471],
};

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
    console.error('❌ Błąd API IGDB:', error.response ? error.response.data : error.message);
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

function formatIGDBGame(game) {
  if (!game) return null;

  return {
    id: game.id,
    title: game.name || 'Bez tytułu',
    category: game.genres && game.genres.length > 0 ? game.genres[0].name : 'Inne',
    platform: game.platforms && game.platforms.length > 0 ? game.platforms[0].name : 'PC / Konsole',
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
async function getPopularGames(limit = 6) {
  const query = `
    fields name, genres.name, platforms.name, first_release_date, cover.url, summary;
    sort total_rating desc;
    where total_rating_count > 50;
    limit ${limit};
  `;

  const games = await fetchIGDBGames(query);
  return games.map(formatIGDBGame);
}

module.exports = {
  IGDB_GAME_FIELDS,
  PLATFORM_FILTERS,
  fetchIGDB,
  fetchIGDBGames,
  formatIGDBGame,
  getGenres,
  getPopularGames,
};