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

router.get('/', async (req, res) => {
  const me = req.session.user;

  const rawConversations = await getConversationsForUser(me.id);
  const conversations = rawConversations.map((c) => {
    let displayName = c.name;
    if (c.type === 'dm') {
      const otherId = c.memberIds.find((id) => id !== me.id);
      displayName = (otherId && c.memberNames[otherId]) || 'Rozmowa';
    }
    return { ...c, displayName };
  });

  const activeId = req.query.c || (conversations[0] && conversations[0].id) || null;
  const active = activeId ? await getConversationById(activeId) : null;
  const canSeeActive = !!(active && active.memberIds.includes(me.id));
  const messages = canSeeActive ? await getMessages(active.id) : [];

  const allUsers = await getAllUsers();

  res.render('chat/chat', {
    title: 'Czat i grupy',
    conversations,
    active: canSeeActive ? active : null,
    messages,
    otherUsers: allUsers
      .filter((u) => u.id !== me.id)
      .map((u) => u.username),
    popularGames: getAllGames().slice(0, 6),
  });
});

/* ---------------------------- ROZPOCZNIJ DM ---------------------------- */

router.post('/start/:username', async (req, res) => {
  const target = await findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika o takiej nazwie.');
    return res.redirect('/chat');
  }
  if (target.id === req.session.user.id) {
    req.flash('error', 'Nie możesz rozpocząć rozmowy sam ze sobą.');
    return res.redirect('/chat');
  }

  const conv = await getOrCreateDM(req.session.user, target);
  res.redirect(`/chat?c=${conv.id}`);
});

/* ------------------------------ GRUPY ------------------------------ */

router.post('/groups/new', async (req, res) => {
  const { name, usernames } = req.body;

  if (!name || !name.trim()) {
    req.flash('error', 'Podaj nazwę grupy.');
    return res.redirect('/chat');
  }

  const usernameList = (usernames || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const foundUsers = await Promise.all(
    usernameList.map((u) => findByUsername(u))
  );

  const members = foundUsers
    .filter(Boolean)
    .filter((u) => u.id !== req.session.user.id);

  const group = await createGroup({
    name: name.trim(),
    ownerId: req.session.user.id,
    ownerUsername: req.session.user.username,
    members,
  });

  req.flash('success', `Grupa "${group.name}" została utworzona.`);
  res.redirect(`/chat?c=${group.id}`);
});

/* ---------------------------- POKOJE GIER ---------------------------- */

router.get('/rooms/:gameId', async (req, res, next) => {
  const room = await getOrCreateGameRoom(
    req.params.gameId,
    req.session.user.id,
    req.session.user.username
  );
  if (!room) return next();
  res.redirect(`/chat?c=${room.id}`);
});

/* --------------------------- WIADOMOŚCI (AJAX) --------------------------- */

router.get('/:conversationId/messages', async (req, res) => {
  const { conversationId } = req.params;

  if (!(await canAccessConversation(req.session.user.id, conversationId))) {
    return res.status(403).json({ error: 'Brak dostępu do tej rozmowy.' });
  }

  const messages = req.query.after
    ? await getMessagesAfter(conversationId, req.query.after)
    : await getMessages(conversationId);

  res.json({ messages });
});

router.post('/:conversationId/messages', async (req, res) => {
  const { conversationId } = req.params;

  if (!(await canAccessConversation(req.session.user.id, conversationId))) {
    return res.status(403).json({ error: 'Brak dostępu do tej rozmowy.' });
  }

  const text = (req.body.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Wiadomość nie może być pusta.' });
  }

  const message = await addMessage({
    conversationId,
    senderId: req.session.user.id,
    senderUsername: req.session.user.username,
    text: text.slice(0, 1000),
  });

  res.json({ message });
});

module.exports = router;