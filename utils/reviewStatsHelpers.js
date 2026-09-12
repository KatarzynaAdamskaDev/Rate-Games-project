/**
 * Statystyki i rankingi używane na stronie /reviews - inspirowane sekcjami
 * typu "Popular reviews" / "Most watched" znanymi z Letterboxd, ale
 * zbudowane wyłącznie na istniejących danych (games.json + reviews.json),
 * bez żadnej zmiany w dotychczasowym schemacie recenzji.
 */
const { readCollection } = require('./dataStore');
const { getAllGames, withRatings } = require('./gameHelpers');

/** Top N gier z największą liczbą recenzji ("najczęściej recenzowane"). */
function getMostReviewedGames(limit = 10) {
  return withRatings(getAllGames())
    .filter((g) => g.reviewCount > 0)
    .sort(
      (a, b) =>
        b.reviewCount - a.reviewCount ||
        (b.averageRating || 0) - (a.averageRating || 0)
    )
    .slice(0, limit);
}

/** Top N gier z najwyższą średnią oceną (wymaga co najmniej minReviews recenzji). */
function getTopRatedGames(limit = 10, minReviews = 1) {
  return withRatings(getAllGames())
    .filter((g) => g.reviewCount >= minReviews)
    .sort(
      (a, b) =>
        (b.averageRating || 0) - (a.averageRating || 0) ||
        b.reviewCount - a.reviewCount
    )
    .slice(0, limit);
}

/** Najnowsze recenzje ze wszystkich gier (jak "recent activity"). */
function getLatestReviews(limit = 8) {
  const games = getAllGames();
  return readCollection('reviews')
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((r) => ({ ...r, game: games.find((g) => g.id === r.gameId) || null }));
}

/** Ranking najaktywniejszych recenzentów po liczbie napisanych recenzji. */
function getTopReviewers(limit = 6) {
  const reviews = readCollection('reviews');
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
function getOverallStats() {
  const games = getAllGames();
  const reviews = readCollection('reviews');
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
function getCategoryBreakdown() {
  const games = withRatings(getAllGames());
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
function getFeaturedReview() {
  const games = getAllGames();
  const reviews = readCollection('reviews');
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
