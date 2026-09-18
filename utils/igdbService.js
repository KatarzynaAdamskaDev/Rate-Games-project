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

async function fetchIGDBGames(query) {
  try {
    const token = await getAccessToken();

    const response = await axios({
      url: 'https://api.igdb.com/v4/games',
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
  fetchIGDBGames,
  formatIGDBGame,
  getPopularGames,
};