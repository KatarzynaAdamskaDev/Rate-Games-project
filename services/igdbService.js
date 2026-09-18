
const axios = require('axios');

const IGDB_URL = 'https://api.igdb.com/v4/games';

async function fetchIGDBGames(query) {
  try {
    const response = await axios({
      url: IGDB_URL,
      method: 'POST',
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${process.env.IGDB_ACCESS_TOKEN}`,
        'Accept': 'application/json',
      },
      data: query,
    });
    return response.data;
  } catch (error) {
    console.error('Błąd pobierania danych z IGDB:', error.response ? error.response.data : error.message);
    return [];
  }
}

// Mapowanie danych z formatu IGDB do formatu używanego w Twojej aplikacji
function formatIGDBGame(game) {
  return {
    id: game.id,
    title: game.name,
    category: game.genres && game.genres.length > 0 ? game.genres[0].name : 'Inne',
    platform: game.platforms && game.platforms.length > 0 ? game.platforms[0].name : 'PC / Konsole',
    releaseYear: game.first_release_date 
      ? new Date(game.first_release_date * 1000).getFullYear() 
      : 'N/A',
    coverImage: game.cover && game.cover.url 
      ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}` 
      : '/images/game-placeholder.svg',
    description: game.summary || 'Brak opisu dla tej gry.',
  };
}

module.exports = {
  fetchIGDBGames,
  formatIGDBGame,
};