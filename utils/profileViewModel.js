const Review = require('../models/Review');
const {
  levelProgress,
  pointsFromStats,
  allFramesWithLockState,
  allBackgroundsWithLockState,
  allBadgesWithLockState,
  resolveTrophy,
} = require('./pointsHelpers');
const { getFollowers, getFollowing } = require('./socialHelpers');
const { getUserPublic } = require('./profileHelpers');
const { saveProgress } = require('./progressHelpers');
const { findById } = require('./userHelpers');
const { getFavorites } = require('./favoriteHelpers');

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
    trophy: resolveTrophy(user.activeTrophy, stats),
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

const PROFILE_TABS = ['favorites', 'reviews', 'followers', 'following'];

function normalizeProfileTab(tab) {
  return PROFILE_TABS.includes(tab) ? tab : 'favorites';
}

/** Dane potrzebne tylko aktywnej zakładce profilu (reszty nie pobieramy). */
async function buildTabData(userId, tab) {
  return {
    favorites: tab === 'favorites' ? await getFavorites(userId) : [],
    followList:
      tab === 'followers' || tab === 'following' ? await buildFollowList(userId, tab) : [],
  };
}

module.exports = {
  buildProfileViewModel,
  buildFollowList,
  buildTabData,
  normalizeProfileTab,
};