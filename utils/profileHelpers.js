/**
 * Drobne operacje na koncie użytkownika, których nie ma w utils/userHelpers.js
 * (nie modyfikujemy tamtego pliku - tylko go uzupełniamy z zewnątrz).
 *
 * UWAGA: użytkownicy i recenzje żyją teraz w bazie danych (Sequelize),
 * nie w plikach data/*.json.
 */
const { Op } = require('sequelize');
const User = require('../models/User');
const Review = require('../models/Review');
const ReviewLike = require('../models/ReviewLike');
const ReviewComment = require('../models/ReviewComment');
const ReviewReport = require('../models/ReviewReport');
const CommentLike = require('../models/CommentLike');
const Follow = require('../models/Follow');
const { deleteReviewData } = require('./reviewSocialHelpers');
const { removeUserFromConversations } = require('./chatHelpers');
const Notification = require('../models/Notification');
const FavoriteGame = require('../models/FavoriteGame');

/** Zwraca dane użytkownika bezpieczne do wyświetlenia (bez hasha i tokenów). */
function getUserPublic(user) {
  if (!user) return null;
  const { passwordHash, resetPasswordToken, resetPasswordExpires, ...safe } =
    user;
  return safe;
}

/** Zmienia nazwę użytkownika, o ile nowa nazwa nie jest zajęta. */
async function updateUsername(userId, newUsername) {
  const userInstance = await User.findByPk(userId);
  if (!userInstance) return { ok: false, reason: 'not_found' };

  const existing = await User.findOne({
    where: require('sequelize').where(
      require('sequelize').fn('lower', require('sequelize').col('username')),
      newUsername.toLowerCase()
    ),
  });
  if (existing && existing.id !== userId) {
    return { ok: false, reason: 'taken' };
  }

  userInstance.username = newUsername;
  await userInstance.save();

  // Utrzymujemy spójność nazwy użytkownika w istniejących recenzjach.
  await Review.update({ username: newUsername }, { where: { userId } });

  return { ok: true, user: userInstance.get({ plain: true }) };
}

/**
 * Usuwa konto użytkownika razem z jego danymi: recenzjami (wraz z ich
 * polubieniami, komentarzami i zgłoszeniami), własnymi polubieniami i
 * komentarzami, zgłoszeniami, obserwowaniem, ulubionymi grami oraz czatami
 * (zob. removeUserFromConversations).
 */
async function deleteUser(userId) {
  const user = await User.findByPk(userId);
  if (!user) return false;

  const reviews = await Review.findAll({ where: { userId } });
  for (const review of reviews) {
    await deleteReviewData(review.id);
  }
  await Review.destroy({ where: { userId } });

  const ownComments = await ReviewComment.findAll({ where: { userId } });
  const ownCommentIds = ownComments.map((c) => c.id);
  if (ownCommentIds.length) await CommentLike.destroy({ where: { commentId: ownCommentIds } });
  await ReviewComment.destroy({ where: { userId } });

  await Promise.all([
    ReviewLike.destroy({ where: { userId } }),
    CommentLike.destroy({ where: { userId } }),
    ReviewReport.destroy({ where: { reporterId: userId } }),
    Follow.destroy({ where: { [Op.or]: [{ followerId: userId }, { followingId: userId }] } }),
    FavoriteGame.destroy({ where: { userId } }),
    Notification.destroy({ where: { [Op.or]: [{ userId }, { actorId: userId }] } }),
  ]);

  await removeUserFromConversations(userId);

  const count = await User.destroy({ where: { id: userId } });
  return count > 0;
}

module.exports = { getUserPublic, updateUsername, deleteUser };