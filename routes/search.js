const express = require('express');
const router = express.Router();

const { getAllGames, withRatings } = require('../utils/gameHelpers');
const { readCollection } = require('../utils/dataStore');
const { searchUsersByUsername } = require('../utils/userHelpers');

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  let games = [];
  let posts = [];
  let users = [];

  if (q) {
    const needle = q.toLowerCase();
    games = withRatings(
      getAllGames().filter(
        (g) =>
          g.title.toLowerCase().includes(needle) ||
          g.category.toLowerCase().includes(needle) ||
          g.description.toLowerCase().includes(needle)
      )
    );
    posts = readCollection('blog').filter(
      (p) =>
        p.title.toLowerCase().includes(needle) ||
        p.content.toLowerCase().includes(needle)
    );
    users = await searchUsersByUsername(q);
  }

  res.render('search', {
    title: q ? `Wyniki dla "${q}"` : 'Szukaj',
    query: q,
    games,
    posts,
    users,
  });
});

module.exports = router;