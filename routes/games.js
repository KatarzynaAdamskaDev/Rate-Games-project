const express = require('express');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const { getReviewsForGame } = require('../utils/gameHelpers');
const Review = require('../models/Review');
const CustomGame = require('../models/CustomGame');
const User = require('../models/User');
const { getGameById } = require('../utils/gameCatalog');
const { syncUserProgress } = require('../utils/progressHelpers');
const { createNotification } = require('../utils/notificationHelpers');
const { moderateText } = require('../utils/contentFilter');
const { limiters } = require('../middleware/rateLimit');
const { blockIfMuted } = require('../middleware/muted');
const { REASONS_BY_TYPE, findReason, MAX_COMMENT_LENGTH } = require('../utils/reportReasons');
const ReviewComment = require('../models/ReviewComment');
const { getGenres, PLATFORM_OPTIONS } = require('../utils/igdbService');
const { plainText, isoDate, breadcrumbLd } = require('../utils/seo');
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

/** Ocena od 0.5 do 5 co pół gwiazdki (0.5, 1, 1.5 ... 5). */
function isValidRating(value) {
  return Number.isFinite(value) && value >= 0.5 && value <= 5 && Number.isInteger(value * 2);
}

function wantsJsonResponse(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

/**
 * Wraca tam, skąd przyszło żądanie (np. profil, /reviews, strona główna), a nie zawsze na
 * stronę gry - edycja/usuwanie opinii da się teraz uruchomić z kilku miejsc (patrz partials/review-card).
 */
function backTo(req, fallback) {
  try {
    const url = new URL(req.get('Referer') || '', `http://${req.get('host')}`);
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch (err) {
    // niepoprawny nagłówek Referer - użyj adresu domyślnego
  }
  return fallback;
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
      seo: {
        description: 'Katalog gier w GameVerse: filtruj po kategorii, platformie i roku, czytaj opinie graczy i wystawiaj własne oceny.',
        // Widoki z filtrem, sortowaniem lub frazą nie konkurują z główną listą w wynikach wyszukiwania.
        noindex: !!(category || platform || year || sort || String(q || '').trim()),
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'Gry w katalogu GameVerse',
          itemListElement: result.games.map((g, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: g.title,
            url: `${res.locals.siteUrl}/games/${g.id}`,
          })),
        },
      },
      games: result.games,
      genres: await getGenres(),
      platforms: PLATFORM_OPTIONS,
      years: availableYears(),
      activeGenre: genre,
      activePlatform: activePlatform || null,
      activeYear,
      activeSort: result.sort,
      query: String(q || '').trim(),
      pager: buildPagerLinks(req, result.page, result.hasNext, result.totalPages),
    });
  } catch (error) {
    next(error);
  }
});

/* --------------------------- DODAJ GRĘ (ADMIN) --------------------------- */

