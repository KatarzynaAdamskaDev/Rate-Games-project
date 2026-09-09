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
    games: [],
  });
});

/* Gry w danej kategorii */
router.get('/:name', (req, res) => {
  const { name } = req.params;
  const categories = getCategories().map((c) => ({
    name: c,
    count: getAllGames().filter((g) => g.category === c).length,
  }));

  const games = withRatings(
    getAllGames().filter(
      (g) => g.category.toLowerCase() === name.toLowerCase()
    )
  );

  res.render('category', {
    title: `Kategoria: ${name}`,
    categories,
    selectedCategory: name,
    games,
  });
});

module.exports = router;
