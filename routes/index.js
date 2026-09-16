const express = require('express');
const router = express.Router();

const { readCollection } = require('../utils/dataStore');
const { getMostReviewedGames } = require('../utils/reviewStatsHelpers');

router.get('/', async (req, res) => {
  const games = await getMostReviewedGames(6);

  const latestPosts = readCollection('blog')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 3);

  res.render('index', {
    title: 'GameVerse - opinie o grach',
    games,
    latestPosts,
  });
});

module.exports = router;