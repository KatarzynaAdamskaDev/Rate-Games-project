const Review = require('../models/Review');
const ReviewLike = require('../models/ReviewLike');
const { enrichReviews } = require('./reviewStatsHelpers');
const {
  levelProgress,
  pointsFromStats,
  allFramesWithLockState,
  allBackgroundsWithLockState,
  allBadgesWithLockState,
  resolveTrophy,
  THEMES,
  themeForBackground,
} = require('./pointsHelpers');
const { getFollowers, getFollowing } = require('./socialHelpers');
const { getUserPublic } = require('./profileHelpers');
const { saveProgress } = require('./progressHelpers');
const { findById } = require('./userHelpers');
const { getFavorites } = require('./favoriteHelpers');

/** Buduje pełny model widoku (statystyki + gamifikacja) dla danego użytkownika. */
async function buildProfileViewModel(user) {
  const [reviewRows, followers, following] = await Promise.all([
    Review.findAll({ where: { userId: user.id }, attributes: ['id'] }),
    getFollowers(user.id),
    getFollowing(user.id),
  ]);

  const reviewIds = reviewRows.map((r) => r.id);
  const likesReceived =
    reviewIds.length > 0 ? await ReviewLike.count({ where: { reviewId: reviewIds } }) : 0;

  const stats = {
    reviewCount: reviewIds.length,
    commentCount: 0,
    likesReceived,
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
    allFrames: allFramesWithLockState(progress.level, !!user.unlockAll),
    allBackgrounds: allBackgroundsWithLockState(progress.level, !!user.unlockAll),
    allBadges: allBadgesWithLockState(stats, !!user.unlockAll),
    theme: themeForBackground(user.activeBackground),
    themes: THEMES.map((t) => ({ ...t, locked: !user.unlockAll && t.levelRequired > progress.level })),
    trophy: resolveTrophy(user.activeTrophy, stats, !!user.unlockAll, themeForBackground(user.activeBackground).accent),
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

/**
 * Recenzje danego użytkownika, wzbogacone tak samo jak na stronie /reviews (gra, autor,
 * polubienia, komentarze) - viewerId to osoba PRZEGLĄDAJĄCA profil (do stanu "polubione przeze mnie"),
 * nie właściciel profilu.
 */
async function buildProfileReviews(userId, viewerId) {
  const rows = await Review.findAll({ where: { userId } });
  const plain = rows.map((r) => r.get({ plain: true }));
  const enriched = await enrichReviews(plain, viewerId);
  return enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Dane potrzebne tylko aktywnej zakładce profilu (reszty nie pobieramy). */
async function buildTabData(userId, tab, viewerId = null) {
  return {
    favorites: tab === 'favorites' ? await getFavorites(userId) : [],
    followList:
      tab === 'followers' || tab === 'following' ? await buildFollowList(userId, tab) : [],
    reviews: tab === 'reviews' ? await buildProfileReviews(userId, viewerId) : [],
  };
}

module.exports = {
  buildProfileViewModel,
  buildFollowList,
  buildTabData,
  normalizeProfileTab,
};