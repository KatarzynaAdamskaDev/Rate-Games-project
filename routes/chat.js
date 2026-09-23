const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const { ensureAuthenticated } = require('../middleware/auth');
const {
  getConversationsForUser,
  getConversationById,
  canAccessConversation,
  attachAvatars,
  getOrCreateDM,
  createGroup,
  inviteMembersToGroup,
  getPendingInvitesForUser,
  acceptGroupInvite,
  declineGroupInvite,
  renameGroup,
  setGroupPhoto,
  removeGroupMember,
  getOrCreateGameRoom,
  markConversationRead,
  getUnreadCounts,
  getMessages,
  getLastMessage,
  getMessagesAfter,
  addMessage,
  previewText,
  setCanReply,
  clearMessages,
  deleteConversation,
} = require('../utils/chatHelpers');
const { findByUsername, findById, getAllUsers } = require('../utils/userHelpers');
const { getPopularGames } = require('../utils/igdbService');
const { getMutualFriends, isFollowing } = require('../utils/socialHelpers');
const { moderateText, moderateName } = require('../utils/contentFilter');
const { searchGifs, isGiphyCdnUrl } = require('../utils/giphy');
const { limiters } = require('../middleware/rateLimit');
const { blockIfMuted } = require('../middleware/muted');
const { isBlockedEitherWay } = require('../utils/blockHelpers');
const { REASONS_BY_TYPE, MAX_COMMENT_LENGTH } = require('../utils/reportReasons');
const { logAdminAction } = require('../utils/adminHelpers');
const { createNotification } = require('../utils/notificationHelpers');
const { sanitizeImage } = require('../utils/imageSafety');
const { GROUP_PHOTO_DIR } = require('../config/storage');
const { checkUploadToken, verifyAfterUpload, reject: rejectCsrf, isValid: csrfValid } = require('../middleware/csrf');

// Git nie przechowuje pustych katalogów - na świeżym klonie multer nie zapisałby pliku bez tego.
fs.mkdirSync(GROUP_PHOTO_DIR, { recursive: true });

// Zdjęcie grupy: ten sam wzorzec co awatar użytkownika (routes/profile.js) - plik trafia do pamięci,
// dopiero po weryfikacji zawartości (utils/imageSafety.js) zapisujemy bezpieczny, przekodowany obraz.
const groupPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (!checkUploadToken(req)) return cb(new Error('csrf'));
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      const invalidType = new Error('Dozwolone są tylko pliki PNG, JPG, WEBP lub GIF.');
      invalidType.userFacing = true;
      return cb(invalidType);
    }
    cb(null, true);
  },
});

/** Wspólna obsługa błędów uploadu zdjęcia grupy (CSRF, rozmiar, typ pliku). */
function handleGroupPhotoUploadError(req, res, err) {
  if (err && err.message === 'csrf') {
    rejectCsrf(req, res);
    return true;
  }
  if (!err && !csrfValid(req)) {
    verifyAfterUpload(req, res, () => {});
    return true;
  }
  if (err) {
    let message = 'Nie udało się wgrać zdjęcia. Spróbuj ponownie.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Zdjęcie jest za duże (maksymalnie 2 MB).';
    else if (err.userFacing) message = err.message;
    else console.error('Błąd uploadu zdjęcia grupy:', err);
    req.flash('error', message);
    res.redirect('/chat');
    return true;
  }
  return false;
}

// Cały czat wymaga zalogowania.
router.use(ensureAuthenticated);

/* ------------------------------- WIDOK ------------------------------- */

