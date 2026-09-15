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
  };

  const progress = levelProgress(pointsFromStats(stats));

  return {
    profileUser: getUserPublic(user),
    stats,
    progress,
    allFrames: allFramesWithLockState(progress.level),
    allBackgrounds: allBackgroundsWithLockState(progress.level),
    allBadges: allBadgesWithLockState(stats),
    reviews,
  };
}

async function buildBacklog(userId) {
  const games = getAllGames();
  const entries = await getUserBacklog(userId);
  return entries.map((entry) => ({
    ...entry,
    game: games.find((g) => g.id === entry.gameId) || null,
  }));
}

module.exports = { buildProfileViewModel, buildBacklog };