const Review = require('../models/Review');
const {
  levelProgress,
  pointsFromStats,
  allFramesWithLockState,
  allBackgroundsWithLockState,
  allBadgesWithLockState,
} = require('./pointsHelpers');
const { getFollowers, getFollowing } = require('./socialHelpers');
const { getUserBacklog } = require('./backlogHelpers');
const { getAllGames } = require('./gameHelpers');
const { getUserPublic } = require('./profileHelpers');
const { saveProgress } = require('./progressHelpers');
const { findById } = require('./userHelpers');

/** Buduje pełny model widoku (statystyki + gamifikacja) dla danego użytkownika. */
async function buildProfileViewModel(user) {
  const [reviewRows, followers, following] = await Promise.all([
    Review.findAll({ where: { userId: user.id } }),
    getFollowers(user.id),
    getFollowing(user.id),
  ]);

  const reviews = reviewRows
    .map((r) => r.get({ plain: true }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const stats = {
    reviewCount: reviews.length,
    commentCount: 0,
    likesReceived: 0,
    followersCount: followers.length,
    followingCount: following.length,
    bonusPoints: user.bonusPoints || 0,
  };

  const progress = levelProgress(pointsFromStats(stats));

  // Odświeża zapisane w bazie PD i poziom, jeśli się zdezaktualizowały.
  await saveProgress(user.id, progress.points, progress.level, user);

  return {
    profileUser: getUserPublic({ ...user, points: progress.points, level: progress.level }),
    stats,
    progress,
    allFrames: allFramesWithLockState(progress.level),
    allBackgrounds: allBackgroundsWithLockState(progress.level),
    allBadges: allBadgesWithLockState(stats),
    reviews,
  };
}

/** Lista osób, które użytkownik obserwuje (kind = 'following') lub które jego obserwują ('followers'). */
async function buildFollowList(userId, kind) {
  const rows = kind === 'followers' ? await getFollowers(userId) : await getFollowing(userId);
  const ids = rows.map((r) => (kind === 'followers' ? r.followerId : r.followingId));
  const users = (await Promise.all(ids.map((id) => findById(id)))).filter(Boolean);

  return users.map((u) => ({
    id: u.id,
    username: u.username,
    avatarUrl: u.avatarUrl || null,
    level: u.level || 1,
  }));
}

async function buildBacklog(userId) {
  const games = getAllGames();
  const entries = await getUserBacklog(userId);
  return entries.map((entry) => ({
    ...entry,
    game: games.find((g) => g.id === entry.gameId) || null,
  }));
}

module.exports = { buildProfileViewModel, buildBacklog, buildFollowList };