const express = require('express');
const router = express.Router();

const { ensureAuthenticated } = require('../middleware/auth');
const {
  getConversationsForUser,
  getConversationById,
  canAccessConversation,
  getOrCreateDM,
  createGroup,
  getOrCreateGameRoom,
  getMessages,
  getMessagesAfter,
  addMessage,
} = require('../utils/chatHelpers');
const { findByUsername, getAllUsers } = require('../utils/userHelpers');
const { getAllGames } = require('../utils/gameHelpers');

// Cały czat wymaga zalogowania.
router.use(ensureAuthenticated);

/* ------------------------------- WIDOK ------------------------------- */

router.get('/', (req, res) => {
  const me = req.session.user;

  const conversations = getConversationsForUser(me.id).map((c) => {
    let displayName = c.name;
    if (c.type === 'dm') {
      const otherId = c.memberIds.find((id) => id !== me.id);
      displayName = (otherId && c.memberNames[otherId]) || 'Rozmowa';
    }
    return { ...c, displayName };
  });

  const activeId = req.query.c || (conversations[0] && conversations[0].id) || null;
  const active = activeId ? getConversationById(activeId) : null;
  const canSeeActive = !!(active && active.memberIds.includes(me.id));
  const messages = canSeeActive ? getMessages(active.id) : [];

  res.render('chat/index', {
    title: 'Czat i grupy',
    conversations,
    active: canSeeActive ? active : null,
    messages,
    otherUsers: getAllUsers()
      .filter((u) => u.id !== me.id)
      .map((u) => u.username),
    popularGames: getAllGames().slice(0, 6),
  });
});

/* ---------------------------- ROZPOCZNIJ DM ---------------------------- */

router.post('/start/:username', (req, res) => {
  const target = findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika o takiej nazwie.');
    return res.redirect('/chat');
  }
  if (target.id === req.session.user.id) {
    req.flash('error', 'Nie możesz rozpocząć rozmowy sam ze sobą.');
    return res.redirect('/chat');
  }

  const conv = getOrCreateDM(req.session.user, target);
  res.redirect(`/chat?c=${conv.id}`);
});

/* ------------------------------ GRUPY ------------------------------ */

router.post('/groups/new', (req, res) => {
  const { name, usernames } = req.body;

  if (!name || !name.trim()) {
    req.flash('error', 'Podaj nazwę grupy.');
    return res.redirect('/chat');
  }

  const usernameList = (usernames || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const members = usernameList
    .map((u) => findByUsername(u))
    .filter(Boolean)
    .filter((u) => u.id !== req.session.user.id);

  const group = createGroup({
    name: name.trim(),
    ownerId: req.session.user.id,
    ownerUsername: req.session.user.username,
    members,
  });

  req.flash('success', `Grupa "${group.name}" została utworzona.`);
  res.redirect(`/chat?c=${group.id}`);
});

/* ---------------------------- POKOJE GIER ---------------------------- */

router.get('/rooms/:gameId', (req, res, next) => {
  const room = getOrCreateGameRoom(
    req.params.gameId,
    req.session.user.id,
    req.session.user.username
  );
  if (!room) return next();
  res.redirect(`/chat?c=${room.id}`);
});

/* --------------------------- WIADOMOŚCI (AJAX) --------------------------- */

router.get('/:conversationId/messages', (req, res) => {
  const { conversationId } = req.params;

  if (!canAccessConversation(req.session.user.id, conversationId)) {
    return res.status(403).json({ error: 'Brak dostępu do tej rozmowy.' });
  }

  const messages = req.query.after
    ? getMessagesAfter(conversationId, req.query.after)
    : getMessages(conversationId);

  res.json({ messages });
});

router.post('/:conversationId/messages', (req, res) => {
  const { conversationId } = req.params;

  if (!canAccessConversation(req.session.user.id, conversationId)) {
    return res.status(403).json({ error: 'Brak dostępu do tej rozmowy.' });
  }

  const text = (req.body.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Wiadomość nie może być pusta.' });
  }

  const message = addMessage({
    conversationId,
    senderId: req.session.user.id,
    senderUsername: req.session.user.username,
    text: text.slice(0, 1000),
  });

  res.json({ message });
});

module.exports = router;
