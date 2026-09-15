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
const { isReservedUsername } = require('../utils/reservedUsernames');
const {
  setStatus,
  STATUSES,
  STATUS_LABELS,
} = require('../utils/backlogHelpers');
const { getAllGames } = require('../utils/gameHelpers');
const { follow, unfollow } = require('../utils/socialHelpers');
const { buildProfileViewModel, buildBacklog } = require('../utils/profileViewModel');

/* -------------------------- WŁASNY PROFIL -------------------------- */

router.get('/', ensureAuthenticated, async (req, res) => {
  const user = await findById(req.session.user.id);
  const vm = await buildProfileViewModel(user);
  const backlogEntries = await buildBacklog(user.id);

  res.render('profile/show', {
    title: 'Twój profil',
    ...vm,
    isOwnProfile: true,
    alreadyFollowing: false,
    backlogEntries,
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

  if (isReservedUsername(username)) {
    req.flash('error', 'Ta nazwa użytkownika jest zarezerwowana i niedostępna.');
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

router.post('/backlog', ensureAuthenticated, async (req, res) => {
  const { gameId, status } = req.body;

  if (!gameId || !STATUSES.includes(status)) {
    req.flash('error', 'Wybierz grę i prawidłowy status backlogu.');
    return res.redirect('/profile?tab=backlog');
  }

  await setStatus(req.session.user.id, gameId, status);
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
  res.redirect(req.get('Referer') || `/${target.username}`);
});

router.post('/unfollow/:username', ensureAuthenticated, async (req, res) => {
  const target = await findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika.');
    return res.redirect('/');
  }
  await unfollow(req.session.user.id, target.id);
  res.redirect(req.get('Referer') || `/${target.username}`);
});

/* ---------------- Kompatybilność wsteczna ze starym adresem ---------------- */
// Stare linki postaci /profile/nazwa przekierowują na nowy /nazwa.
router.get('/:username', (req, res) => {
  res.redirect(301, `/${req.params.username}`);
});

module.exports = router;