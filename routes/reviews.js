const express = require('express');
const router = express.Router();

const { readCollection } = require('../utils/dataStore');
const { getAllGames } = require('../utils/gameHelpers');
const {
  getMostReviewedGames,
  getTopRatedGames,
  getLatestReviews,
  getTopReviewers,
  getOverallStats,
  getCategoryBreakdown,
  getFeaturedReview,
} = require('../utils/reviewStatsHelpers');

router.get('/', (req, res) => {
  const { sort } = req.query;
  const games = getAllGames();

  let allReviews = readCollection('reviews').map((r) => ({
    ...r,
    game: games.find((g) => g.id === r.gameId) || null,
  }));

  if (sort === 'rating') {
    allReviews.sort((a, b) => b.rating - a.rating);
  } else if (sort === 'oldest') {
    allReviews.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else {
    allReviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  res.render('reviews', {
    title: 'Recenzje graczy - najlepsze i najczęściej oceniane gry',
    stats: getOverallStats(),
    mostReviewedGames: getMostReviewedGames(10),
    topRatedGames: getTopRatedGames(10, 1),
    latestReviews: getLatestReviews(8),
    topReviewers: getTopReviewers(6),
    categoryBreakdown: getCategoryBreakdown(),
    featuredReview: getFeaturedReview(),
    allReviews,
    activeSort: sort || 'newest',
  });
});

module.exports = router;