router.get('/', async (req, res) => {
  const me = req.session.user;

  const rawConversations = await attachAvatars(await getConversationsForUser(me.id));
  const conversations = rawConversations.map((c) => {
    let displayName = c.name;
    if (c.type === 'dm') {
      const otherId = c.memberIds.find((id) => id !== me.id);
      displayName = (otherId && c.memberNames[otherId]) || 'Rozmowa';
    }
    return { ...c, displayName };
  });

  const activeId = req.query.c || (conversations[0] && conversations[0].id) || null;
  const activeRaw = activeId ? await getConversationById(activeId) : null;
  const active = activeRaw ? await attachAvatars(activeRaw) : null;
  const canSeeActive = !!(active && active.memberIds.includes(me.id));
  const messages = canSeeActive ? await getMessages(active.id) : [];

  // Liczniki nieprzeczytanych liczymy przed oznaczeniem aktywnej rozmowy jako przeczytanej.
  const unread = await getUnreadCounts(me.id);
  if (canSeeActive) {
    await markConversationRead(me.id, active.id);
    delete unread.byConversation[active.id];
  }

  const isAdmin = me.role === 'admin';
  const allUsers = await getAllUsers();
  const mutualIds = new Set(await getMutualFriends(me.id));
  const pendingInvites = await getPendingInvitesForUser(me.id);

  res.render('chat/chat', {
    title: 'Czat i grupy',
    conversations,
    active: canSeeActive ? active : null,
    messages,
    unreadByConversation: unread.byConversation,
    pendingInvites,
    // Administrator może pisać do każdego bez wzajemnej obserwacji (patrz POST /start/:username).
    otherUsers: allUsers
      .filter((u) => u.id !== me.id && (isAdmin || mutualIds.has(u.id)))
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
    const [conversationsRaw, unread] = await Promise.all([
      getConversationsForUser(me.id),
      getUnreadCounts(me.id),
    ]);
    const conversations = await attachAvatars(conversationsRaw);

    const items = await Promise.all(
      conversations.slice(0, 30).map(async (c) => {
        let name = c.name;
        let avatarUrl = null;
        if (c.type === 'dm') {
          const otherId = c.memberIds.find((id) => id !== me.id);
          name = (otherId && c.memberNames[otherId]) || 'Rozmowa';
          avatarUrl = (otherId && c.memberAvatars[otherId]) || null;
        }
        const last = await getLastMessage(c.id);
        return {
          id: c.id,
          type: c.type,
          name,
          avatarUrl,
          canReply: c.canReply,
          unread: unread.byConversation[c.id] || 0,
          lastMessage: last
            ? {
                text: previewText(last),
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

/* ------------------------- WYSZUKIWANIE GIF-ÓW (Giphy) ------------------------- */

router.get('/gifs', limiters.gifSearch, async (req, res, next) => {
  try {
    const gifs = await searchGifs(req.query.q);
    res.json({ gifs });
  } catch (err) {
    next(err);
  }
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

  if (await isBlockedEitherWay(req.session.user.id, target.id)) {
    req.flash('error', 'Nie możesz pisać do tego użytkownika (jedna ze stron zablokowała drugą).');
    return res.redirect('/chat');
  }

  // Administrator może napisać do każdego bez wzajemnej obserwacji (np. w sprawach moderacji).
  if (req.session.user.role !== 'admin') {
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
  }

  const conv = await getOrCreateDM(req.session.user, target);
  res.redirect(`/chat?c=${conv.id}`);
});

/* ------------------------------ GRUPY ------------------------------ */

/** Wysyła zaproszenia do grupy (tylko wzajemni znajomi) i powiadamia zaproszonych. */
async function sendGroupInvites(req, conversation, memberIds) {
  const mutualIds = await getMutualFriends(req.session.user.id);
  const mutualSet = new Set(mutualIds);
  const validIds = memberIds.filter((id) => mutualSet.has(id));
  if (validIds.length === 0) return { invited: [], skipped: memberIds.length > 0 };

  const users = (await Promise.all(validIds.map((id) => findById(id)))).filter(Boolean);
  const invited = await inviteMembersToGroup(
    conversation.id,
    users.map((u) => ({ id: u.id, username: u.username }))
  );

  await Promise.all(
    invited.map((u) =>
      createNotification({
        userId: u.id,
        type: 'group-invite',
        actorId: req.session.user.id,
        message: `${req.session.user.username} zaprosił(a) Cię do grupy "${conversation.name}"`,
        link: '/chat',
      })
    )
  );

  return { invited, skipped: validIds.length < memberIds.length };
}

// Zdjęcie grupy ustawia się dopiero po utworzeniu, w ustawieniach grupy (POST /:conversationId/photo) -
// tworzenie zajmuje się tylko nazwą i zaproszeniami.
router.post('/groups/new', blockIfMuted, limiters.chatCreate, async (req, res) => {
  try {
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
      req.flash('error', 'Zaproś co najmniej jednego znajomego do grupy.');
      return res.redirect('/chat');
    }

    const group = await createGroup({
      name: name.trim(),
      ownerId: req.session.user.id,
      ownerUsername: req.session.user.username,
    });

    const { invited, skipped } = await sendGroupInvites(req, group, memberIds);
    if (invited.length === 0) {
      req.flash('error', 'Do grupy możesz zaprosić tylko wzajemnych znajomych.');
    } else if (skipped) {
      req.flash('success', `Grupa "${group.name}" została utworzona. Wysłano ${invited.length} zaproszeń (część osób pominięto - to nie wzajemni znajomi).`);
    } else {
      req.flash('success', `Grupa "${group.name}" została utworzona. Wysłano zaproszenia.`);
    }
    res.redirect(`/chat?c=${group.id}`);
  } catch (err) {
    req.flash('error', 'Nie udało się utworzyć grupy. Spróbuj ponownie.');
    res.redirect('/chat');
  }
});

/** Właściciel zaprasza kolejne osoby do już istniejącej grupy. */
router.post('/:conversationId/invite', blockIfMuted, limiters.chatCreate, async (req, res) => {
  const { conversationId } = req.params;
  const conversation = await getConversationById(conversationId);
  if (!conversation || conversation.type !== 'group' || conversation.ownerId !== req.session.user.id) {
    req.flash('error', 'Tylko właściciel grupy może zapraszać nowe osoby.');
    return res.redirect('/chat');
  }

  let memberIds = req.body.memberIds || [];
  if (!Array.isArray(memberIds)) memberIds = [memberIds];
  memberIds = memberIds.filter(Boolean);
  if (memberIds.length === 0) {
    req.flash('error', 'Wybierz co najmniej jedną osobę do zaproszenia.');
    return res.redirect(`/chat?c=${conversationId}`);
  }

  const { invited, skipped } = await sendGroupInvites(req, conversation, memberIds);
  if (invited.length === 0) {
    req.flash('error', 'Do grupy możesz zaprosić tylko wzajemnych znajomych (którzy nie są już w niej i nie mają zaproszenia).');
  } else {
    req.flash('success', skipped ? `Wysłano ${invited.length} zaproszeń (część osób pominięto).` : `Wysłano ${invited.length} zaproszeń.`);
  }
  res.redirect(`/chat?c=${conversationId}`);
});

/* ------------------------- ZAPROSZENIA DO GRUPY ------------------------- */

router.post('/invites/:conversationId/accept', async (req, res) => {
  const { conversationId } = req.params;
  const ok = await acceptGroupInvite(conversationId, req.session.user.id, req.session.user.username);
  req.flash(ok ? 'success' : 'error', ok ? 'Dołączono do grupy.' : 'Nie znaleziono zaproszenia.');
  res.redirect(ok ? `/chat?c=${conversationId}` : '/chat');
});

router.post('/invites/:conversationId/decline', async (req, res) => {
  const { conversationId } = req.params;
  await declineGroupInvite(conversationId, req.session.user.id);
  req.flash('success', 'Zaproszenie zostało odrzucone.');
  res.redirect('/chat');
});

/* --------------------------- ZARZĄDZANIE GRUPĄ (WŁAŚCICIEL) --------------------------- */

function ensureGroupOwner(req, res, conversation) {
  if (!conversation || conversation.type !== 'group' || conversation.ownerId !== req.session.user.id) {
    req.flash('error', 'Tylko właściciel grupy może to zrobić.');
    res.redirect('/chat');
    return false;
  }
  return true;
}

router.post('/:conversationId/rename', async (req, res) => {
  const { conversationId } = req.params;
  const conversation = await getConversationById(conversationId);
  if (!ensureGroupOwner(req, res, conversation)) return;

  const name = String(req.body.name || '').trim();
  if (!name) {
    req.flash('error', 'Podaj nazwę grupy.');
    return res.redirect(`/chat?c=${conversationId}`);
  }
  const nameCheck = moderateName(name);
  if (!nameCheck.ok) {
    req.flash('error', nameCheck.error);
    return res.redirect(`/chat?c=${conversationId}`);
  }

  await renameGroup(conversationId, name);
  req.flash('success', 'Nazwa grupy została zmieniona.');
  res.redirect(`/chat?c=${conversationId}`);
});

router.post('/:conversationId/photo', (req, res) => {
  groupPhotoUpload.single('photo')(req, res, async (err) => {
    if (handleGroupPhotoUploadError(req, res, err)) return;

    const { conversationId } = req.params;
    const conversation = await getConversationById(conversationId);
    if (!ensureGroupOwner(req, res, conversation)) return;

    if (!req.file) {
      req.flash('error', 'Wybierz plik ze zdjęciem.');
      return res.redirect(`/chat?c=${conversationId}`);
    }

    let photoUrl;
    try {
      const image = await sanitizeImage(req.file.buffer, { maxSize: 512 });
      const filename = `${Date.now()}-${conversationId}${image.ext}`;
      await fs.promises.writeFile(path.join(GROUP_PHOTO_DIR, filename), image.buffer);
      photoUrl = `/images/chat/groups/${filename}`;
    } catch (imageError) {
      if (!imageError.userFacing) console.error('Błąd przetwarzania zdjęcia grupy:', imageError);
      req.flash('error', imageError.userFacing ? imageError.message : 'Nie udało się przetworzyć zdjęcia.');
      return res.redirect(`/chat?c=${conversationId}`);
    }

    const oldPhotoUrl = conversation.photoUrl;
    await setGroupPhoto(conversationId, photoUrl);
    if (oldPhotoUrl && oldPhotoUrl.startsWith('/images/chat/groups/')) {
      fs.unlink(path.join(__dirname, '..', 'public', oldPhotoUrl), () => {});
    }

    req.flash('success', 'Zdjęcie grupy zostało zaktualizowane.');
    res.redirect(`/chat?c=${conversationId}`);
  });
});

router.post('/:conversationId/photo/remove', async (req, res) => {
  const { conversationId } = req.params;
  const conversation = await getConversationById(conversationId);
  if (!ensureGroupOwner(req, res, conversation)) return;

  const oldPhotoUrl = conversation.photoUrl;
  await setGroupPhoto(conversationId, null);
  if (oldPhotoUrl && oldPhotoUrl.startsWith('/images/chat/groups/')) {
    fs.unlink(path.join(__dirname, '..', 'public', oldPhotoUrl), () => {});
  }

  req.flash('success', 'Zdjęcie grupy zostało usunięte.');
  res.redirect(`/chat?c=${conversationId}`);
});

router.post('/:conversationId/members/:userId/remove', async (req, res) => {
  const { conversationId, userId } = req.params;
  const conversation = await getConversationById(conversationId);
  if (!ensureGroupOwner(req, res, conversation)) return;

  const removedUsername = conversation.memberNames[userId];
  const ok = await removeGroupMember(conversationId, userId);
  req.flash(ok ? 'success' : 'error', ok ? `${removedUsername || 'Użytkownik'} został(a) usunięty(a) z grupy.` : 'Nie udało się usunąć tego uczestnika.');
  res.redirect(`/chat?c=${conversationId}`);
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

/* --------------------- WŁĄCZ/WYŁĄCZ MOŻLIWOŚĆ ODPOWIEDZI (ADMIN) --------------------- */

// Jedyne miejsce, w którym da się zmienić canReply - obowiązuje od razu w danej rozmowie,
// niezależnie od tego, którą ścieżką (szybki start czy panel admina) ta rozmowa powstała.
router.post('/:conversationId/toggle-reply', async (req, res, next) => {
  try {
    if (req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Brak uprawnień.' });
    }
    const { conversationId } = req.params;
    const conversation = await getConversationById(conversationId);
    if (
      !conversation ||
      conversation.type !== 'dm' ||
      !conversation.memberIds.includes(req.session.user.id)
    ) {
      return res.status(404).json({ error: 'Nie znaleziono rozmowy.' });
    }

    const canReply = !conversation.canReply;
    await setCanReply(conversationId, canReply);

    const otherId = conversation.memberIds.find((id) => id !== req.session.user.id);
    const otherUsername = (otherId && conversation.memberNames[otherId]) || conversationId;
    await logAdminAction(
      req,
      'user.message',
      'user',
      otherUsername,
      canReply ? 'Włączono możliwość odpowiedzi' : 'Wyłączono możliwość odpowiedzi'
    );

    res.json({ canReply });
  } catch (err) {
    next(err);
  }
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

  const kind = req.body.kind === 'gif' ? 'gif' : 'text';
  const rawText = (req.body.text || '').trim();
  if (!rawText) {
    return res.status(400).json({ error: kind === 'gif' ? 'Nie wybrano GIF-a.' : 'Wiadomość nie może być pusta.' });
  }

  const conversation = await getConversationById(conversationId);
  if (conversation && conversation.type === 'dm') {
    // W rozmowie prywatnej nie da się pisać do osoby, która zablokowała nas albo którą zablokowaliśmy.
    const otherId = conversation.memberIds.find((id) => id !== req.session.user.id);
    if (otherId && (await isBlockedEitherWay(req.session.user.id, otherId))) {
      return res.status(403).json({ error: 'Nie możesz wysyłać wiadomości do tego użytkownika (jedna ze stron zablokowała drugą).' });
    }
    // Administrator mógł wyłączyć odpowiedź w tej rozmowie - wtedy tylko admin może w niej pisać.
    if (!conversation.canReply && req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator wyłączył możliwość odpowiedzi w tej rozmowie.' });
    }
  }

  let finalText;
  if (kind === 'gif') {
    // Adres musi naprawdę pochodzić z CDN Giphy (zob. utils/giphy.js) - inaczej ktoś mógłby
    // podesłać w wiadomości dowolny zewnętrzny obrazek, pomijając wyszukiwarkę i moderację.
    if (!isGiphyCdnUrl(rawText)) {
      return res.status(400).json({ error: 'Nieprawidłowy adres GIF-a.' });
    }
    finalText = rawText;
  } else {
    const checked = moderateText(rawText.slice(0, 1000), { userId: req.session.user.id });
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error });
    }
    finalText = checked.text;
  }

  const message = await addMessage({
    conversationId,
    senderId: req.session.user.id,
    senderUsername: req.session.user.username,
    text: finalText,
    kind,
  });
  await markConversationRead(req.session.user.id, conversationId);

  res.json({ message });
});

module.exports = router;