const express = require('express');
const router = express.Router();

const { ensureAuthenticated } = require('../middleware/auth');
const { findById, areFriends, addFriend, getFriendsOfUser } = require('../utils/userHelpers');
const {
  findPendingBetween,
  findRequestById,
  getIncomingPendingRequests,
  createRequest,
  removeRequest,
} = require('../utils/friendHelpers');

function wantsJsonResponse(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

/* ---------------------- Lista znajomych (pełna podstrona) ---------------------- */

router.get('/', ensureAuthenticated, async (req, res) => {
  const friends = await getFriendsOfUser(req.session.user.id);
  res.render('friends/index', {
    title: 'Znajomi',
    friends,
  });
});

/* ---------------------- Powiadomienia (JSON, do dzwonka w navbarze) ---------------------- */

router.get('/notifications', ensureAuthenticated, async (req, res) => {
  const pending = getIncomingPendingRequests(req.session.user.id);

  const requests = await Promise.all(
    pending.map(async (r) => {
      const fromUser = await findById(r.fromUserId);
      return {
        id: r.id,
        fromUsername: fromUser ? fromUser.username : 'Nieznany użytkownik',
        createdAt: r.createdAt,
      };
    })
  );

  res.json({ success: true, requests });
});

/* ---------------------- Wysłanie zaproszenia (z profilu użytkownika) ---------------------- */

router.post('/request/:userId', ensureAuthenticated, async (req, res) => {
  const wantsJson = wantsJsonResponse(req);
  const currentUserId = req.session.user.id;
  const targetUserId = req.params.userId;

  const targetUser = await findById(targetUserId);

  let message = null;
  let status = 200;

  if (!targetUser) {
    message = 'Użytkownik nie istnieje.';
    status = 404;
  } else if (targetUserId === currentUserId) {
    message = 'Nie możesz wysłać zaproszenia do samego siebie.';
    status = 400;
  } else if (await areFriends(currentUserId, targetUserId)) {
    message = 'Jesteście już znajomymi.';
    status = 400;
  } else if (findPendingBetween(currentUserId, targetUserId)) {
    message = 'Zaproszenie między wami już oczekuje na odpowiedź.';
    status = 400;
  }

  if (message) {
    if (wantsJson) return res.status(status).json({ success: false, message });
    req.flash('error', message);
    return res.redirect(`/users/${targetUser ? targetUser.username : ''}`);
  }

  createRequest(currentUserId, targetUserId);

  const successMessage = `Zaproszenie do znajomych wysłane do ${targetUser.username}.`;

  if (wantsJson) return res.json({ success: true, message: successMessage });

  req.flash('success', successMessage);
  res.redirect(`/users/${targetUser.username}`);
});

/* ---------------------- Akceptacja zaproszenia ---------------------- */

router.post('/accept/:requestId', ensureAuthenticated, async (req, res) => {
  const wantsJson = wantsJsonResponse(req);
  const currentUserId = req.session.user.id;
  const request = findRequestById(req.params.requestId);

  if (!request || request.toUserId !== currentUserId || request.status !== 'pending') {
    const message = 'To zaproszenie już nie jest dostępne.';
    if (wantsJson) return res.status(404).json({ success: false, message });
    req.flash('error', message);
    return res.redirect('/friends');
  }

  await addFriend(request.fromUserId, request.toUserId);
  removeRequest(request.id);

  const fromUser = await findById(request.fromUserId);
  const message = `Jesteś teraz znajomym z ${fromUser ? fromUser.username : 'tym użytkownikiem'}.`;

  if (wantsJson) return res.json({ success: true, message });

  req.flash('success', message);
  res.redirect('/friends');
});

/* ---------------------- Odrzucenie zaproszenia ---------------------- */

router.post('/decline/:requestId', ensureAuthenticated, (req, res) => {
  const wantsJson = wantsJsonResponse(req);
  const currentUserId = req.session.user.id;
  const request = findRequestById(req.params.requestId);

  if (!request || request.toUserId !== currentUserId || request.status !== 'pending') {
    const message = 'To zaproszenie już nie jest dostępne.';
    if (wantsJson) return res.status(404).json({ success: false, message });
    req.flash('error', message);
    return res.redirect('/friends');
  }

  removeRequest(request.id);

  const message = 'Zaproszenie zostało odrzucone.';

  if (wantsJson) return res.json({ success: true, message });

  req.flash('success', message);
  res.redirect('/friends');
});

module.exports = router;
