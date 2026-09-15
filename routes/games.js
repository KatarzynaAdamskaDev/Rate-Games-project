const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const {
  getAllGames,
  getGameById,
  getReviewsForGame,
  withRatings,
} = require('../utils/gameHelpers');
const { readCollection, writeCollection } = require('../utils/dataStore');
const Review = require('../models/Review');

/* --------------------------- LISTA GIER --------------------------- */

router.get('/', async (req, res) => {
  const { category, sort } = req.query;

  let games = await withRatings(getAllGames());

  if (category) {
    games = games.filter(
      (g) => g.category.toLowerCase() === String(category).toLowerCase()
    );
  }

  if (sort === 'rating') {
    games.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));
  } else if (sort === 'newest') {
    games.sort((a, b) => b.releaseYear - a.releaseYear);
  } else {
    games.sort((a, b) => a.title.localeCompare(b.title));
  }

  res.render('games/list', {
    title: 'Gry',
    games,
    activeCategory: category || null,
    activeSort: sort || 'title',
  });
});

/* --------------------------- DODAJ GRĘ (ADMIN) --------------------------- */

router.get('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.render('games/form', { title: 'Dodaj grę', formData: {}, game: null });
});

router.post('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  const { title, category, platform, releaseYear, coverImage, description } =
    req.body;

  if (!title || !category || !description) {
    req.flash('error', 'Tytuł, kategoria i opis są wymagane.');
    return res.status(400).render('games/form', {
      title: 'Dodaj grę',
      formData: req.body,
      game: null,
    });
  }

  // Katalog gier zostaje w JSON (treść zarządzana przez Ciebie, nie przez
  // użytkowników w czasie działania aplikacji).
  const games = getAllGames();
  const newGame = {
    id: uuidv4(),
    title,
    category,
    platform: platform || 'PC',
    releaseYear: Number(releaseYear) || new Date().getFullYear(),
    coverImage: coverImage || '/images/game-placeholder.svg',
    description,
  };
  games.push(newGame);
  writeCollection('games', games);

  req.flash('success', `Gra "${title}" została dodana.`);
  res.redirect(`/games/${newGame.id}`);
});

/* --------------------------- SZCZEGÓŁY GRY --------------------------- */

router.get('/:id', async (req, res, next) => {
  const game = getGameById(req.params.id);
  if (!game) return next();

  const reviews = await getReviewsForGame(game.id);
  const averageRating =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((sum, r) => sum + Number(r.rating), 0) /
            reviews.length) *
            10
        ) / 10
      : null;

  res.render('games/detail', {
    title: game.title,
    game,
    reviews,
    averageRating,
  });
});

/* --------------------------- DODAJ OPINIĘ --------------------------- */

router.post('/:id/reviews', ensureAuthenticated, async (req, res, next) => {
  const game = getGameById(req.params.id);
  if (!game) return next();

  const { rating, text } = req.body;
  const numericRating = Number(rating);

  if (!numericRating || numericRating < 1 || numericRating > 5 || !text) {
    req.flash('error', 'Podaj ocenę (1-5) oraz treść opinii.');
    return res.redirect(`/games/${game.id}`);
  }

  await Review.create({
    gameId: game.id,
    userId: req.session.user.id,
    username: req.session.user.username,
    rating: numericRating,
    text,
  });

  req.flash('success', 'Dziękujemy za dodanie opinii!');
  res.redirect(`/games/${game.id}`);
});

module.exports = router;