const ReviewLike = require('../models/ReviewLike');
const ReviewComment = require('../models/ReviewComment');
const ReviewReport = require('../models/ReviewReport');

/** Przełącza polubienie (like/unlike) i zwraca nowy stan. */
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

async function getCommentsForReview(reviewId) {
  const rows = await ReviewComment.findAll({ where: { reviewId } });
  return rows
    .map((r) => r.get({ plain: true }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function addComment({ reviewId, userId, username, text }) {
  const instance = await ReviewComment.create({ reviewId, userId, username, text });
  return instance.get({ plain: true });
}

/** Zapisuje zgłoszenie opinii do (przyszłej) kolejki moderacji administratora. */
async function reportReview({ reviewId, reporterId, reason }) {
  const existing = await ReviewReport.findOne({
    where: { reviewId, reporterId, status: 'pending' },
  });
  if (existing) return existing.get({ plain: true }); // nie duplikuj zgłoszeń

  const instance = await ReviewReport.create({
    reviewId,
    reporterId,
    reason: reason || null,
  });
  return instance.get({ plain: true });
}

/** Sprząta polubienia/komentarze/zgłoszenia powiązane z usuwaną opinią. */
async function deleteReviewData(reviewId) {
  await Promise.all([
    ReviewLike.destroy({ where: { reviewId } }),
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
  reportReview,
  deleteReviewData,
};