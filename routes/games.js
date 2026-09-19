const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const { getReviewsForGame } = require('../utils/gameHelpers');
const { readCollection, writeCollection } = require('../utils/dataStore');
const Review = require('../models/Review');
const { syncUserProgress } = require('../utils/progressHelpers');
const { fetchIGDBGames, formatIGDBGame, getGenres } = require('../utils/igdbService');
const { listGames, findGenre, buildPagerLinks } = require('../utils/gameListing');

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

/* --------------------------- LISTA GIER (IGDB) --------------------------- */

router.get('/', async (req, res, next) => {
  try {
    const { category, sort, q, page } = req.query;

    const genre = await findGenre(category);
    const result = await listGames({ q, genre, sort, page });

    res.render('games/list', {
      title: 'Gry',
      games: result.games,
      categories: await getGenres(),
      activeCategory: genre ? genre.slug : null,
      activeSort: result.sort,
      query: String(q || '').trim(),
      pager: buildPagerLinks(req, result.page, result.hasNext),
    });
  } catch (error) {
    next(error);
  }
});

/* --------------------------- DODAJ GRĘ (ADMIN) --------------------------- */

router.get('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.render('games/form', { title: 'Dodaj grę', formData: {}, game: null });
});

router.post('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  const { title, category, platform, releaseYear, coverImage, description } = req.body;

  if (!title || !category || !description) {
    req.flash('error', 'Tytuł, kategoria i opis są wymagane.');
    return res.status(400).render('games/form', {
      title: 'Dodaj grę',
      formData: req.body,
      game: null,
    });
  }

  const localGames = readCollection('games') || [];
  const newGame = {
    id: uuidv4(),
    title,
    category,
    platform: platform || 'PC',
    releaseYear: Number(releaseYear) || new Date().getFullYear(),
    coverImage: coverImage || '/images/game-placeholder.svg',
    description,
  };
  localGames.push(newGame);
  writeCollection('games', localGames);

  req.flash('success', `Gra "${title}" została dodana.`);
  res.redirect(`/games/${newGame.id}`);
});

/* --------------------------- SZCZEGÓŁY GRY (IGDB lub LOKALNE) --------------------------- */

router.get('/:id', async (req, res, next) => {
  try {
    const gameId = req.params.id;
    let game = null;

    // 1. Sprawdzamy czy to ID numeryczne z IGDB, czy UUID lokalnej gry
    if (!isNaN(gameId)) {
      const rawGames = await fetchIGDBGames(
        `fields name, cover.url, summary, genres.name, platforms.name, first_release_date; where id = ${gameId};`
      );
      if (rawGames.length > 0) {
        game = formatIGDBGame(rawGames[0]);
      }
    } else {
      // Pobieranie z lokalnego pliku/bazy (dla gier dodanych przez Admina)
      const localGames = readCollection('games') || [];
      game = localGames.find((g) => g.id === gameId);
    }

    if (!game) return next();

    // 2. Pobieramy Wasze opinie/komentarze z bazy danych dla danego ID gry
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
            (reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length) * 10
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
  } catch (error) {
    next(error);
  }
});

/* --------------------------- DODAJ OPINIĘ --------------------------- */

router.post('/:id/reviews', ensureAuthenticated, async (req, res, next) => {
  const gameId = String(req.params.id);

  const existing = await Review.findOne({
    where: { gameId, userId: req.session.user.id },
  });
  if (existing) {
    req.flash(
      'error',
      'Masz już opinię o tej grze - możesz ją edytować zamiast dodawać nową.'
    );
    return res.redirect(`/games/${gameId}#review-${existing.id}`);
  }

  const { rating, text } = req.body;
  const numericRating = Number(rating);

  if (!numericRating || numericRating < 1 || numericRating > 5 || !text) {
    req.flash('error', 'Podaj ocenę (1-5) oraz treść opinii.');
    return res.redirect(`/games/${gameId}`);
  }

  await Review.create({
    gameId,
    userId: req.session.user.id,
    username: req.session.user.username,
    rating: numericRating,
    text,
  });
  await syncUserProgress(req.session.user.id);

  req.flash('success', 'Dziękujemy za dodanie opinii!');
  res.redirect(`/games/${gameId}`);
});

/* --- RESZTA TRAS (EDYCJA, USUWANE, KOMENTARZE, LAJKI) POZOSTAJE BEZ ZMIAN --- */

router.post('/:id/reviews/:reviewId/edit', ensureAuthenticated, async (req, res, next) => {
  const gameId = String(req.params.id);
  const review = await Review.findByPk(req.params.reviewId);
  if (!review || String(review.gameId) !== gameId) return next();

  if (review.userId !== req.session.user.id) {
    req.flash('error', 'Możesz edytować tylko swoje opinie.');
    return res.redirect(`/games/${gameId}`);
  }

  const { rating, text } = req.body;
  const numericRating = Number(rating);

  if (!numericRating || numericRating < 1 || numericRating > 5 || !text) {
    req.flash('error', 'Podaj ocenę (1-5) oraz treść opinii.');
    return res.redirect(`/games/${gameId}`);
  }

  review.rating = numericRating;
  review.text = text;
  review.editedAt = new Date();
  await review.save();

  req.flash('success', 'Opinia została zaktualizowana.');
  res.redirect(`/games/${gameId}`);
});

router.post('/:id/reviews/:reviewId/delete', ensureAuthenticated, async (req, res, next) => {
  const gameId = String(req.params.id);
  const review = await Review.findByPk(req.params.reviewId);
  if (!review || String(review.gameId) !== gameId) return next();

  const isOwner = review.userId === req.session.user.id;
  const isAdmin = req.session.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    req.flash('error', 'Możesz usuwać tylko swoje opinie.');
    return res.redirect(`/games/${gameId}`);
  }

  await deleteReviewData(review.id);
  await review.destroy();
  await syncUserProgress(review.userId);

  req.flash('success', 'Opinia została usunięta.');
  res.redirect(`/games/${gameId}`);
});

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

router.post('/:id/reviews/:reviewId/comments', ensureAuthenticated, async (req, res, next) => {
  const gameId = String(req.params.id);

  const text = (req.body.text || '').trim();
  if (!text) {
    req.flash('error', 'Komentarz nie może być pusty.');
    return res.redirect(`/games/${gameId}`);
  }

  await addComment({
    reviewId: req.params.reviewId,
    userId: req.session.user.id,
    username: req.session.user.username,
    text: text.slice(0, 500),
  });

  res.redirect(`/games/${gameId}#review-${req.params.reviewId}`);
});

router.post('/:id/reviews/:reviewId/comments/:commentId/delete', ensureAuthenticated, async (req, res, next) => {
  const gameId = String(req.params.id);

  const ok = await deleteComment(req.params.commentId, req.session.user.id);
  if (!ok) {
    req.flash('error', 'Możesz usuwać tylko swoje komentarze.');
  }

  res.redirect(`/games/${gameId}#review-${req.params.reviewId}`);
});

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

router.post('/:id/reviews/:reviewId/report', ensureAuthenticated, async (req, res, next) => {
  const gameId = String(req.params.id);

  await reportReview({
    reviewId: req.params.reviewId,
    reporterId: req.session.user.id,
    reason: req.body.reason || null,
  });

  req.flash(
    'success',
    'Dziękujemy za zgłoszenie. Opinia trafiła do kolejki weryfikacji (panel administratora w budowie).'
  );
  res.redirect(`/games/${gameId}`);
});

module.exports = router;