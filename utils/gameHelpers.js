const { readCollection } = require('./dataStore');
const Review = require('../models/Review');

function getAllGames() {
  return readCollection('games');
}

function getGameById(id) {
  return getAllGames().find((g) => g.id === id) || null;
}

async function getReviewsForGame(gameId) {
  return await Review.findAll({
    where: { gameId: String(gameId) }
  });
}

async function getAverageRating(gameId) {
  const reviews = await getReviewsForGame(gameId);
  if (reviews.length === 0) return null;
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

function getCategories() {
  const games = getAllGames();
  return [...new Set(games.map((g) => g.category))].sort();
}

/** Dołącza do każdej gry średnią ocenę i liczbę recenzji. */
async function withRatings(games) {
  return Promise.all(
    games.map(async (g) => ({
      ...g,
      averageRating: await getAverageRating(g.id),
      reviewCount: (await getReviewsForGame(g.id)).length,
    }))
  );
}

module.exports = {
  getAllGames,
  getGameById,
  getReviewsForGame,
  getAverageRating,
  getCategories,
  withRatings,
};