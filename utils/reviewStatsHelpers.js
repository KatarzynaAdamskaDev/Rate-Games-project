/**
 * Statystyki i rankingi używane na stronie /reviews - inspirowane sekcjami
 * typu "Popular reviews" / "Most watched" znanymi z Letterboxd, ale
 * zbudowane wyłącznie na istniejących danych (games.json + tabela reviews).
 */
const Review = require('../models/Review');
const { getAllGames, withRatings } = require('./gameHelpers');

async function getAllReviews() {
  const rows = await Review.findAll();
  return rows.map((r) => r.get({ plain: true }));
}

/** Top N gier z największą liczbą recenzji ("najczęściej recenzowane"). */
async function getMostReviewedGames(limit = 10) {
  const rated = await withRatings(getAllGames());
  return rated
    .filter((g) => g.reviewCount > 0)
    .sort(
      (a, b) =>
        b.reviewCount - a.reviewCount ||
        (b.averageRating || 0) - (a.averageRating || 0)
    )
    .slice(0, limit);
}

/** Top N gier z najwyższą średnią oceną (wymaga co najmniej minReviews recenzji). */
async function getTopRatedGames(limit = 10, minReviews = 1) {
  const rated = await withRatings(getAllGames());
  return rated
    .filter((g) => g.reviewCount >= minReviews)
    .sort(
      (a, b) =>
        (b.averageRating || 0) - (a.averageRating || 0) ||
        b.reviewCount - a.reviewCount
    )
    .slice(0, limit);
}

/** Najnowsze recenzje ze wszystkich gier (jak "recent activity"). */
async function getLatestReviews(limit = 8) {
  const games = getAllGames();
  const reviews = await getAllReviews();
  return reviews
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((r) => ({ ...r, game: games.find((g) => g.id === r.gameId) || null }));
}

/** Ranking najaktywniejszych recenzentów po liczbie napisanych recenzji. */
async function getTopReviewers(limit = 6) {
  const reviews = await getAllReviews();
  const counts = {};
  reviews.forEach((r) => {
    counts[r.username] = (counts[r.username] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([username, reviewCount]) => ({ username, reviewCount }));
}

/** Zbiorcze statystyki dla nagłówka strony (liczby pod SEO/UX). */
async function getOverallStats() {
  const games = getAllGames();
  const reviews = await getAllReviews();
  const gamesWithReviews = new Set(reviews.map((r) => r.gameId)).size;
  const averageRating = reviews.length
    ? Math.round(
        (reviews.reduce((sum, r) => sum + Number(r.rating), 0) /
          reviews.length) *
          10
      ) / 10
    : null;
  const totalReviewers = new Set(reviews.map((r) => r.username)).size;

  return {
    totalReviews: reviews.length,
    totalGames: games.length,
    gamesWithReviews,
    averageRating,
    totalReviewers,
  };
}

/** Rozkład liczby recenzji na kategorie (do linkowania wewnętrznego pod SEO). */
async function getCategoryBreakdown() {
  const games = await withRatings(getAllGames());
  const map = {};

  games.forEach((g) => {
    if (!map[g.category]) {
      map[g.category] = { category: g.category, gamesCount: 0, reviewsCount: 0 };
    }
    map[g.category].gamesCount += 1;
    map[g.category].reviewsCount += g.reviewCount;
  });

  return Object.values(map).sort((a, b) => b.reviewsCount - a.reviewsCount);
}

/** "Recenzja tygodnia" - wybieramy najbardziej rozbudowaną (najdłuższą) opinię. */
async function getFeaturedReview() {
  const games = getAllGames();
  const reviews = await getAllReviews();
  if (!reviews.length) return null;

  const featured = reviews
    .slice()
    .sort((a, b) => b.text.length - a.text.length)[0];

  return { ...featured, game: games.find((g) => g.id === featured.gameId) || null };
}

module.exports = {
  getMostReviewedGames,
  getTopRatedGames,
  getLatestReviews,
  getTopReviewers,
  getOverallStats,
  getCategoryBreakdown,
  getFeaturedReview,
};