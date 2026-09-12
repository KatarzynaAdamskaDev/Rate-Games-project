const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { ensureAuthenticated } = require('../middleware/auth');
const {
  findById,
  findByUsername,
  updatePassword,
} = require('../utils/userHelpers');
const { getUserPublic, updateUsername, deleteUser } = require('../utils/profileHelpers');
const { readCollection } = require('../utils/dataStore');
const {
  levelProgress,
  pointsFromStats,
  allFramesWithLockState,
  allBackgroundsWithLockState,
  allBadgesWithLockState,
} = require('../utils/pointsHelpers');
const {
  follow,
  unfollow,
  isFollowing,
  getFollowers,
  getFollowing,
} = require('../utils/socialHelpers');
const {
  getUserBacklog,
  setStatus,
  STATUSES,
  STATUS_LABELS,
} = require('../utils/backlogHelpers');
const { getAllGames } = require('../utils/gameHelpers');

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

/* -------------------------- WŁASNY PROFIL -------------------------- */

router.get('/', ensureAuthenticated, async (req, res) => {
  const user = await findById(req.session.user.id);
  const vm = await buildProfileViewModel(user);

  res.render('profile/show', {
    title: 'Twój profil',
    ...vm,
    isOwnProfile: true,
    alreadyFollowing: false,
    backlogEntries: buildBacklog(user.id),
    statusLabels: STATUS_LABELS,
    allGames: getAllGames(),
    tab: req.query.tab || 'badges',
  });
});

router.get('/settings', ensureAuthenticated, async (req, res) => {
  const user = await findById(req.session.user.id);
  res.render('profile/settings', {
    title: 'Ustawienia konta',
    profileUser: getUserPublic(user),
  });
});

router.post('/settings/username', ensureAuthenticated, async (req, res) => {
  const { username } = req.body;

  if (!username || username.trim().length < 3) {
    req.flash('error', 'Nazwa użytkownika musi mieć co najmniej 3 znaki.');
    return res.redirect('/profile/settings');
  }

  const result = await updateUsername(req.session.user.id, username.trim());
  if (!result.ok) {
    req.flash(
      'error',
      result.reason === 'taken'
        ? 'Ta nazwa użytkownika jest już zajęta.'
        : 'Nie udało się zmienić nazwy użytkownika.'
    );
    return res.redirect('/profile/settings');
  }

  req.session.user.username = result.user.username;
  req.flash('success', 'Nazwa użytkownika została zmieniona.');
  res.redirect('/profile/settings');
});

router.post('/settings/password', ensureAuthenticated, async (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    req.flash('error', 'Nowe hasło musi mieć co najmniej 8 znaków.');
    return res.redirect('/profile/settings');
  }
  if (newPassword !== confirmPassword) {
    req.flash('error', 'Podane hasła nie są identyczne.');
    return res.redirect('/profile/settings');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updatePassword(req.session.user.id, passwordHash);
  req.flash('success', 'Hasło zostało zmienione.');
  res.redirect('/profile/settings');
});

router.post('/settings/delete', ensureAuthenticated, async (req, res) => {
  await deleteUser(req.session.user.id);
  req.session.destroy(() => {
    res.redirect('/');
  });
});

/* ----------------------------- BACKLOG ----------------------------- */

router.post('/backlog', ensureAuthenticated, (req, res) => {
  const { gameId, status } = req.body;

  if (!gameId || !STATUSES.includes(status)) {
    req.flash('error', 'Wybierz grę i prawidłowy status backlogu.');
    return res.redirect('/profile?tab=backlog');
  }

  setStatus(req.session.user.id, gameId, status);
  req.flash('success', 'Zaktualizowano status gry w Twoim backlogu.');
  res.redirect('/profile?tab=backlog');
});

/* ----------------------------- OBSERWOWANIE ----------------------------- */

router.post('/follow/:username', ensureAuthenticated, async (req, res) => {
  const target = await findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika.');
    return res.redirect('/');
  }
  await follow(req.session.user.id, target.id);
  res.redirect(req.get('Referer') || `/profile/${target.username}`);
});

router.post('/unfollow/:username', ensureAuthenticated, async (req, res) => {
  const target = await findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika.');
    return res.redirect('/');
  }
  await unfollow(req.session.user.id, target.id);
  res.redirect(req.get('Referer') || `/profile/${target.username}`);
});

/* --------------------------- PUBLICZNY PROFIL --------------------------- */

router.get('/:username', async (req, res, next) => {
  const user = await findByUsername(req.params.username);
  if (!user) return next();

  const vm = await buildProfileViewModel(user);
  const alreadyFollowing = req.session.user
    ? await isFollowing(req.session.user.id, user.id)
    : false;
  const isOwnProfile = !!(
    req.session.user && req.session.user.id === user.id
  );

  res.render('profile/show', {
    title: `Profil: ${user.username}`,
    ...vm,
    isOwnProfile,
    alreadyFollowing,
    backlogEntries: buildBacklog(user.id),
    statusLabels: STATUS_LABELS,
    allGames: getAllGames(),
    tab: req.query.tab || 'badges',
  });
});

module.exports = router;