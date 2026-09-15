const express = require('express');
const router = express.Router();

const { getAllGames, withRatings } = require('../utils/gameHelpers');
const { readCollection } = require('../utils/dataStore');

router.get('/', async (req, res) => {
  const games = (await withRatings(getAllGames()))
    .sort((a, b) => new Date(b.releaseYear) - new Date(a.releaseYear))
    .slice(0, 6);

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