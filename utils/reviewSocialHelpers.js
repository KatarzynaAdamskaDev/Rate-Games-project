const ReviewLike = require('../models/ReviewLike');
const ReviewComment = require('../models/ReviewComment');
const ReviewReport = require('../models/ReviewReport');
const CommentLike = require('../models/CommentLike');

/* ------------------------------ RECENZJE: LAJKI ------------------------------ */

/** Przełącza polubienie (like/unlike) recenzji i zwraca nowy stan. */
async function toggleLike(reviewId, userId) {
  const existing = await ReviewLike.findOne({ where: { reviewId, userId } });
  if (existing) {
    await existing.destroy();
    return { liked: false };
  }
  await ReviewLike.create({ reviewId, userId });
  return { liked: true };
}

async function getLikeCount(reviewId) {
  return ReviewLike.count({ where: { reviewId } });
}

async function hasLiked(reviewId, userId) {
  if (!userId) return false;
  const existing = await ReviewLike.findOne({ where: { reviewId, userId } });
  return !!existing;
}

/* ------------------------------ KOMENTARZE ------------------------------ */

async function getCommentsForReview(reviewId, currentUserId) {
  const rows = await ReviewComment.findAll({ where: { reviewId } });
  // Komentarze osób zablokowanych przez oglądającego są ukryte (utils/blockHelpers.js).
  const blocked = new Set(await require('./blockHelpers').getBlockedIds(currentUserId));
  const comments = rows
    .map((r) => r.get({ plain: true }))
    .filter((c) => !blocked.has(c.userId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return Promise.all(
    comments.map(async (c) => ({
      ...c,
      likeCount: await getCommentLikeCount(c.id),
      liked: await hasLikedComment(c.id, currentUserId),
    }))
  );
}

async function addComment({ reviewId, userId, username, text }) {
  const instance = await ReviewComment.create({ reviewId, userId, username, text });
  return instance.get({ plain: true });
}

/** Usuwa komentarz - tylko jeśli userId jest jego autorem. */
async function deleteComment(commentId, userId) {
  const comment = await ReviewComment.findByPk(commentId);
  if (!comment) return false;
  if (comment.userId !== userId) return false;

  await CommentLike.destroy({ where: { commentId } });
  await comment.destroy();
  return true;
}

/* ------------------------------ KOMENTARZE: LAJKI ------------------------------ */

async function toggleCommentLike(commentId, userId) {
  const existing = await CommentLike.findOne({ where: { commentId, userId } });
  if (existing) {
    await existing.destroy();
    return { liked: false };
  }
  await CommentLike.create({ commentId, userId });
  return { liked: true };
}

async function getCommentLikeCount(commentId) {
  return CommentLike.count({ where: { commentId } });
}

async function hasLikedComment(commentId, userId) {
  if (!userId) return false;
  const existing = await CommentLike.findOne({ where: { commentId, userId } });
  return !!existing;
}

/* ------------------------------ ZGŁOSZENIA ------------------------------ */

/** Zapisuje zgłoszenie opinii do kolejki moderacji administratora. */
async function reportReview({ reviewId, reporterId, reason, category, comment }) {
  const existing = await ReviewReport.findOne({
    where: { reviewId, reporterId, status: 'pending' },
  });
  if (existing) return existing.get({ plain: true }); // nie duplikuj zgłoszeń

  const instance = await ReviewReport.create({
    reviewId,
    reporterId,
    reason: reason || null,
    category: category || null,
    comment: comment || null,
  });
  return instance.get({ plain: true });
}

/** Sprząta polubienia/komentarze/zgłoszenia powiązane z usuwaną opinią. */
async function deleteReviewData(reviewId) {
  const comments = await ReviewComment.findAll({ where: { reviewId } });
  const commentIds = comments.map((c) => c.id);

  await Promise.all([
    ReviewLike.destroy({ where: { reviewId } }),
    commentIds.length
      ? CommentLike.destroy({ where: { commentId: commentIds } })
      : Promise.resolve(),
    ReviewComment.destroy({ where: { reviewId } }),
    ReviewReport.destroy({ where: { reviewId } }),
  ]);
}

module.exports = {
  toggleLike,
  getLikeCount,
  hasLiked,
  getCommentsForReview,
  addComment,
  deleteComment,
  toggleCommentLike,
  getCommentLikeCount,
  hasLikedComment,
  reportReview,
  deleteReviewData,
};