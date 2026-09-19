const express = require('express');
const router = express.Router();

const { findByUsername } = require('../utils/userHelpers');
const { isFollowing } = require('../utils/socialHelpers');
const {
  buildProfileViewModel,
  buildTabData,
  normalizeProfileTab,
} = require('../utils/profileViewModel');
const { MAX_FAVORITES } = require('../utils/favoriteHelpers');

// UWAGA: ten router jest montowany jako ostatni w app.js (app.use('/', ...)),
// żeby /:username nie "połykał" innych tras typu /games, /category, /blog itd.
router.get('/:username', async (req, res, next) => {
  const user = await findByUsername(req.params.username);
  if (!user) return next(); // przekazuje do globalnej obsługi 404

  // Własny profil zawsze zarządzamy pod /profile (ustawienia, ulubione gry itd.)
  if (req.session.user && req.session.user.id === user.id) {
    return res.redirect('/profile');
  }

  const vm = await buildProfileViewModel(user);
  const tab = normalizeProfileTab(req.query.tab);
  const tabData = await buildTabData(user.id, tab);
  const alreadyFollowing = req.session.user
    ? await isFollowing(req.session.user.id, user.id)
    : false;

  res.render('profile/show', {
    title: `Profil: ${user.username}`,
    ...vm,
    ...tabData,
    isOwnProfile: false,
    alreadyFollowing,
    maxFavorites: MAX_FAVORITES,
    tab,
  });
});

module.exports = router;