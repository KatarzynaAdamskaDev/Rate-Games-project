/**
 * Sprzątanie danych po kontach, których już nie ma w bazie (np. usuniętych starszą
 * wersją aplikacji, która kasowała tylko wiersz użytkownika). Uruchamiane przy starcie.
 */
const User = require('../models/User');
const Review = require('../models/Review');
const ReviewLike = require('../models/ReviewLike');
const ReviewComment = require('../models/ReviewComment');
const CommentLike = require('../models/CommentLike');
const ReviewReport = require('../models/ReviewReport');
const ContentReport = require('../models/ContentReport');
const UserBlock = require('../models/UserBlock');
const Follow = require('../models/Follow');
const FavoriteGame = require('../models/FavoriteGame');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const ConversationRead = require('../models/ConversationRead');
const { purgeUserData } = require('./profileHelpers');

/** Identyfikatory użytkowników, do których odwołują się dane, ale których konta nie ma. */
async function findOrphanUserIds() {
  const existing = new Set((await User.findAll({ attributes: ['id'] })).map((u) => u.id));
  const referenced = new Set();

  const collect = async (Model, field) => {
    const rows = await Model.findAll({ attributes: [field], raw: true });
    rows.forEach((row) => row[field] && referenced.add(row[field]));
  };

  await collect(Review, 'userId');
  await collect(ReviewLike, 'userId');
  await collect(ReviewComment, 'userId');
  await collect(CommentLike, 'userId');
  await collect(ReviewReport, 'reporterId');
  await collect(ContentReport, 'reporterId');
  await collect(ContentReport, 'targetUserId');
  await collect(UserBlock, 'blockerId');
  await collect(UserBlock, 'blockedId');
  await collect(Follow, 'followerId');
  await collect(Follow, 'followingId');
  await collect(FavoriteGame, 'userId');
  await collect(Notification, 'userId');
  await collect(Notification, 'actorId');
  await collect(Message, 'senderId');
  await collect(ConversationRead, 'userId');

  const conversations = await Conversation.findAll({ attributes: ['memberIds', 'ownerId'] });
  conversations.forEach((c) => {
    JSON.parse(c.memberIds || '[]').forEach((id) => referenced.add(id));
    if (c.ownerId) referenced.add(c.ownerId);
  });

  return [...referenced].filter((id) => !existing.has(id));
}

/** Usuwa dane nieistniejących kont. @returns {Promise<number>} liczba oczyszczonych kont */
async function purgeOrphanedData() {
  const orphanIds = await findOrphanUserIds();
  for (const userId of orphanIds) {
    await purgeUserData(userId);
  }
  return orphanIds.length;
}

module.exports = { findOrphanUserIds, purgeOrphanedData };
