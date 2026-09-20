const express = require('express');
const router = express.Router();

const { Op } = require('sequelize');
const { withRatings } = require('../utils/gameHelpers');
const CustomGame = require('../models/CustomGame');
const { fromCustomRow } = require('../utils/gameCatalog');
const { getPosts } = require('../utils/blogHelpers');
const { listGames } = require('../utils/gameListing');
const { searchUsersByUsername } = require('../utils/userHelpers');

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  let games = [];
  let posts = [];
  let users = [];

  if (q) {
    const needle = q.toLowerCase();

    // Gry z IGDB (wyniki wg trafności) + gry dodane ręcznie przez admina.
    const customRows = await CustomGame.findAll({
      where: { [Op.or]: [{ title: { [Op.like]: `%${q}%` } }, { category: { [Op.like]: `%${q}%` } }] },
      limit: 12,
    });
    const igdb = await listGames({ q, pageSize: 24 });
    games = [...(await withRatings(customRows.map(fromCustomRow))), ...igdb.games];

    posts = (await getPosts()).filter(
      (p) =>
        p.title.toLowerCase().includes(needle) ||
        String(p.content || '').toLowerCase().includes(needle)
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