const { readCollection } = require('./dataStore');
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
  const reviews = readCollection('reviews')
    .filter((r) => r.username === user.username)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const [followers, following] = await Promise.all([
    getFollowers(user.id),
    getFollowing(user.id),
  ]);

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

function buildBacklog(userId) {
  const games = getAllGames();
  return getUserBacklog(userId).map((entry) => ({
    ...entry,
    game: games.find((g) => g.id === entry.gameId) || null,
  }));
}

module.exports = { buildProfileViewModel, buildBacklog };