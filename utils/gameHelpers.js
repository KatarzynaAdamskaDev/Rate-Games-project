const { readCollection } = require('./dataStore');

function getAllGames() {
  return readCollection('games');
}

function getGameById(id) {
  return getAllGames().find((g) => g.id === id) || null;
}

function getReviewsForGame(gameId) {
  return readCollection('reviews')
    .filter((r) => r.gameId === gameId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getAverageRating(gameId) {
  const reviews = getReviewsForGame(gameId);
  if (reviews.length === 0) return null;
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

function getCategories() {
  const games = getAllGames();
  return [...new Set(games.map((g) => g.category))].sort();
}

/** Dołącza do każdej gry średnią ocenę i liczbę recenzji. */
function withRatings(games) {
  return games.map((g) => ({
    ...g,
    averageRating: getAverageRating(g.id),
    reviewCount: getReviewsForGame(g.id).length,
  }));
}

module.exports = {
  getAllGames,
  getGameById,
  getReviewsForGame,
  getAverageRating,
  getCategories,
  withRatings,
};
