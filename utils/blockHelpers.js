/**
 * Blokowanie użytkowników przez użytkowników (nie mylić z blokadą konta przez administratora).
 * Zablokowanie osoby:
 *  - ukrywa jej komentarze pod recenzjami,
 *  - uniemożliwia jej pisanie do Ciebie na czacie i obserwowanie Ciebie (oraz odwrotnie,
 *    dopóki jej nie odblokujesz),
 *  - kasuje wzajemne obserwowanie,
 *  - wycisza jej powiadomienia.
 */
const { Op } = require('sequelize');
const UserBlock = require('../models/UserBlock');
const User = require('../models/User');
const Follow = require('../models/Follow');

/** Id użytkowników zablokowanych przez `userId`. */
async function getBlockedIds(userId) {
  if (!userId) return [];
  const rows = await UserBlock.findAll({ where: { blockerId: userId }, attributes: ['blockedId'] });
  return rows.map((r) => r.blockedId);
}

async function hasBlocked(blockerId, blockedId) {
  if (!blockerId || !blockedId) return false;
  return !!(await UserBlock.findOne({ where: { blockerId, blockedId } }));
}

/** Czy któraś ze stron zablokowała drugą. */
async function isBlockedEitherWay(userA, userB) {
  if (!userA || !userB) return false;
  const row = await UserBlock.findOne({
    where: {
      [Op.or]: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
  });
  return !!row;
}

async function blockUser(blockerId, blockedId) {
  if (blockerId === blockedId) return false;
  const [, created] = await UserBlock.findOrCreate({ where: { blockerId, blockedId } });
  // Zablokowani przestają się wzajemnie obserwować.
  await Follow.destroy({
    where: {
      [Op.or]: [
        { followerId: blockerId, followingId: blockedId },
        { followerId: blockedId, followingId: blockerId },
      ],
    },
  });
  return created;
}

async function unblockUser(blockerId, blockedId) {
  const count = await UserBlock.destroy({ where: { blockerId, blockedId } });
  return count > 0;
}

/** Lista zablokowanych do ekranu ustawień: [{ id, username, avatarUrl, blockedAt }]. */
async function listBlockedUsers(userId) {
  const rows = await UserBlock.findAll({ where: { blockerId: userId }, order: [['createdAt', 'DESC']] });
  if (rows.length === 0) return [];
  const users = await User.findAll({ where: { id: rows.map((r) => r.blockedId) }, attributes: ['id', 'username', 'avatarUrl'] });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows
    .filter((r) => byId.has(r.blockedId))
    .map((r) => ({
      id: r.blockedId,
      username: byId.get(r.blockedId).username,
      avatarUrl: byId.get(r.blockedId).avatarUrl || null,
      blockedAt: r.createdAt,
    }));
}

module.exports = {
  getBlockedIds,
  hasBlocked,
  isBlockedEitherWay,
  blockUser,
  unblockUser,
  listBlockedUsers,
};
