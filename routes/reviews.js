const express = require('express');
const router = express.Router();

const {
  getMostReviewedGames,
  getTopRatedGames,
  getOverallStats,
  getTopReviewers,
  getReviewFeed,
  getReviewOfTheWeek,
} = require('../utils/reviewStatsHelpers');
const { buildPagerLinks } = require('../utils/gameListing');
const { reportLocals } = require('../utils/reportReasons');

router.get('/', async (req, res, next) => {
  try {
    const { sort, rating, page } = req.query;
    const viewerId = req.session.user ? req.session.user.id : null;

    const [stats, mostReviewedGames, topRatedGames, topReviewers, weeklyReview, feed] =
      await Promise.all([
        getOverallStats(),
        getMostReviewedGames(10),
        getTopRatedGames(10, 1),
        getTopReviewers(6),
        getReviewOfTheWeek(viewerId),
        getReviewFeed({ sort, rating, page, viewerId }),
      ]);

    res.render('reviews', {
      ...reportLocals('review', 'comment'),
      seo: { description: 'Najnowsze recenzje graczy, ranking najczęściej recenzowanych i najwyżej ocenianych gier oraz recenzja tygodnia w GameVerse.' },
      title: 'Recenzje graczy',
      stats,
      mostReviewedGames,
      topRatedGames,
      topReviewers,
      weeklyReview,
      feed,
      activeSort: feed.sort,
      activeRating: Number(rating) >= 1 && Number(rating) <= 5 ? Number(rating) : '',
      pager: buildPagerLinks(req, feed.page, feed.page < feed.pages, feed.pages),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
