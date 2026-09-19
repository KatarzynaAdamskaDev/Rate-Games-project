const express = require('express');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const { getReviewsForGame } = require('../utils/gameHelpers');
const Review = require('../models/Review');
const CustomGame = require('../models/CustomGame');
const { getGameById } = require('../utils/gameCatalog');
const { syncUserProgress } = require('../utils/progressHelpers');
const { createNotification } = require('../utils/notificationHelpers');
const ReviewComment = require('../models/ReviewComment');
const { getGenres, PLATFORM_OPTIONS } = require('../utils/igdbService');
const {
  listGames,
  findGenre,
  availableYears,
  buildPagerLinks,
} = require('../utils/gameListing');

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
    const { category, platform, year, sort, q, page } = req.query;

    const genre = await findGenre(category);
    const activePlatform = PLATFORM_OPTIONS.find((p) => p.key === String(platform || '').toLowerCase());
    const activeYear = availableYears().includes(parseInt(year, 10)) ? parseInt(year, 10) : null;

    const result = await listGames({
      q,
      genre,
      platform: activePlatform ? activePlatform.key : null,
      year: activeYear,
      sort,
      page,
    });

    res.render('games/list', {
      title: 'Gry',
      games: result.games,
      genres: await getGenres(),
      platforms: PLATFORM_OPTIONS,
      years: availableYears(),
      activeGenre: genre,
      activePlatform: activePlatform || null,
      activeYear,
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

router.post('/new', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  const { title, category, platform, releaseYear, coverImage, description } = req.body;

  if (!title || !category || !description) {
    req.flash('error', 'Tytuł, kategoria i opis są wymagane.');
    return res.status(400).render('games/form', {
      title: 'Dodaj grę',
      formData: req.body,
      game: null,
    });
  }

  try {
    const newGame = await CustomGame.create({
      title,
      category,
      platform: platform || 'PC',
      releaseYear: Number(releaseYear) || new Date().getFullYear(),
      coverImage: coverImage || '/images/game-placeholder.svg',
      description,
    });

    req.flash('success', `Gra "${title}" została dodana.`);
    res.redirect(`/games/${newGame.id}`);
  } catch (err) {
    next(err);
  }
});

/* ------------------ WYSZUKIWANIE GIER (JSON, do formularzy) ------------------ */

// Używane przez okno wyboru ulubionej gry. Musi być przed /:id.
router.get('/search-json', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ games: [] });

  const { games } = await listGames({ q, pageSize: 8 });
  res.json({
    games: games.map((g) => ({
      id: String(g.id),
      title: g.title,
      coverImage: g.coverImage,
      releaseYear: g.releaseYear,
      platform: g.platform,
    })),
  });
});

/* --------------------------- SZCZEGÓŁY GRY (IGDB lub LOKALNE) --------------------------- */

router.get('/:id', async (req, res, next) => {
  try {
    // Gra z IGDB (id numeryczne) albo dodana ręcznie przez admina (UUID)
    const game = await getGameById(req.params.id);
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
      // Na stronie gry pokazujemy pełną listę platform (na kartach - skrót).
      game: {
        ...game,
        platform: game.platformsFull && game.platformsFull.length ? game.platformsFull.join(', ') : game.platform,
      },
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

  if (result.liked) {
    const review = await Review.findByPk(reviewId);
    if (review) {
      const game = await getGameById(review.gameId);
      await createNotification({
        userId: review.userId,
        type: 'review-like',
        actorId: req.session.user.id,
        message: `${req.session.user.username} polubił(a) Twoją recenzję${game ? ` gry „${game.title}”` : ''}`,
        link: `/games/${review.gameId}#review-${review.id}`,
      });
    }
  }

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

  const commentedReview = await Review.findByPk(req.params.reviewId);
  if (commentedReview) {
    const game = await getGameById(commentedReview.gameId);
    await createNotification({
      userId: commentedReview.userId,
      type: 'review-comment',
      actorId: req.session.user.id,
      message: `${req.session.user.username} skomentował(a) Twoją recenzję${game ? ` gry „${game.title}”` : ''}`,
      link: `/games/${commentedReview.gameId}#review-${commentedReview.id}`,
    });
  }

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

  if (result.liked) {
    const comment = await ReviewComment.findByPk(commentId);
    if (comment) {
      await createNotification({
        userId: comment.userId,
        type: 'comment-like',
        actorId: req.session.user.id,
        message: `${req.session.user.username} polubił(a) Twój komentarz`,
        link: `/games/${req.params.id}#review-${comment.reviewId}`,
      });
    }
  }

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