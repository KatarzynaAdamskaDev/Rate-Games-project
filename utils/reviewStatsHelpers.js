/**
 * Statystyki i rankingi recenzji (strona /reviews i strona główna).
 * Dane o recenzjach pochodzą z bazy, a informacje o grach (tytuł, okładka)
 * z katalogu gier (IGDB) - zob. utils/gameCatalog.js.
 */
const { fn, col } = require('sequelize');
const Review = require('../models/Review');
const ReviewLike = require('../models/ReviewLike');
const ReviewComment = require('../models/ReviewComment');
const User = require('../models/User');
const { getGamesByIds } = require('./gameCatalog');

const DAY_MS = 24 * 60 * 60 * 1000;
const FEED_PAGE_SIZE = 10;
const FEED_SORTS = ['newest', 'oldest', 'rating', 'lowest', 'likes', 'comments'];

async function loadReviews({ sinceDays } = {}) {
  const rows = await Review.findAll();
  const since = sinceDays ? Date.now() - sinceDays * DAY_MS : null;
  return rows
    .map((r) => r.get({ plain: true }))
    .filter((r) => !since || new Date(r.createdAt).getTime() >= since);
}

/** Zwraca mapy reviewId -> liczba polubień / komentarzy. */
async function getSocialCounts(reviewIds) {
  const empty = { likes: new Map(), comments: new Map() };
  if (reviewIds.length === 0) return empty;

  const count = (Model) =>
    Model.findAll({
      attributes: ['reviewId', [fn('COUNT', col('id')), 'total']],
      where: { reviewId: reviewIds },
      group: ['reviewId'],
      raw: true,
    });

  const [likeRows, commentRows] = await Promise.all([count(ReviewLike), count(ReviewComment)]);
  return {
    likes: new Map(likeRows.map((r) => [r.reviewId, Number(r.total)])),
    comments: new Map(commentRows.map((r) => [r.reviewId, Number(r.total)])),
  };
}

/** Zbiór identyfikatorów recenzji polubionych przez danego użytkownika. */
async function getLikedReviewIds(reviewIds, userId) {
  if (!userId || reviewIds.length === 0) return new Set();
  const rows = await ReviewLike.findAll({
    where: { reviewId: reviewIds, userId },
    attributes: ['reviewId'],
    raw: true,
  });
  return new Set(rows.map((r) => r.reviewId));
}

/**
 * Dokleja do recenzji: grę, autora (awatar, poziom), liczbę polubień i komentarzy
 * oraz (dla zalogowanego przeglądającego) informację, czy recenzja jest przez niego polubiona.
 */
async function enrichReviews(reviews, viewerId = null) {
  if (reviews.length === 0) return [];

  const [games, users, counts, likedIds] = await Promise.all([
    getGamesByIds(reviews.map((r) => r.gameId)),
    User.findAll({
      where: { id: [...new Set(reviews.map((r) => r.userId))] },
      attributes: ['id', 'username', 'avatarUrl', 'level'],
    }),
    getSocialCounts(reviews.map((r) => r.id)),
    getLikedReviewIds(reviews.map((r) => r.id), viewerId),
  ]);
  const usersById = new Map(users.map((u) => [u.id, u]));

  return reviews.map((r) => {
    const author = usersById.get(r.userId);
    return {
      ...r,
      game: games.get(String(r.gameId)) || null,
      author: author
        ? { avatarUrl: author.avatarUrl || null, level: author.level || 1 }
        : { avatarUrl: null, level: 1 },
      likeCount: counts.likes.get(r.id) || 0,
      commentCount: counts.comments.get(r.id) || 0,
      liked: likedIds.has(r.id),
    };
  });
}

/** Grupuje recenzje po grze: { gameId, reviewCount, averageRating }. */
function groupByGame(reviews) {
  const groups = new Map();
  reviews.forEach((r) => {
    const g = groups.get(r.gameId) || { gameId: r.gameId, reviewCount: 0, sum: 0 };
    g.reviewCount += 1;
    g.sum += Number(r.rating);
    groups.set(r.gameId, g);
  });
  return [...groups.values()].map((g) => ({
    gameId: g.gameId,
    reviewCount: g.reviewCount,
    averageRating: Math.round((g.sum / g.reviewCount) * 10) / 10,
  }));
}

async function attachGames(rankedGroups) {
  const games = await getGamesByIds(rankedGroups.map((g) => g.gameId));
  return rankedGroups
    .filter((g) => games.has(String(g.gameId)))
    .map((g) => ({
      ...games.get(String(g.gameId)),
      reviewCount: g.reviewCount,
      averageRating: g.averageRating,
    }));
}

/** Gry z największą liczbą recenzji (opcjonalnie tylko z ostatnich `sinceDays` dni). */
async function getMostReviewedGames(limit = 10, sinceDays = null) {
  const reviews = await loadReviews({ sinceDays });
  const ranked = groupByGame(reviews)
    .sort((a, b) => b.reviewCount - a.reviewCount || b.averageRating - a.averageRating)
    .slice(0, limit);
  return attachGames(ranked);
}

