const express = require('express');
const router = express.Router();

const { getCategories, getAllGames, withRatings } = require('../utils/gameHelpers');

/* Lista wszystkich kategorii */
router.get('/', (req, res) => {
  const categories = getCategories().map((name) => {
    const count = getAllGames().filter((g) => g.category === name).length;
    return { name, count };
  });

  res.render('category', {
    title: 'Kategorie',
    categories,
    selectedCategory: null,
    selectedPlatform: null,
    selectedYear: null,
    games: [],
  });
});

/* Gry w danej kategorii */
router.get('/:name', (req, res) => {
  const { name } = req.params;
  const { platform, year } = req.query;

  const categories = getCategories().map((c) => ({
    name: c,
    count: getAllGames().filter((g) => g.category === c).length,
  }));

  let games = getAllGames().filter(
    (g) => g.category.toLowerCase() === name.toLowerCase()
  );

  if (platform) {
    games = games.filter((g) => {
      // "PC / PS5 / Xbox" -> ["pc", "ps5", "xbox"]
      const platforms = (g.platform || '')
        .split('/')
        .map((p) => p.trim().toLowerCase());
      return platforms.includes(platform.toLowerCase());
    });
  }

  if (year) {
    games = games.filter((g) => String(g.releaseYear) === String(year));
  }

  games = withRatings(games);

  res.render('category', {
    title: `Kategoria: ${name}`,
    categories,
    selectedCategory: name,
    selectedPlatform: platform || null,
    selectedYear: year || null,
    games,
  });
});

module.exports = router;