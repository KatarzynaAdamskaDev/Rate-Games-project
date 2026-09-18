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
const {
  toggleLike,
  getLikeCount,
  hasLiked,
  getCommentsForReview,
  addComment,
  deleteComment,
  toggleCommentLike,
  getCommentLikeCount,
  reportReview,
  deleteReviewData,
} = require('../utils/reviewSocialHelpers');

function wantsJsonResponse(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

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

  const rawReviews = await getReviewsForGame(game.id);
  const meId = req.session.user ? req.session.user.id : null;

  const reviews = await Promise.all(
    rawReviews.map(async (r) => ({
      ...r,
      likeCount: await getLikeCount(r.id),
      liked: await hasLiked(r.id, meId),
      comments: await getCommentsForReview(r.id, meId),
    }))
  );

  const averageRating =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((sum, r) => sum + Number(r.rating), 0) /
            reviews.length) *
            10
        ) / 10
      : null;

  const myReview = meId ? reviews.find((r) => r.userId === meId) : null;

  res.render('games/detail', {
    title: game.title,
    game,
    reviews,
    averageRating,
    myReview,
  });
});

/* --------------------------- DODAJ OPINIĘ --------------------------- */

router.post('/:id/reviews', ensureAuthenticated, async (req, res, next) => {
  const game = getGameById(req.params.id);
  if (!game) return next();

  const existing = await Review.findOne({
    where: { gameId: game.id, userId: req.session.user.id },
  });
  if (existing) {
    req.flash(
      'error',
      'Masz już opinię o tej grze - możesz ją edytować zamiast dodawać nową.'
    );
    return res.redirect(`/games/${game.id}#review-${existing.id}`);
  }

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

/* --------------------------- EDYCJA OPINII --------------------------- */

router.post('/:id/reviews/:reviewId/edit', ensureAuthenticated, async (req, res, next) => {
  const game = getGameById(req.params.id);
  if (!game) return next();

  const review = await Review.findByPk(req.params.reviewId);
  if (!review || review.gameId !== game.id) return next();

  if (review.userId !== req.session.user.id) {
    req.flash('error', 'Możesz edytować tylko swoje opinie.');
    return res.redirect(`/games/${game.id}`);
  }

  const { rating, text } = req.body;
  const numericRating = Number(rating);

  if (!numericRating || numericRating < 1 || numericRating > 5 || !text) {
    req.flash('error', 'Podaj ocenę (1-5) oraz treść opinii.');
    return res.redirect(`/games/${game.id}`);
  }

  review.rating = numericRating;
  review.text = text;
  review.editedAt = new Date();
  await review.save();

  req.flash('success', 'Opinia została zaktualizowana.');
  res.redirect(`/games/${game.id}`);
});

/* --------------------------- USUNIĘCIE OPINII --------------------------- */

router.post('/:id/reviews/:reviewId/delete', ensureAuthenticated, async (req, res, next) => {
  const game = getGameById(req.params.id);
  if (!game) return next();

  const review = await Review.findByPk(req.params.reviewId);
  if (!review || review.gameId !== game.id) return next();

  const isOwner = review.userId === req.session.user.id;
  const isAdmin = req.session.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    req.flash('error', 'Możesz usuwać tylko swoje opinie.');
    return res.redirect(`/games/${game.id}`);
  }

  await deleteReviewData(review.id);
  await review.destroy();

  req.flash('success', 'Opinia została usunięta.');
  res.redirect(`/games/${game.id}`);
});

/* ------------------------------ POLUBIENIE OPINII ------------------------------ */

router.post('/:id/reviews/:reviewId/like', ensureAuthenticated, async (req, res) => {
  const wantsJson = wantsJsonResponse(req);
  const { reviewId } = req.params;

  const result = await toggleLike(reviewId, req.session.user.id);
  const likeCount = await getLikeCount(reviewId);

  if (wantsJson) {
    return res.json({ success: true, liked: result.liked, likeCount });
  }

  res.redirect(`/games/${req.params.id}`);
});

/* ------------------------------ KOMENTARZ ------------------------------ */

router.post('/:id/reviews/:reviewId/comments', ensureAuthenticated, async (req, res, next) => {
  const game = getGameById(req.params.id);
  if (!game) return next();

  const text = (req.body.text || '').trim();
  if (!text) {
    req.flash('error', 'Komentarz nie może być pusty.');
    return res.redirect(`/games/${game.id}`);
  }

  await addComment({
    reviewId: req.params.reviewId,
    userId: req.session.user.id,
    username: req.session.user.username,
    text: text.slice(0, 500),
  });

  res.redirect(`/games/${game.id}#review-${req.params.reviewId}`);
});

/* ------------------------------ USUNIĘCIE KOMENTARZA ------------------------------ */

router.post('/:id/reviews/:reviewId/comments/:commentId/delete', ensureAuthenticated, async (req, res, next) => {
  const game = getGameById(req.params.id);
  if (!game) return next();

  const ok = await deleteComment(req.params.commentId, req.session.user.id);
  if (!ok) {
    req.flash('error', 'Możesz usuwać tylko swoje komentarze.');
  }

  res.redirect(`/games/${game.id}#review-${req.params.reviewId}`);
});

/* ------------------------------ POLUBIENIE KOMENTARZA ------------------------------ */

router.post('/:id/reviews/:reviewId/comments/:commentId/like', ensureAuthenticated, async (req, res) => {
  const wantsJson = wantsJsonResponse(req);
  const { commentId } = req.params;

  const result = await toggleCommentLike(commentId, req.session.user.id);
  const likeCount = await getCommentLikeCount(commentId);

  if (wantsJson) {
    return res.json({ success: true, liked: result.liked, likeCount });
  }

  res.redirect(`/games/${req.params.id}`);
});

/* ------------------------------ ZGŁOSZENIE ------------------------------ */

router.post('/:id/reviews/:reviewId/report', ensureAuthenticated, async (req, res, next) => {
  const game = getGameById(req.params.id);
  if (!game) return next();

  await reportReview({
    reviewId: req.params.reviewId,
    reporterId: req.session.user.id,
    reason: req.body.reason || null,
  });

  req.flash(
    'success',
    'Dziękujemy za zgłoszenie. Opinia trafiła do kolejki weryfikacji (panel administratora w budowie).'
  );
  res.redirect(`/games/${game.id}`);
});

module.exports = router;