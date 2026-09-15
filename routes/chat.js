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
  clearMessages,
  deleteConversation,
} = require('../utils/chatHelpers');
const { findByUsername, findById, getAllUsers } = require('../utils/userHelpers');
const { getAllGames } = require('../utils/gameHelpers');
const { getMutualFriends, isFollowing } = require('../utils/socialHelpers');

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
  const mutualIds = new Set(await getMutualFriends(me.id));

  res.render('chat/chat', {
    title: 'Czat i grupy',
    conversations,
    active: canSeeActive ? active : null,
    messages,
    otherUsers: allUsers
      .filter((u) => u.id !== me.id && mutualIds.has(u.id))
      .map((u) => u.username),
    popularGames: getAllGames().slice(0, 6),
  });
});

/* ------------------- WYSZUKIWANIE ZNAJOMYCH (do grupy) ------------------- */

// Zwraca tylko WZAJEMNYCH obserwujących (znajomych) pasujących do zapytania -
// tylko ich można dodać do nowej grupy.
router.get('/friends-search', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const mutualIds = await getMutualFriends(req.session.user.id);

  const mutualUsers = (await Promise.all(mutualIds.map((id) => findById(id))))
    .filter(Boolean)
    .filter((u) => !q || u.username.toLowerCase().includes(q))
    .slice(0, 8)
    .map((u) => ({ id: u.id, username: u.username }));

  res.json({ users: mutualUsers });
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

  const [iFollowThem, theyFollowMe] = await Promise.all([
    isFollowing(req.session.user.id, target.id),
    isFollowing(target.id, req.session.user.id),
  ]);

  if (!iFollowThem || !theyFollowMe) {
    req.flash(
      'error',
      'Możesz pisać prywatnie tylko do wzajemnych znajomych (obserwujecie się nawzajem).'
    );
    return res.redirect('/chat');
  }

  const conv = await getOrCreateDM(req.session.user, target);
  res.redirect(`/chat?c=${conv.id}`);
});

/* ------------------------------ GRUPY ------------------------------ */

router.post('/groups/new', async (req, res) => {
  const { name } = req.body;
  let memberIds = req.body.memberIds || [];
  if (!Array.isArray(memberIds)) memberIds = [memberIds];
  memberIds = memberIds.filter(Boolean);

  if (!name || !name.trim()) {
    req.flash('error', 'Podaj nazwę grupy.');
    return res.redirect('/chat');
  }
  if (memberIds.length === 0) {
    req.flash('error', 'Dodaj co najmniej jednego znajomego do grupy.');
    return res.redirect('/chat');
  }

  // Bezpieczeństwo: nawet gdyby ktoś ominął JS i wysłał dowolne ID,
  // serwer i tak dopuszcza tylko wzajemnych obserwujących.
  const mutualIds = await getMutualFriends(req.session.user.id);
  const mutualSet = new Set(mutualIds);
  const validIds = memberIds.filter((id) => mutualSet.has(id));

  if (validIds.length === 0) {
    req.flash('error', 'Do grupy możesz dodać tylko wzajemnych znajomych.');
    return res.redirect('/chat');
  }

  const members = (await Promise.all(validIds.map((id) => findById(id)))).filter(
    Boolean
  );

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

/* ------------------------- USUŃ / WYCZYŚĆ ROZMOWĘ ------------------------- */

router.post('/:conversationId/clear', async (req, res) => {
  const { conversationId } = req.params;

  if (!(await canAccessConversation(req.session.user.id, conversationId))) {
    req.flash('error', 'Brak dostępu do tej rozmowy.');
    return res.redirect('/chat');
  }

  await clearMessages(conversationId);
  req.flash('success', 'Wiadomości zostały wyczyszczone.');
  res.redirect(`/chat?c=${conversationId}`);
});

router.post('/:conversationId/delete', async (req, res) => {
  const { conversationId } = req.params;

  if (!(await canAccessConversation(req.session.user.id, conversationId))) {
    req.flash('error', 'Brak dostępu do tej rozmowy.');
    return res.redirect('/chat');
  }

  await deleteConversation(conversationId);
  req.flash('success', 'Rozmowa została usunięta.');
  res.redirect('/chat');
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