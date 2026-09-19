const express = require('express');
const router = express.Router();

const { findGenre } = require('../utils/gameListing');

// Osobna strona kategorii została zastąpiona filtrami na stronie /games.
// Stare linki (/category, /category/:nazwa?platform=...) przekierowują tam.
router.get(['/', '/:name'], async (req, res, next) => {
  try {
    const params = new URLSearchParams();

    if (req.params.name) {
      const genre = await findGenre(req.params.name);
      if (!genre) return next();
      params.set('category', genre.slug);
    }
    ['platform', 'year', 'sort'].forEach((key) => {
      if (req.query[key]) params.set(key, req.query[key]);
    });

    const qs = params.toString();
    res.redirect(301, `/games${qs ? `?${qs}` : ''}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