/** Gry z najwyższą średnią oceną (co najmniej `minReviews` recenzji). */
async function getTopRatedGames(limit = 10, minReviews = 1) {
  const reviews = await loadReviews();
  const ranked = groupByGame(reviews)
    .filter((g) => g.reviewCount >= minReviews)
    .sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount)
    .slice(0, limit);
  return attachGames(ranked);
}

/** Zbiorcze statystyki do nagłówków stron. */
async function getOverallStats() {
  const reviews = await loadReviews();
  const weekAgo = Date.now() - 7 * DAY_MS;
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);

  return {
    totalReviews: reviews.length,
    totalReviewers: new Set(reviews.map((r) => r.userId)).size,
    gamesWithReviews: new Set(reviews.map((r) => r.gameId)).size,
    averageRating: reviews.length ? Math.round((sum / reviews.length) * 10) / 10 : null,
    reviewsThisWeek: reviews.filter((r) => new Date(r.createdAt).getTime() >= weekAgo).length,
    totalUsers: await User.count(),
  };
}

/** Ranking najaktywniejszych recenzentów. */
async function getTopReviewers(limit = 6) {
  const reviews = await loadReviews();
  const counts = new Map();
  reviews.forEach((r) => counts.set(r.userId, (counts.get(r.userId) || 0) + 1));

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const users = await User.findAll({
    where: { id: top.map(([id]) => id) },
    attributes: ['id', 'username', 'avatarUrl', 'level'],
  });
  const usersById = new Map(users.map((u) => [u.id, u]));

  return top
    .filter(([id]) => usersById.has(id))
    .map(([id, reviewCount]) => {
      const u = usersById.get(id);
      return { username: u.username, avatarUrl: u.avatarUrl || null, level: u.level || 1, reviewCount };
    });
}

/**
 * Lista wszystkich recenzji z sortowaniem, filtrem oceny i stronicowaniem.
 * @returns {{ items: object[], total: number, page: number, pages: number, sort: string }}
 */
async function getReviewFeed({ sort, rating, page, viewerId } = {}) {
  const activeSort = FEED_SORTS.includes(sort) ? sort : 'newest';
  const ratingFilter = Number(rating);

  let reviews = await loadReviews();
  if (ratingFilter >= 1 && ratingFilter <= 5) {
    reviews = reviews.filter((r) => Math.round(Number(r.rating)) === ratingFilter);
  }

  // Sortowanie po polubieniach/komentarzach wymaga policzenia ich dla wszystkich recenzji.
  const counts = await getSocialCounts(reviews.map((r) => r.id));
  const likes = (r) => counts.likes.get(r.id) || 0;
  const comments = (r) => counts.comments.get(r.id) || 0;
  const byDate = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

  const sorters = {
    newest: byDate,
    oldest: (a, b) => -byDate(a, b),
    rating: (a, b) => b.rating - a.rating || byDate(a, b),
    lowest: (a, b) => a.rating - b.rating || byDate(a, b),
    likes: (a, b) => likes(b) - likes(a) || byDate(a, b),
    comments: (a, b) => comments(b) - comments(a) || byDate(a, b),
  };
  reviews.sort(sorters[activeSort]);

  const pages = Math.max(1, Math.ceil(reviews.length / FEED_PAGE_SIZE));
  const activePage = Math.min(Math.max(parseInt(page, 10) || 1, 1), pages);
  const slice = reviews.slice((activePage - 1) * FEED_PAGE_SIZE, activePage * FEED_PAGE_SIZE);

  return {
    items: await enrichReviews(slice, viewerId),
    total: reviews.length,
    page: activePage,
    pages,
    sort: activeSort,
  };
}

/**
 * Najlepsza recenzja tygodnia: spośród recenzji z ostatnich 7 dni wygrywa ta z
 * największą liczbą polubień i komentarzy (przy remisie - wyższa ocena, dłuższy
 * tekst, nowsza). Gdy w tym tygodniu nikt nic nie napisał, zwracamy najlepszą
 * recenzję ze wszystkich (flaga `fromThisWeek: false`).
 */
async function getReviewOfTheWeek(viewerId = null) {
  const all = await loadReviews();
  if (all.length === 0) return null;

  const weekAgo = Date.now() - 7 * DAY_MS;
  const recent = all.filter((r) => new Date(r.createdAt).getTime() >= weekAgo);
  const pool = recent.length > 0 ? recent : all;

  const counts = await getSocialCounts(pool.map((r) => r.id));
  const score = (r) =>
    (counts.likes.get(r.id) || 0) * 3 +
    (counts.comments.get(r.id) || 0) * 2 +
    Number(r.rating) * 0.5 +
    Math.min(r.text.length / 200, 2);

  const best = pool.slice().sort(
    (a, b) => score(b) - score(a) || new Date(b.createdAt) - new Date(a.createdAt)
  )[0];

  const [enriched] = await enrichReviews([best], viewerId);
  return { ...enriched, fromThisWeek: recent.length > 0 };
}

module.exports = {
  FEED_SORTS,
  enrichReviews,
  getMostReviewedGames,
  getTopRatedGames,
  getOverallStats,
  getTopReviewers,
  getReviewFeed,
  getReviewOfTheWeek,
};
