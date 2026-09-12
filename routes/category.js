const express = require('express');
const router = express.Router();

const { getCategories, getAllGames, withRatings } = require('../utils/gameHelpers');

const PLATFORM_GROUPS = {
  konsole: ['ps5', 'xbox', 'switch'],
  mobilne: ['android', 'ios'],
};

function filterByPlatformAndYear(games, platform, year) {
  let filtered = games;

  if (platform) {
    const platformLower = platform.toLowerCase();
    const group = PLATFORM_GROUPS[platformLower];

    filtered = filtered.filter((g) => {
      const gamePlatforms = (g.platform || '')
        .split('/')
        .map((p) => p.trim().toLowerCase());

      if (group) {
        return group.some((p) => gamePlatforms.includes(p));
      }
      return gamePlatforms.includes(platformLower);
    });
  }

  if (year) {
    filtered = filtered.filter((g) => String(g.releaseYear) === String(year));
  }

  return filtered;
}

function getAvailableYears() {
  const years = getAllGames().map((g) => g.releaseYear);
  return [...new Set(years)].sort((a, b) => b - a);
}

/* Lista wszystkich kategorii */
router.get('/', (req, res) => {
  const { platform, year } = req.query;

  const categories = getCategories().map((name) => {
    const count = getAllGames().filter((g) => g.category === name).length;
    return { name, count };
  });

  let games = filterByPlatformAndYear(getAllGames(), platform, year);
  games = withRatings(games);

  res.render('category', {
    title: 'Kategorie',
    categories,
    selectedCategory: null,
    selectedPlatform: platform || null,
    selectedYear: year || null,
    availableYears: getAvailableYears(),
    games,
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
  games = filterByPlatformAndYear(games, platform, year);
  games = withRatings(games);

  res.render('category', {
    title: `Kategoria: ${name}`,
    categories,
    selectedCategory: name,
    selectedPlatform: platform || null,
    selectedYear: year || null,
    availableYears: getAvailableYears(),
    games,
  });
});

module.exports = router;