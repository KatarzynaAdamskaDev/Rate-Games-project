const express = require('express');
const router = express.Router();

const { readCollection } = require('../utils/dataStore');
const {
  getMostReviewedGames,
  getOverallStats,
  getReviewOfTheWeek,
} = require('../utils/reviewStatsHelpers');
const { getPopularGames } = require('../utils/igdbService');

/**
 * Ranking gier na stronie głównej: najczęściej recenzowane w ostatnich 7 dniach,
 * a gdy w tym czasie nic nie napisano - w całej historii. Dopiero gdy nikt jeszcze
 * nic nie zrecenzował, pokazujemy popularne gry z IGDB (z uczciwym nagłówkiem).
 */
async function buildTrending() {
  const weekly = await getMostReviewedGames(6, 7);
  if (weekly.length > 0) {
    return {
      games: weekly,
      title: 'Najczęściej recenzowane gry tego tygodnia',
      subtitle: 'Ranking gier na podstawie liczby recenzji dodanych przez społeczność w ostatnich 7 dniach.',
      linkHref: '/reviews',
      linkLabel: 'Zobacz pełny ranking',
    };
  }

  const allTime = await getMostReviewedGames(6);
  if (allTime.length > 0) {
    return {
      games: allTime,
      title: 'Najczęściej recenzowane gry',
      subtitle: 'W tym tygodniu nikt jeszcze nic nie zrecenzował - oto ranking z całej historii GameVerse.',
      linkHref: '/reviews',
      linkLabel: 'Zobacz pełny ranking',
    };
  }

  return {
    games: await getPopularGames(6),
    title: 'Popularne gry',
    subtitle: 'Nikt jeszcze nie napisał recenzji - zacznij od jednej z najpopularniejszych gier.',
    linkHref: '/games',
    linkLabel: 'Zobacz wszystkie gry',
  };
}

router.get('/', async (req, res, next) => {
  try {
    const [trending, weeklyReview, stats] = await Promise.all([
      buildTrending(),
      getReviewOfTheWeek(req.session.user ? req.session.user.id : null),
      getOverallStats(),
    ]);

    const latestPosts = readCollection('blog')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 3);

    res.render('index', {
      title: 'GameVerse - opinie o grach',
      trending,
      weeklyReview,
      stats,
      latestPosts,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