// Dodawanie gier ręcznie odbywa się w panelu admina (formularz z wgrywaniem okładki i wyborem platform).
router.get('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.redirect('/admin/games/new');
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

    const authors = await User.findAll({
      where: { id: [...new Set(rawReviews.map((r) => r.userId))] },
      attributes: ['id', 'avatarUrl'],
    });
    const avatarById = new Map(authors.map((u) => [u.id, u.avatarUrl || null]));

    const reviews = await Promise.all(
      rawReviews.map(async (r) => ({
        ...r,
        avatarUrl: avatarById.get(r.userId) || null,
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

    const plural = (n) => (n === 1 ? 'opinia' : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'opinie' : 'opinii');
    const platforms = game.platformsFull && game.platformsFull.length ? game.platformsFull.join(', ') : game.platform;
    const ratingLine = averageRating
      ? `Ocena graczy: ${averageRating}/5 (${reviews.length} ${plural(reviews.length)}).`
      : 'Zostań pierwszą osobą, która oceni tę grę.';
    const gameSummary = plainText(game.description, 150);
    const cover = game.coverImage;

    // Link do konkretnej recenzji (?review=...) ma własny podgląd: autor, ocena i początek tekstu.
    const sharedReview = req.query.review ? reviews.find((r) => r.id === String(req.query.review)) : null;
    const seo = sharedReview
      ? {
          title: `Recenzja gry ${game.title} od ${sharedReview.username} - ${Number(sharedReview.rating)}/5`,
          description: plainText(sharedReview.text, 200),
          type: 'article',
          publishedTime: isoDate(sharedReview.createdAt),
        }
      : {
          title: `${game.title} - opinie i oceny graczy`,
          description: `${game.title}${game.releaseYear ? ` (${game.releaseYear})` : ''} - ${platforms}. ${ratingLine} ${gameSummary}`.trim(),
        };
    Object.assign(seo, {
      image: cover,
      imageAlt: `Okładka gry ${game.title}`,
      card: 'summary', // okładki są pionowe - mała karta wygląda lepiej niż duża, przycinana
      noindex: !!sharedReview, // podgląd recenzji nie ma być drugim wynikiem dla tej samej strony gry
      jsonLd: [{
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: game.title,
        description: plainText(game.description, 300),
        image: res.locals.absoluteUrl(cover),
        genre: game.category || undefined,
        gamePlatform: platforms || undefined,
        datePublished: Number.isInteger(Number(game.releaseYear)) ? String(game.releaseYear) : undefined,
        aggregateRating: averageRating
          ? { '@type': 'AggregateRating', ratingValue: averageRating, ratingCount: reviews.length, bestRating: 5, worstRating: 0.5 }
          : undefined,
        review: reviews.length === 0 ? undefined : reviews.slice(0, 5).map((r) => ({
          '@type': 'Review',
          author: { '@type': 'Person', name: r.username },
          datePublished: isoDate(r.createdAt),
          reviewBody: plainText(r.text, 300),
          reviewRating: { '@type': 'Rating', ratingValue: Number(r.rating), bestRating: 5, worstRating: 0.5 },
        })),
      },
      breadcrumbLd(res.locals.siteUrl, [
        { name: 'GameVerse', path: '/' },
        { name: 'Gry', path: '/games' },
        { name: game.title, path: `/games/${game.id}` },
      ])],
    });

    res.render('games/detail', {
      title: game.title,
      seo,
      // Na stronie gry pokazujemy pełną listę platform (na kartach - skrót).
      game: {
        ...game,
        platform: game.platformsFull && game.platformsFull.length ? game.platformsFull.join(', ') : game.platform,
      },
      reviews,
      averageRating,
      myReview,
      reportReasonSets: { review: REASONS_BY_TYPE.review, comment: REASONS_BY_TYPE.comment },
      reportCommentMax: MAX_COMMENT_LENGTH,
    });
  } catch (error) {
    next(error);
  }
});

/* --------------------------- DODAJ OPINIĘ --------------------------- */

router.post('/:id/reviews', ensureAuthenticated, blockIfMuted, limiters.review, async (req, res, next) => {
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

  if (!isValidRating(numericRating) || !text) {
    req.flash('error', 'Podaj ocenę (0.5-5, co pół gwiazdki) oraz treść opinii.');
    return res.redirect(`/games/${gameId}`);
  }

  const checked = moderateText(text, { userId: req.session.user.id });
  if (!checked.ok) {
    req.flash('error', checked.error);
    return res.redirect(`/games/${gameId}`);
  }

  await Review.create({
    gameId,
    userId: req.session.user.id,
    username: req.session.user.username,
    rating: numericRating,
    text: checked.text,
  });
  await syncUserProgress(req.session.user.id);

  req.flash(
    'success',
    checked.masked
      ? 'Dziękujemy za opinię! Niedozwolone słowa zostały w niej zamaskowane.'
      : 'Dziękujemy za dodanie opinii!'
  );
  res.redirect(`/games/${gameId}`);
});

/* --------------------- EDYCJA, USUWANIE, KOMENTARZE, LAJKI --------------------- */

router.post('/:id/reviews/:reviewId/edit', ensureAuthenticated, blockIfMuted, limiters.review, async (req, res, next) => {
  const gameId = String(req.params.id);
  const review = await Review.findByPk(req.params.reviewId);
  if (!review || String(review.gameId) !== gameId) return next();
  const back = backTo(req, `/games/${gameId}`);

  if (review.userId !== req.session.user.id) {
    req.flash('error', 'Możesz edytować tylko swoje opinie.');
    return res.redirect(back);
  }

  const { rating, text } = req.body;
  const numericRating = Number(rating);

  if (!isValidRating(numericRating) || !text) {
    req.flash('error', 'Podaj ocenę (0.5-5, co pół gwiazdki) oraz treść opinii.');
    return res.redirect(back);
  }

  const checked = moderateText(text, { userId: req.session.user.id, duplicates: false });
  if (!checked.ok) {
    req.flash('error', checked.error);
    return res.redirect(back);
  }

  review.rating = numericRating;
  review.text = checked.text;
  review.editedAt = new Date();
  await review.save();

  req.flash('success', 'Opinia została zaktualizowana.');
  res.redirect(back);
});

router.post('/:id/reviews/:reviewId/delete', ensureAuthenticated, async (req, res, next) => {
  const gameId = String(req.params.id);
  const review = await Review.findByPk(req.params.reviewId);
  if (!review || String(review.gameId) !== gameId) return next();
  const back = backTo(req, `/games/${gameId}`);

  const isOwner = review.userId === req.session.user.id;
  const isAdmin = req.session.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    req.flash('error', 'Możesz usuwać tylko swoje opinie.');
    return res.redirect(back);
  }

  await deleteReviewData(review.id);
  await review.destroy();
  await syncUserProgress(review.userId);

  req.flash('success', 'Opinia została usunięta.');
  res.redirect(back);
});

router.post('/:id/reviews/:reviewId/like', ensureAuthenticated, limiters.like, async (req, res) => {
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

/* Komentarze pod recenzją (JSON) - używane na stronie głównej i w liście recenzji. */
router.get('/:id/reviews/:reviewId/comments', async (req, res) => {
  const meId = req.session.user ? req.session.user.id : null;
  const comments = await getCommentsForReview(req.params.reviewId, meId);
  res.json({
    comments: comments.map((c) => ({
      id: c.id,
      username: c.username,
      text: c.text,
      createdAt: c.createdAt,
      likeCount: c.likeCount,
      liked: c.liked,
    })),
  });
});

router.post('/:id/reviews/:reviewId/comments', ensureAuthenticated, blockIfMuted, limiters.comment, async (req, res, next) => {
  const gameId = String(req.params.id);
  const wantsJson = wantsJsonResponse(req);

  const text = (req.body.text || '').trim();
  if (!text) {
    if (wantsJson) return res.status(400).json({ error: 'Komentarz nie może być pusty.' });
    req.flash('error', 'Komentarz nie może być pusty.');
    return res.redirect(`/games/${gameId}`);
  }

  const checked = moderateText(text.slice(0, 500), { userId: req.session.user.id });
  if (!checked.ok) {
    if (wantsJson) return res.status(400).json({ error: checked.error });
    req.flash('error', checked.error);
    return res.redirect(`/games/${gameId}#review-${req.params.reviewId}`);
  }

  const created = await addComment({
    reviewId: req.params.reviewId,
    userId: req.session.user.id,
    username: req.session.user.username,
    text: checked.text,
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

  if (wantsJson) {
    return res.json({
      ok: true,
      comment: {
        id: created.id,
        username: created.username,
        text: created.text,
        createdAt: created.createdAt,
        likeCount: 0,
        liked: false,
      },
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

router.post('/:id/reviews/:reviewId/comments/:commentId/like', ensureAuthenticated, limiters.like, async (req, res) => {
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

router.post('/:id/reviews/:reviewId/report', ensureAuthenticated, limiters.report, async (req, res, next) => {
  try {
    const gameId = String(req.params.id);
    const back = `/games/${gameId}#review-${req.params.reviewId}`;

    const review = await Review.findByPk(req.params.reviewId);
    if (!review || String(review.gameId) !== gameId) return next();

    if (review.userId === req.session.user.id) {
      req.flash('error', 'Nie możesz zgłosić własnej opinii.');
      return res.redirect(back);
    }

    const reason = findReason(req.body.reason);
    if (!reason) {
      req.flash('error', 'Wybierz powód zgłoszenia.');
      return res.redirect(back);
    }

    const comment = String(req.body.comment || '').trim().slice(0, MAX_COMMENT_LENGTH);
    if (reason.id === 'other' && comment.length < 5) {
      req.flash('error', 'Przy powodzie "Inny" opisz krótko, o co chodzi.');
      return res.redirect(back);
    }

    await reportReview({
      reviewId: review.id,
      reporterId: req.session.user.id,
      reason: reason.label,
      category: reason.id,
      comment,
    });

    req.flash('success', 'Dziękujemy za zgłoszenie. Opinia trafiła do weryfikacji przez administratorów.');
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

module.exports = router;