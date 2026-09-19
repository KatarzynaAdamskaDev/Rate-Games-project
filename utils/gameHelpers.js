const Review = require('../models/Review');

/**
 * Zwraca recenzje gry jako ZWYKŁE obiekty (nie instancje Sequelize) - widoki
 * kopiują je przez spread ({ ...review }), który gubi pola instancji, przez co
 * opinie wyświetlały się jako puste. Najnowsze na górze.
 */
async function getReviewsForGame(gameId) {
  const rows = await Review.findAll({ where: { gameId: String(gameId) } });
  return rows
    .map((r) => r.get({ plain: true }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function averageOf(reviews) {
  if (reviews.length === 0) return null;
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

async function getAverageRating(gameId) {
  return averageOf(await getReviewsForGame(gameId));
}

/** Dołącza do każdej gry średnią ocenę i liczbę recenzji. */
async function withRatings(games) {
  return Promise.all(
    games.map(async (g) => {
      const reviews = await getReviewsForGame(g.id);
      return { ...g, averageRating: averageOf(reviews), reviewCount: reviews.length };
    })
  );
}

module.exports = {
  getReviewsForGame,
  getAverageRating,
  withRatings,
};