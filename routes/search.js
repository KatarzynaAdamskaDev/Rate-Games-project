const express = require('express');
const router = express.Router();

const { getAllGames, withRatings } = require('../utils/gameHelpers');
const { readCollection } = require('../utils/dataStore');

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let games = [];
  let posts = [];

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
  }

  res.render('search', {
    title: q ? `Wyniki dla "${q}"` : 'Szukaj',
    query: q,
    games,
    posts,
  });
});

module.exports = router;
