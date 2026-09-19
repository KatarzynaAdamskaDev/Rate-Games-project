const express = require('express');
const router = express.Router();

const { getGenres } = require('../utils/igdbService');
const {
  listGames,
  findGenre,
  availableYears,
  buildPagerLinks,
} = require('../utils/gameListing');

/* Kategorie to gatunki pobierane z IGDB - lista aktualizuje się sama. */
async function renderCategoryPage(req, res, genre) {
  const { platform, year, sort, page } = req.query;

  const result = await listGames({ genre, platform, year, sort, page });

  res.render('category', {
    title: genre ? `Kategoria: ${genre.name}` : 'Kategorie',
    categories: await getGenres(),
    selectedCategory: genre ? genre.slug : null,
    selectedCategoryName: genre ? genre.name : null,
    selectedPlatform: platform || null,
    selectedYear: year || null,
    availableYears: availableYears(),
    activeSort: result.sort,
    pager: buildPagerLinks(req, result.page, result.hasNext),
    games: result.games,
  });
}

/* Wszystkie gry (najpopularniejsze) z opcjonalnymi filtrami */
router.get('/', async (req, res, next) => {
  try {
    await renderCategoryPage(req, res, null);
  } catch (err) {
    next(err);
  }
});

/* Gry w danej kategorii (slug gatunku IGDB, np. /category/shooter) */
router.get('/:name', async (req, res, next) => {
  try {
    const genre = await findGenre(req.params.name);
    if (!genre) return next();
    await renderCategoryPage(req, res, genre);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
