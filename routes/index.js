const express = require('express');
const router = express.Router();

const { getPosts } = require('../utils/blogHelpers');
const { SITE } = require('../utils/siteFacts');
const { organizationLd } = require('../utils/seo');
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

    // Tylko wpisy już opublikowane (bez szkiców i zaplanowanych).
    const latestPosts = getPosts().slice(0, 3);

    res.render('index', {
      title: 'GameVerse - opinie o grach',
      seo: {
        title: 'GameVerse - opinie o grach',
        description: SITE.description,
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'GameVerse',
            url: res.locals.siteUrl,
            inLanguage: SITE.language,
            description: SITE.summary,
            publisher: { '@id': `${res.locals.siteUrl}/#organization` },
            potentialAction: {
              '@type': 'SearchAction',
              target: `${res.locals.siteUrl}/search?q={search_term_string}`,
              'query-input': 'required name=search_term_string',
            },
          },
          organizationLd(res.locals.siteUrl, SITE),
        ],
      },
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
