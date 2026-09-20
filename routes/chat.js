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
  markConversationRead,
  getUnreadCounts,
  getMessages,
  getLastMessage,
  getMessagesAfter,
  addMessage,
  clearMessages,
  deleteConversation,
} = require('../utils/chatHelpers');
const { findByUsername, findById, getAllUsers } = require('../utils/userHelpers');
const { getPopularGames } = require('../utils/igdbService');
const { getMutualFriends, isFollowing } = require('../utils/socialHelpers');
const { moderateText, moderateName } = require('../utils/contentFilter');
const { limiters } = require('../middleware/rateLimit');
const { blockIfMuted } = require('../middleware/muted');
const { isBlockedEitherWay } = require('../utils/blockHelpers');
const { REASONS_BY_TYPE, MAX_COMMENT_LENGTH } = require('../utils/reportReasons');

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

  // Liczniki nieprzeczytanych liczymy przed oznaczeniem aktywnej rozmowy jako przeczytanej.
  const unread = await getUnreadCounts(me.id);
  if (canSeeActive) {
    await markConversationRead(me.id, active.id);
    delete unread.byConversation[active.id];
  }

  const allUsers = await getAllUsers();
  const mutualIds = new Set(await getMutualFriends(me.id));

  res.render('chat/chat', {
    title: 'Czat i grupy',
    conversations,
    active: canSeeActive ? active : null,
    messages,
    unreadByConversation: unread.byConversation,
    otherUsers: allUsers
      .filter((u) => u.id !== me.id && mutualIds.has(u.id))
      .map((u) => u.username),
    popularGames: await getPopularGames(20),
    reportReasonSets: { message: REASONS_BY_TYPE.message },
    reportCommentMax: MAX_COMMENT_LENGTH,
  });
});

/* -------------------- LISTA ROZMÓW DLA MINI CZATU (JSON) -------------------- */

router.get('/api/list', async (req, res, next) => {
  try {
    const me = req.session.user;
    const [conversations, unread] = await Promise.all([
      getConversationsForUser(me.id),
      getUnreadCounts(me.id),
    ]);

    const items = await Promise.all(
      conversations.slice(0, 30).map(async (c) => {
        let name = c.name;
        if (c.type === 'dm') {
          const otherId = c.memberIds.find((id) => id !== me.id);
          name = (otherId && c.memberNames[otherId]) || 'Rozmowa';
        }
        const last = await getLastMessage(c.id);
        return {
          id: c.id,
          type: c.type,
          name,
          unread: unread.byConversation[c.id] || 0,
          lastMessage: last
            ? {
                text: last.text.slice(0, 80),
                senderUsername: last.senderUsername,
                mine: last.senderId === me.id,
                createdAt: last.createdAt,
              }
            : null,
        };
      })
    );

    res.json({ conversations: items });
  } catch (err) {
    next(err);
  }
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

router.post('/start/:username', blockIfMuted, limiters.chatCreate, async (req, res) => {
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

  if (await isBlockedEitherWay(req.session.user.id, target.id)) {
    req.flash('error', 'Nie możesz pisać do tego użytkownika (jedna ze stron zablokowała drugą).');
    return res.redirect('/chat');
  }

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

router.post('/groups/new', blockIfMuted, limiters.chatCreate, async (req, res) => {
  const { name } = req.body;
  let memberIds = req.body.memberIds || [];
  if (!Array.isArray(memberIds)) memberIds = [memberIds];
  memberIds = memberIds.filter(Boolean);

  if (!name || !name.trim()) {
    req.flash('error', 'Podaj nazwę grupy.');
    return res.redirect('/chat');
  }
  const nameCheck = moderateName(name);
  if (!nameCheck.ok) {
    req.flash('error', nameCheck.error);
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

  // Okno rozmowy jest otwarte, więc wszystko, co przyszło, jest już widoczne.
  await markConversationRead(req.session.user.id, conversationId);

  res.json({ messages });
});

router.post('/:conversationId/messages', blockIfMuted, limiters.chatMessage, async (req, res) => {
  const { conversationId } = req.params;

  if (!(await canAccessConversation(req.session.user.id, conversationId))) {
    return res.status(403).json({ error: 'Brak dostępu do tej rozmowy.' });
  }

  const text = (req.body.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Wiadomość nie może być pusta.' });
  }

  // W rozmowie prywatnej nie da się pisać do osoby, która zablokowała nas albo którą zablokowaliśmy.
  const conversation = await getConversationById(conversationId);
  if (conversation && conversation.type === 'dm') {
    const otherId = conversation.memberIds.find((id) => id !== req.session.user.id);
    if (otherId && (await isBlockedEitherWay(req.session.user.id, otherId))) {
      return res.status(403).json({ error: 'Nie możesz wysyłać wiadomości do tego użytkownika (jedna ze stron zablokowała drugą).' });
    }
  }

  const checked = moderateText(text.slice(0, 1000), { userId: req.session.user.id });
  if (!checked.ok) {
    return res.status(400).json({ error: checked.error });
  }

  const message = await addMessage({
    conversationId,
    senderId: req.session.user.id,
    senderUsername: req.session.user.username,
    text: checked.text,
  });
  await markConversationRead(req.session.user.id, conversationId);

  res.json({ message });
});

module.exports = router;