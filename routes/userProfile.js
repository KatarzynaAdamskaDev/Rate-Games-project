const express = require('express');
const router = express.Router();

const { findByUsername } = require('../utils/userHelpers');
const { isFollowing } = require('../utils/socialHelpers');
const { hasBlocked } = require('../utils/blockHelpers');
const { REASONS_BY_TYPE, MAX_COMMENT_LENGTH } = require('../utils/reportReasons');
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
  const viewerId = req.session.user ? req.session.user.id : null;
  const tabData = await buildTabData(user.id, tab, viewerId);
  const alreadyFollowing = req.session.user
    ? await isFollowing(req.session.user.id, user.id)
    : false;

  const iBlocked = req.session.user ? await hasBlocked(req.session.user.id, user.id) : false;

  res.render('profile/show', {
    title: `Profil: ${user.username}`,
    seo: {
      type: 'profile',
      title: `${user.username} - profil w GameVerse`,
      description: user.bio ? String(user.bio).replace(/\s+/g, ' ').trim().slice(0, 200) : `Profil gracza ${user.username} w GameVerse: recenzje, ulubione gry i aktywność.`,
      image: user.avatarUrl || '/images/og-default.png',
      card: user.avatarUrl ? 'summary' : 'summary_large_image',
    },
    ...vm,
    ...tabData,
    isOwnProfile: false,
    alreadyFollowing,
    iBlocked,
    reportReasonSets: { user: REASONS_BY_TYPE.user },
    reportCommentMax: MAX_COMMENT_LENGTH,
    maxFavorites: MAX_FAVORITES,
    tab,
  });
});

module.exports = router;