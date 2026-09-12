const express = require('express');
const router = express.Router();

const { findByUsername, areFriends } = require('../utils/userHelpers');
const { findPendingBetween } = require('../utils/friendHelpers');

router.get('/:username', async (req, res, next) => {
  const profileUser = await findByUsername(req.params.username);

  if (!profileUser) {
    return next(); // przekazuje do globalnej obsługi 404
  }

  const currentUser = req.session.user || null;

  let relationship = 'none'; // none | self | friends | pending_sent | pending_received
  let pendingRequestId = null;

  if (currentUser) {
    if (currentUser.id === profileUser.id) {
      relationship = 'self';
    } else if (await areFriends(currentUser.id, profileUser.id)) {
      relationship = 'friends';
    } else {
      const pending = findPendingBetween(currentUser.id, profileUser.id);
      if (pending) {
        if (pending.fromUserId === currentUser.id) {
          relationship = 'pending_sent';
        } else {
          relationship = 'pending_received';
          pendingRequestId = pending.id;
        }
      }
    }
  }

  res.render('users/profile', {
    title: profileUser.username,
    profileUser,
    relationship,
    pendingRequestId,
  });
});

module.exports = router;
