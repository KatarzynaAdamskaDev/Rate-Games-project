const express = require('express');
const router = express.Router();

const { findByUsername } = require('../utils/userHelpers');
const { isFollowing } = require('../utils/socialHelpers');
const { STATUS_LABELS } = require('../utils/backlogHelpers');
const { getAllGames } = require('../utils/gameHelpers');
const { buildProfileViewModel, buildBacklog } = require('../utils/profileViewModel');

// UWAGA: ten router jest montowany jako ostatni w app.js (app.use('/', ...)),
// żeby /:username nie "połykał" innych tras typu /games, /category, /blog itd.
router.get('/:username', async (req, res, next) => {
  const user = await findByUsername(req.params.username);
  if (!user) return next(); // przekazuje do globalnej obsługi 404

  // Własny profil zawsze zarządzamy pod /profile (ustawienia, backlog itd.)
  if (req.session.user && req.session.user.id === user.id) {
    return res.redirect('/profile');
  }

  const vm = await buildProfileViewModel(user);
  const alreadyFollowing = req.session.user
    ? await isFollowing(req.session.user.id, user.id)
    : false;

  res.render('profile/show', {
    title: `Profil: ${user.username}`,
    ...vm,
    isOwnProfile: false,
    alreadyFollowing,
    backlogEntries: buildBacklog(user.id),
    statusLabels: STATUS_LABELS,
    allGames: getAllGames(),
    tab: req.query.tab || 'badges',
  });
});

module.exports = router;