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
function buildProfileViewModel(user) {
  const reviews = readCollection('reviews')
    .filter((r) => r.username === user.username)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const stats = {
    reviewCount: reviews.length,
    commentCount: 0,
    likesReceived: 0,
    followersCount: getFollowers(user.id).length,
    followingCount: getFollowing(user.id).length,
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

router.get('/', ensureAuthenticated, (req, res) => {
  const user = findById(req.session.user.id);
  const vm = buildProfileViewModel(user);

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

router.get('/settings', ensureAuthenticated, (req, res) => {
  const user = findById(req.session.user.id);
  res.render('profile/settings', {
    title: 'Ustawienia konta',
    profileUser: getUserPublic(user),
  });
});

router.post('/settings/username', ensureAuthenticated, (req, res) => {
  const { username } = req.body;

  if (!username || username.trim().length < 3) {
    req.flash('error', 'Nazwa użytkownika musi mieć co najmniej 3 znaki.');
    return res.redirect('/profile/settings');
  }

  const result = updateUsername(req.session.user.id, username.trim());
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
  updatePassword(req.session.user.id, passwordHash);
  req.flash('success', 'Hasło zostało zmienione.');
  res.redirect('/profile/settings');
});

router.post('/settings/delete', ensureAuthenticated, (req, res) => {
  deleteUser(req.session.user.id);
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

router.post('/follow/:username', ensureAuthenticated, (req, res) => {
  const target = findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika.');
    return res.redirect('/');
  }
  follow(req.session.user.id, target.id);
  res.redirect(req.get('Referer') || `/profile/${target.username}`);
});

router.post('/unfollow/:username', ensureAuthenticated, (req, res) => {
  const target = findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika.');
    return res.redirect('/');
  }
  unfollow(req.session.user.id, target.id);
  res.redirect(req.get('Referer') || `/profile/${target.username}`);
});

/* --------------------------- PUBLICZNY PROFIL --------------------------- */

router.get('/:username', (req, res, next) => {
  const user = findByUsername(req.params.username);
  if (!user) return next();

  const vm = buildProfileViewModel(user);
  const alreadyFollowing = req.session.user
    ? isFollowing(req.session.user.id, user.id)
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
