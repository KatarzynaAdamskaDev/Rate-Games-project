const express = require('express');
const router = express.Router();

const Review = require('../models/Review');
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

router.get('/', async (req, res) => {
  const { sort } = req.query;
  const games = getAllGames();

  const rawReviews = await Review.findAll();
  let allReviews = rawReviews.map((r) => {
    const plain = r.get({ plain: true });
    return { ...plain, game: games.find((g) => g.id === plain.gameId) || null };
  });

  if (sort === 'rating') {
    allReviews.sort((a, b) => b.rating - a.rating);
  } else if (sort === 'oldest') {
    allReviews.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else {
    allReviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const [
    stats,
    mostReviewedGames,
    topRatedGames,
    latestReviews,
    topReviewers,
    categoryBreakdown,
    featuredReview,
  ] = await Promise.all([
    getOverallStats(),
    getMostReviewedGames(10),
    getTopRatedGames(10, 1),
    getLatestReviews(8),
    getTopReviewers(6),
    getCategoryBreakdown(),
    getFeaturedReview(),
  ]);

  res.render('reviews', {
    title: 'Recenzje graczy - najlepsze i najczęściej oceniane gry',
    stats,
    mostReviewedGames,
    topRatedGames,
    latestReviews,
    topReviewers,
    categoryBreakdown,
    featuredReview,
    allReviews,
    activeSort: sort || 'newest',
  });
});

module.exports = router;