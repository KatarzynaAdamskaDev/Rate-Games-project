const Follow = require('../models/Follow');

async function isFollowing(followerId, followingId) {
  const existing = await Follow.findOne({ where: { followerId, followingId } });
  return !!existing;
}

async function follow(followerId, followingId) {
  if (followerId === followingId) return false;
  const already = await isFollowing(followerId, followingId);
  if (already) return false;

  await Follow.create({ followerId, followingId });
  return true;
}

async function unfollow(followerId, followingId) {
  const count = await Follow.destroy({ where: { followerId, followingId } });
  return count > 0;
}

async function getFollowers(userId) {
  const rows = await Follow.findAll({ where: { followingId: userId } });
  return rows.map((r) => r.get({ plain: true }));
}

async function getFollowing(userId) {
  const rows = await Follow.findAll({ where: { followerId: userId } });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * Zwraca ID użytkowników, którzy są WZAJEMNymi obserwującymi (Ty ich
 * obserwujesz ORAZ oni obserwują Ciebie) - to jest nasza definicja "znajomego".
 */
async function getMutualFriends(userId) {
  const [followingRows, followerRows] = await Promise.all([
    getFollowing(userId),
    getFollowers(userId),
  ]);
  const followingIds = new Set(followingRows.map((r) => r.followingId));
  const followerIds = new Set(followerRows.map((r) => r.followerId));
  return [...followingIds].filter((id) => followerIds.has(id));
}

module.exports = {
  isFollowing,
  follow,
  unfollow,
  getFollowers,
  getFollowing,
  getMutualFriends,
};