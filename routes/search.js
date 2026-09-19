const express = require('express');
const router = express.Router();

const { withRatings } = require('../utils/gameHelpers');
const { readCollection } = require('../utils/dataStore');
const { listGames } = require('../utils/gameListing');
const { searchUsersByUsername } = require('../utils/userHelpers');

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  let games = [];
  let posts = [];
  let users = [];

  if (q) {
    const needle = q.toLowerCase();

    // Gry z IGDB (wyniki wg trafności) + gry dodane ręcznie przez admina
    // (te mają id w postaci UUID; stare numeryczne id kolidują z ID z IGDB).
    const localMatches = (readCollection('games') || []).filter(
      (g) =>
        isNaN(g.id) &&
        (g.title.toLowerCase().includes(needle) ||
          g.category.toLowerCase().includes(needle))
    );
    const igdb = await listGames({ q, pageSize: 24 });
    games = [...(await withRatings(localMatches)), ...igdb.games];

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