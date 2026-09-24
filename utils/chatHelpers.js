const { Op, fn, col } = require('sequelize');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ConversationRead = require('../models/ConversationRead');
const MessageReaction = require('../models/MessageReaction');
const User = require('../models/User');
const chatEvents = require('./chatEvents');

/** Zamienia instancję Sequelize na zwykły obiekt, parsując pola JSON. */
function serializeConversation(instance) {
  if (!instance) return null;
  // Kopia: get({ plain: true }) zwraca dataValues instancji, więc nadpisanie pól JSON-em zepsułoby ją
  // (kolejne serializeConversation na tej samej instancji parsowałoby już tablicę, a nie tekst).
  const plain = { ...instance.get({ plain: true }) };
  plain.memberIds = JSON.parse(plain.memberIds || '[]');
  plain.memberNames = JSON.parse(plain.memberNames || '{}');
  plain.pendingMemberIds = JSON.parse(plain.pendingMemberIds || '[]');
  plain.pendingMemberNames = JSON.parse(plain.pendingMemberNames || '{}');
  return plain;
}

/* --------------------- ZDARZENIA W CZASIE RZECZYWISTYM --------------------- */

/**
 * Zdarzenia (SSE) są dodatkiem do zapisu w bazie - ich awaria nie może zepsuć wysyłania wiadomości
 * ani zarządzania grupą, więc każdy błąd jest tu połykany.
 */
function safePublish(userIds, event, data) {
  try {
    chatEvents.publish(userIds, event, data);
  } catch (err) {
    console.error('Nie udało się wysłać zdarzenia czatu:', err.message);
  }
}

/**
 * Powiadamia uczestników rozmowy, że zmieniła się ona sama (a nie jej wiadomości): klient odświeża listę,
 * a przy otwartej rozmowie - jej widok. Powody: 'new', 'invite', 'meta' (nazwa/zdjęcie/członkowie/uprawnienia),
 * 'cleared' (wyczyszczona), 'gone' (rozmowa usunięta albo użytkownik nie jest już jej członkiem).
 */
function publishSync(userIds, conversationId, reason) {
  safePublish(userIds, 'sync', { conversationId, reason });
}

async function publishSyncToMembers(conversationId, reason, { extraUserIds = [] } = {}) {
  try {
    const conv = await getConversationById(conversationId);
    if (conv) publishSync([...conv.memberIds, ...extraUserIds], conversationId, reason);
  } catch (err) {
    console.error('Nie udało się wysłać zdarzenia czatu:', err.message);
  }
}

/* ------------------------------ ROZMOWY ------------------------------ */

async function getConversationsForUser(userId) {
  const rows = await Conversation.findAll();
  return rows
    .map(serializeConversation)
    .filter((c) => c.memberIds.includes(userId))
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt || b.createdAt) -
        new Date(a.lastMessageAt || a.createdAt)
    );
}

async function getConversationById(id) {
  const instance = await Conversation.findByPk(id);
  return serializeConversation(instance);
}

async function canAccessConversation(userId, conversationId) {
  const conv = await getConversationById(conversationId);
  return !!conv && conv.memberIds.includes(userId);
}

/**
 * Dokleja do rozmów awatary członków (id -> avatarUrl albo null), jednym zapytaniem
 * niezależnie od liczby rozmów/członków. Osobna funkcja (nie w getConversationsForUser),
 * bo tamta jest też na gorącej ścieżce dostępu (canAccessConversation) - avatar potrzebny
 * jest tylko tam, gdzie faktycznie renderujemy listę/rozmowę.
 */
async function attachAvatars(conversations) {
  const list = Array.isArray(conversations) ? conversations : [conversations];
  const ids = new Set();
  list.forEach((c) => c && c.memberIds.forEach((id) => ids.add(id)));

  let avatarById = new Map();
  if (ids.size > 0) {
    const users = await User.findAll({ where: { id: [...ids] }, attributes: ['id', 'avatarUrl'] });
    avatarById = new Map(users.map((u) => [u.id, u.avatarUrl || null]));
  }

  const withAvatars = list.map((c) => {
    if (!c) return c;
    const memberAvatars = {};
    c.memberIds.forEach((id) => {
      memberAvatars[id] = avatarById.get(id) || null;
    });
    return { ...c, memberAvatars };
  });

  return Array.isArray(conversations) ? withAvatars : withAvatars[0];
}

/**
 * @param {{ canReply?: boolean }} [options] tylko przy tworzeniu NOWEJ rozmowy (np. admin piszący
 *   bez wzajemnej obserwacji) - jeśli rozmowa już istnieje, jej dotychczasowe ustawienie zostaje bez zmian.
 */
async function getOrCreateDM(userA, userB, { canReply = true } = {}) {
  const rows = await Conversation.findAll({ where: { type: 'dm' } });
  const existing = rows
    .map(serializeConversation)
    .find(
      (c) =>
        c.memberIds.length === 2 &&
        c.memberIds.includes(userA.id) &&
        c.memberIds.includes(userB.id)
    );
  if (existing) return existing;

  const instance = await Conversation.create({
    type: 'dm',
    name: null,
    canReply,
    memberIds: JSON.stringify([userA.id, userB.id]),
    memberNames: JSON.stringify({
      [userA.id]: userA.username,
      [userB.id]: userB.username,
    }),
  });
  const created = serializeConversation(instance);
  publishSync(created.memberIds, created.id, 'new');
  return created;
}

/**
 * Tworzy grupę z samym właścicielem jako członkiem - pozostałych zaprasza się osobno
 * (inviteMembersToGroup), bo muszą zaakceptować, zanim trafią do memberIds.
 */
async function createGroup({ name, ownerId, ownerUsername, photoUrl }) {
  const instance = await Conversation.create({
    type: 'group',
    name,
    ownerId,
    photoUrl: photoUrl || null,
    memberIds: JSON.stringify([ownerId]),
    memberNames: JSON.stringify({ [ownerId]: ownerUsername }),
  });
  return serializeConversation(instance);
}

/**
 * Zaprasza użytkowników (tablica { id, username }) do grupy - trafiają do pendingMemberIds,
 * a nie od razu do memberIds. Pomija tych, którzy już są członkami albo mają już zaproszenie.
 * @returns lista faktycznie zaproszonych (do wysłania powiadomień).
 */
async function inviteMembersToGroup(conversationId, users) {
  const instance = await Conversation.findByPk(conversationId);
  if (!instance || instance.type !== 'group') return [];
  const conv = serializeConversation(instance);

  const invited = [];
  users.forEach((u) => {
    if (conv.memberIds.includes(u.id) || conv.pendingMemberIds.includes(u.id)) return;
    conv.pendingMemberIds.push(u.id);
    conv.pendingMemberNames[u.id] = u.username;
    invited.push(u);
  });

  if (invited.length > 0) {
    instance.pendingMemberIds = JSON.stringify(conv.pendingMemberIds);
    instance.pendingMemberNames = JSON.stringify(conv.pendingMemberNames);
    await instance.save();
    publishSync(invited.map((u) => u.id), conversationId, 'invite');
    publishSync(conv.memberIds, conversationId, 'meta');
  }
  return invited;
}

/** Zaproszenia do grup, na które dany użytkownik jeszcze nie odpowiedział. */
async function getPendingInvitesForUser(userId) {
  const rows = await Conversation.findAll({ where: { type: 'group' } });
  return rows.map(serializeConversation).filter((c) => c.pendingMemberIds.includes(userId));
}

/** Zaakceptowanie zaproszenia: przenosi z pendingMemberIds do memberIds. */
async function acceptGroupInvite(conversationId, userId, username) {
  const instance = await Conversation.findByPk(conversationId);
  if (!instance || instance.type !== 'group') return false;
  const conv = serializeConversation(instance);
  if (!conv.pendingMemberIds.includes(userId)) return false;

  const pendingMemberIds = conv.pendingMemberIds.filter((id) => id !== userId);
  const pendingMemberNames = { ...conv.pendingMemberNames };
  delete pendingMemberNames[userId];

  const memberIds = conv.memberIds.includes(userId) ? conv.memberIds : [...conv.memberIds, userId];
  const memberNames = { ...conv.memberNames, [userId]: username };

  instance.memberIds = JSON.stringify(memberIds);
  instance.memberNames = JSON.stringify(memberNames);
  instance.pendingMemberIds = JSON.stringify(pendingMemberIds);
  instance.pendingMemberNames = JSON.stringify(pendingMemberNames);
  await instance.save();
  publishSync(memberIds, conversationId, 'meta');
  return true;
}

/** Odrzucenie zaproszenia: po prostu znika z pendingMemberIds. */
async function declineGroupInvite(conversationId, userId) {
  const instance = await Conversation.findByPk(conversationId);
  if (!instance || instance.type !== 'group') return false;
  const conv = serializeConversation(instance);
  if (!conv.pendingMemberIds.includes(userId)) return false;

  const pendingMemberIds = conv.pendingMemberIds.filter((id) => id !== userId);
  const pendingMemberNames = { ...conv.pendingMemberNames };
  delete pendingMemberNames[userId];

  instance.pendingMemberIds = JSON.stringify(pendingMemberIds);
  instance.pendingMemberNames = JSON.stringify(pendingMemberNames);
  await instance.save();
  publishSync(conv.memberIds, conversationId, 'meta');
  return true;
}

/** Zmiana nazwy grupy (tylko type='group' - wywołujący sprawdza, że to właściciel). */
async function renameGroup(conversationId, name) {
  const [count] = await Conversation.update({ name }, { where: { id: conversationId, type: 'group' } });
  if (count > 0) await publishSyncToMembers(conversationId, 'meta');
  return count > 0;
}

/** Ustawia/zdejmuje zdjęcie grupy (photoUrl=null usuwa - wraca gradient domyślny w interfejsie). */
async function setGroupPhoto(conversationId, photoUrl) {
  const [count] = await Conversation.update({ photoUrl }, { where: { id: conversationId, type: 'group' } });
  if (count > 0) await publishSyncToMembers(conversationId, 'meta');
  return count > 0;
}

/**
 * Kto może wyczyścić albo usunąć rozmowę dla wszystkich jej uczestników:
 * rozmowa prywatna - każda ze stron, grupa - tylko właściciel.
 */
function canDestroyConversation(conversation, userId) {
  if (!conversation || !conversation.memberIds.includes(userId)) return false;
  if (conversation.type === 'dm') return true;
  if (conversation.type === 'group') return conversation.ownerId === userId;
  return false;
}

/**
 * Opuszczenie grupy przez członka. Właściciel może wyjść, jeśli w grupie ktoś zostaje - własność
 * przechodzi wtedy na najdłużej będącego członka; ostatnia osoba wychodząc usuwa grupę.
 * @returns {{ ok: boolean, deleted?: boolean, newOwnerId?: string }}
 */
async function leaveGroup(conversationId, userId) {
  const instance = await Conversation.findByPk(conversationId);
  if (!instance || instance.type !== 'group') return { ok: false };
  const conv = serializeConversation(instance);
  if (!conv.memberIds.includes(userId)) return { ok: false };

  const memberIds = conv.memberIds.filter((id) => id !== userId);
  if (memberIds.length === 0) {
    await deleteConversation(conversationId);
    return { ok: true, deleted: true };
  }

  const memberNames = { ...conv.memberNames };
  delete memberNames[userId];
  instance.memberIds = JSON.stringify(memberIds);
  instance.memberNames = JSON.stringify(memberNames);

  let newOwnerId;
  if (conv.ownerId === userId) {
    newOwnerId = memberIds[0];
    instance.ownerId = newOwnerId;
  }
  await instance.save();
  await ConversationRead.destroy({ where: { userId, conversationId } });
  publishSync([userId], conversationId, 'gone');
  publishSync(memberIds, conversationId, 'meta');
  return { ok: true, newOwnerId };
}

/** Przekazanie własności grupy innemu jej członkowi (wywołujący sprawdza, że to obecny właściciel). */
async function transferGroupOwnership(conversationId, newOwnerId) {
  const instance = await Conversation.findByPk(conversationId);
  if (!instance || instance.type !== 'group') return false;
  const conv = serializeConversation(instance);
  if (!conv.memberIds.includes(newOwnerId) || conv.ownerId === newOwnerId) return false;
  instance.ownerId = newOwnerId;
  await instance.save();
  publishSync(conv.memberIds, conversationId, 'meta');
  return true;
}

/** Usuwa członka z grupy. Właściciela nie da się w ten sposób usunąć. */
async function removeGroupMember(conversationId, userId) {
  const instance = await Conversation.findByPk(conversationId);
  if (!instance || instance.type !== 'group' || instance.ownerId === userId) return false;
  const conv = serializeConversation(instance);
  if (!conv.memberIds.includes(userId)) return false;

  const memberIds = conv.memberIds.filter((id) => id !== userId);
  const memberNames = { ...conv.memberNames };
  delete memberNames[userId];

  instance.memberIds = JSON.stringify(memberIds);
  instance.memberNames = JSON.stringify(memberNames);
  await instance.save();
  publishSync([userId], conversationId, 'gone');
  publishSync(memberIds, conversationId, 'meta');
  return true;
}

/**
 * Pokoje gier zlikwidowano (zostały tylko rozmowy prywatne i grupy). Przy starcie usuwamy pokoje, które
 * zostały w bazie po dawnej wersji, razem z ich wiadomościami. Bezpieczne do wielokrotnego wywołania.
 * @returns {Promise<number>} liczba usuniętych pokoi
 */
async function removeGameRooms() {
  const rooms = await Conversation.findAll({ where: { type: 'game-room' }, attributes: ['id'] });
  for (const room of rooms) await deleteConversation(room.id);
  return rooms.length;
}

/** Włącza/wyłącza możliwość odpowiedzi w rozmowie prywatnej (patrz routes/chat.js, tylko admin). */
async function setCanReply(conversationId, canReply) {
  const [count] = await Conversation.update({ canReply }, { where: { id: conversationId, type: 'dm' } });
  if (count > 0) await publishSyncToMembers(conversationId, 'meta');
  return count > 0;
}

async function touchConversation(conversationId, when) {
  await Conversation.update(
    { lastMessageAt: when },
    { where: { id: conversationId } }
  );
}

/** Usuwa wszystkie wiadomości z rozmowy, ale zostawia samą rozmowę. */
async function clearMessages(conversationId) {
  await MessageReaction.destroy({ where: { conversationId } });
  const count = await Message.destroy({ where: { conversationId } });
  await publishSyncToMembers(conversationId, 'cleared');
  return count;
}

/** Usuwa całą rozmowę razem z jej wiadomościami. */
async function deleteConversation(conversationId) {
  const conv = await getConversationById(conversationId);
  await MessageReaction.destroy({ where: { conversationId } });
  await Message.destroy({ where: { conversationId } });
  await ConversationRead.destroy({ where: { conversationId } });
  const count = await Conversation.destroy({ where: { id: conversationId } });
  if (conv && count > 0) publishSync(conv.memberIds, conversationId, 'gone');
  return count > 0;
}

/** Nazwa wyświetlana przy wiadomościach użytkownika, którego konto usunięto. */
const DELETED_USER_LABEL = 'Usunięty użytkownik';

/**
 * Sprząta czaty po usunięciu konta:
 * - rozmowy prywatne (DM) z tym użytkownikiem są usuwane razem z wiadomościami,
 * - z grup i pokojów gier użytkownik jest usuwany z listy członków (grupa, w której
 *   zostałaby jedna osoba, jest usuwana; właściciel przechodzi na kolejnego członka),
 * - jego wiadomości w grupach/pokojach zostają, ale są podpisane jako "Usunięty użytkownik".
 */
async function removeUserFromConversations(userId) {
  const rows = await Conversation.findAll();

  for (const row of rows) {
    const conv = serializeConversation(row);
    const isPendingOnly = !conv.memberIds.includes(userId) && conv.pendingMemberIds.includes(userId);

    if (isPendingOnly) {
      // Tylko oczekujące zaproszenie do grupy - wystarczy je zdjąć, reszta grupy zostaje bez zmian.
      const pendingMemberIds = conv.pendingMemberIds.filter((id) => id !== userId);
      const pendingMemberNames = { ...conv.pendingMemberNames };
      delete pendingMemberNames[userId];
      row.pendingMemberIds = JSON.stringify(pendingMemberIds);
      row.pendingMemberNames = JSON.stringify(pendingMemberNames);
      await row.save();
      continue;
    }

    if (!conv.memberIds.includes(userId)) continue;

    const memberIds = conv.memberIds.filter((id) => id !== userId);

    if (conv.type === 'dm' || (conv.type === 'group' && memberIds.length < 2)) {
      await deleteConversation(conv.id);
      continue;
    }

    const memberNames = { ...conv.memberNames };
    delete memberNames[userId];

    row.memberIds = JSON.stringify(memberIds);
    row.memberNames = JSON.stringify(memberNames);
    if (conv.ownerId === userId) row.ownerId = memberIds[0] || null;
    await row.save();
  }

  await Message.update(
    { senderUsername: DELETED_USER_LABEL },
    { where: { senderId: userId } }
  );
  await MessageReaction.destroy({ where: { userId } });
  await ConversationRead.destroy({ where: { userId } });
  chatEvents.closeUser(userId);
}

/* ------------------------- NIEPRZECZYTANE WIADOMOŚCI ------------------------- */

/** Zapamiętuje, że użytkownik przeczytał rozmowę (do tej chwili). */
async function markConversationRead(userId, conversationId) {
  const now = new Date();
  const [row, created] = await ConversationRead.findOrCreate({
    where: { userId, conversationId },
    defaults: { lastReadAt: now },
  });
  if (!created) {
    row.lastReadAt = now;
    await row.save();
  }
}

function laterOf(a, b) {
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

/**
 * Liczba nieprzeczytanych wiadomości (cudzych, nowszych niż ostatni odczyt):
 * łącznie i w podziale na rozmowy. Rozmowa bez wpisu odczytu liczy się od jej utworzenia.
 *
 * To jest odpytywane bardzo często (navbar co 2s, lista czatu co 6s), więc licząc wiadomości
 * per rozmowa nie robimy N osobnych zapytań w pętli - jedno zapytanie z GROUP BY per użytkownika,
 * niezależnie od tego, ile ma rozmów.
 */
async function getUnreadCounts(userId, { since = null } = {}) {
  const conversations = await getConversationsForUser(userId);
  if (conversations.length === 0) return { total: 0, byConversation: {} };

  const reads = await ConversationRead.findAll({
    where: { userId, conversationId: { [Op.in]: conversations.map((c) => c.id) } },
  });
  const lastRead = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

  const rows = await Message.findAll({
    attributes: ['conversationId', [fn('COUNT', col('id')), 'cnt']],
    where: {
      senderId: { [Op.ne]: userId },
      deletedAt: null, // usunięta wiadomość nie jest "nowa"
      [Op.or]: conversations.map((conv) => ({
        conversationId: conv.id,
        createdAt: { [Op.gt]: laterOf(lastRead.get(conv.id) || conv.createdAt, since) },
      })),
    },
    group: ['conversationId'],
    raw: true,
  });

  const byConversation = {};
  let total = 0;
  rows.forEach((row) => {
    const count = Number(row.cnt);
    if (count > 0) {
      byConversation[row.conversationId] = count;
      total += count;
    }
  });

  return { total, byConversation };
}

/**
 * Jednorazowe uzupełnienie przy starcie: istniejące rozmowy uznajemy za przeczytane,
 * żeby po wdrożeniu licznika cała historia nie świeciła się jako nowa.
 */
async function seedConversationReads() {
  const conversations = (await Conversation.findAll()).map(serializeConversation);
  const existing = new Set(
    (await ConversationRead.findAll()).map((r) => `${r.userId}:${r.conversationId}`)
  );
  const now = new Date();

  for (const conv of conversations) {
    for (const userId of conv.memberIds) {
      if (existing.has(`${userId}:${conv.id}`)) continue;
      await ConversationRead.create({ userId, conversationId: conv.id, lastReadAt: now });
    }
  }
}

/* ----------------------------- WIADOMOŚCI ----------------------------- */

/**
 * Dostępne reakcje. Do bazy trafia tylko klucz; ikony (Bootstrap Icons) i podpisy klient trzyma
 * u siebie w public/js/chat-core.js (REACTIONS) - test pilnuje, żeby oba spisy się zgadzały.
 */
const REACTION_KEYS = ['like', 'love', 'haha', 'wow', 'sad', 'fire'];

/** Długość podglądu wiadomości, na którą odpowiadamy (cytat nad odpowiedzią). */
const REPLY_PREVIEW_LENGTH = 120;

/** Zapytania z długą listą id dzielimy na paczki - MSSQL (Azure SQL) ma limit ok. 2100 parametrów. */
const IN_CHUNK = 500;

async function findInChunks(Model, field, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    rows.push(...(await Model.findAll({ where: { [field]: ids.slice(i, i + IN_CHUNK) } })));
  }
  return rows;
}

function groupReactions(reactionRows) {
  const byKey = new Map();
  reactionRows.forEach((r) => {
    if (!byKey.has(r.key)) byKey.set(r.key, { key: r.key, userIds: [], usernames: [] });
    byKey.get(r.key).userIds.push(r.userId);
    byKey.get(r.key).usernames.push(r.username);
  });
  // Stała kolejność (jak na liście reakcji), niezależnie od tego, kto zareagował pierwszy.
  return REACTION_KEYS.filter((key) => byKey.has(key)).map((key) => byKey.get(key));
}

function buildReplyRef(target, replyToId) {
  if (!target || target.deletedAt) {
    return {
      id: replyToId,
      deleted: true,
      senderUsername: target ? target.senderUsername : '',
      kind: 'text',
      preview: '',
    };
  }
  return {
    id: target.id,
    deleted: false,
    senderUsername: target.senderUsername,
    kind: target.kind,
    preview: target.kind === 'gif' ? '' : target.text.slice(0, REPLY_PREVIEW_LENGTH),
  };
}

/**
 * Wiadomość w postaci, w której idzie do klientów (odpowiedź JSON, zdarzenia SSE): bez zależności od tego,
 * kto ją ogląda - reakcje to lista { key, userIds, usernames }, "moje" wylicza dopiero przeglądarka.
 */
function serializeMessage(row, reactionRows, replyTarget) {
  const plain = row.get ? row.get({ plain: true }) : { ...row };
  const deleted = !!plain.deletedAt;
  return {
    id: plain.id,
    conversationId: plain.conversationId,
    senderId: plain.senderId,
    senderUsername: plain.senderUsername,
    senderDeleted: plain.senderUsername === DELETED_USER_LABEL,
    kind: plain.kind,
    text: deleted ? '' : plain.text,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    editedAt: plain.editedAt || null,
    deleted,
    replyTo: plain.replyToId ? buildReplyRef(replyTarget, plain.replyToId) : null,
    reactions: deleted ? [] : groupReactions(reactionRows || []),
  };
}

/** Dokłada do wierszy Message reakcje i cytowane wiadomości (stała liczba zapytań, nie jedno na wiadomość). */
async function hydrateMessages(rows, { conversationId } = {}) {
  if (rows.length === 0) return [];

  const reactions = conversationId
    ? await MessageReaction.findAll({ where: { conversationId }, order: [['createdAt', 'ASC']] })
    : await findInChunks(MessageReaction, 'messageId', rows.map((r) => r.id));
  const reactionsByMessage = new Map();
  reactions.forEach((r) => {
    if (!reactionsByMessage.has(r.messageId)) reactionsByMessage.set(r.messageId, []);
    reactionsByMessage.get(r.messageId).push(r);
  });

  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter(Boolean))];
  const targets = replyIds.length > 0 ? await findInChunks(Message, 'id', replyIds) : [];
  const targetById = new Map(targets.map((t) => [t.id, t]));

  return rows.map((row) =>
    serializeMessage(row, reactionsByMessage.get(row.id), row.replyToId ? targetById.get(row.replyToId) : null)
  );
}

async function getMessages(conversationId) {
  const rows = await Message.findAll({
    where: { conversationId },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });
  return hydrateMessages(rows, { conversationId });
}

/** Ostatnia wiadomość rozmowy (do podglądu na liście mini czatu). */
async function getLastMessage(conversationId) {
  const row = await Message.findOne({
    where: { conversationId },
    order: [['createdAt', 'DESC']],
  });
  return row ? row.get({ plain: true }) : null;
}

/** Wiadomości NOWSZE niż podana chwila (createdAt). */
async function getMessagesAfter(conversationId, afterIso) {
  if (!afterIso) return getMessages(conversationId);
  const after = new Date(afterIso);
  if (Number.isNaN(after.getTime())) return getMessages(conversationId);
  const rows = await Message.findAll({
    where: { conversationId, createdAt: { [Op.gt]: after } },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });
  return hydrateMessages(rows, { conversationId });
}

/**
 * Wiadomości nowe ALBO zmienione (edycja, usunięcie, reakcja) od podanej chwili - do dociągania zmian, gdy
 * zdarzenie SSE nie dotarło (zerwane połączenie, inna instancja serwera). Porównanie jest domknięte (>=),
 * a klient wstawia wiadomości idempotentnie, więc powtórka tej samej nie szkodzi.
 */
async function getMessagesSince(conversationId, sinceIso) {
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return getMessages(conversationId);
  const rows = await Message.findAll({
    where: { conversationId, updatedAt: { [Op.gte]: since } },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });
  return hydrateMessages(rows, { conversationId });
}

/** Rozsyła wiadomość (nową albo zmienioną) uczestnikom rozmowy. */
async function publishMessage(message, { newMessage = false } = {}) {
  try {
    const conv = await getConversationById(message.conversationId);
    if (!conv) return;
    safePublish(conv.memberIds, 'message', { conversationId: conv.id, message });
    // Nowa wiadomość zmienia liczniki nieprzeczytanych w navbarze pozostałych uczestników.
    if (newMessage) safePublish(conv.memberIds.filter((id) => id !== message.senderId), 'summary', {});
  } catch (err) {
    console.error('Nie udało się wysłać zdarzenia czatu:', err.message);
  }
}

/** Sygnał "pisze..." - nigdzie go nie zapisujemy, tylko przekazujemy pozostałym uczestnikom. */
async function publishTyping(conversationId, user) {
  const conv = await getConversationById(conversationId);
  if (!conv) return;
  safePublish(
    conv.memberIds.filter((id) => id !== user.id),
    'typing',
    { conversationId, userId: user.id, username: user.username }
  );
}

/**
 * @returns {Promise<{ ok: true, message: object } | { ok: false, error: 'reply-not-found' | 'reply-deleted' }>}
 */
async function addMessage({ conversationId, senderId, senderUsername, text, kind = 'text', replyToId = null }) {
  let replyTarget = null;
  if (replyToId) {
    // Odpowiadać można tylko na istniejącą wiadomość z tej samej rozmowy (inaczej ktoś mógłby
    // podczepić cytat z cudzej, prywatnej rozmowy).
    replyTarget = await Message.findOne({ where: { id: replyToId, conversationId } });
    if (!replyTarget) return { ok: false, error: 'reply-not-found' };
    if (replyTarget.deletedAt) return { ok: false, error: 'reply-deleted' };
  }

  const instance = await Message.create({
    conversationId,
    senderId,
    senderUsername,
    text,
    kind,
    replyToId: replyTarget ? replyTarget.id : null,
  });
  await touchConversation(conversationId, instance.createdAt);
  const message = serializeMessage(instance, [], replyTarget);
  await publishMessage(message, { newMessage: true });
  return { ok: true, message };
}

/**
 * Edycja własnej wiadomości tekstowej. Bez zmiany treści nic się nie dzieje (nie ma znaczka "edytowano").
 * @returns {Promise<{ ok: true, message: object } | { ok: false, error: 'not-found' | 'forbidden' | 'deleted' | 'not-text' }>}
 */
async function editMessage({ conversationId, messageId, userId, text }) {
  const row = await Message.findOne({ where: { id: messageId, conversationId } });
  if (!row) return { ok: false, error: 'not-found' };
  if (row.senderId !== userId) return { ok: false, error: 'forbidden' };
  if (row.deletedAt) return { ok: false, error: 'deleted' };
  if (row.kind !== 'text') return { ok: false, error: 'not-text' };

  const changed = row.text !== text;
  if (changed) {
    row.text = text;
    row.editedAt = new Date();
    await row.save();
  }
  const [message] = await hydrateMessages([row]);
  if (changed) await publishMessage(message);
  return { ok: true, message };
}

/**
 * "Miękkie" usunięcie: czyścimy treść i reakcje, wiersz zostaje jako znacznik usuniętej wiadomości.
 * Autor usuwa własne (userId); moderator - dowolną (force), z panelu zgłoszeń.
 * @returns {Promise<{ ok: true, message: object } | { ok: false, error: 'not-found' | 'forbidden' }>}
 */
async function deleteMessage({ conversationId, messageId, userId, force = false }) {
  const where = conversationId ? { id: messageId, conversationId } : { id: messageId };
  const row = await Message.findOne({ where });
  if (!row) return { ok: false, error: 'not-found' };
  if (!force && row.senderId !== userId) return { ok: false, error: 'forbidden' };

  if (!row.deletedAt) {
    row.text = '';
    row.deletedAt = new Date();
    await row.save();
    await MessageReaction.destroy({ where: { messageId: row.id } });
  }
  const [message] = await hydrateMessages([row]);
  await publishMessage(message);
  return { ok: true, message };
}

/**
 * Ustawia reakcję użytkownika na wiadomość: ten sam klucz drugi raz ją zdejmuje, inny - zmienia,
 * pusty klucz - zdejmuje. Zwraca wiadomość z aktualnym zestawem reakcji.
 * @returns {Promise<{ ok: true, message: object } | { ok: false, error: 'not-found' | 'deleted' | 'invalid-key' }>}
 */
async function setReaction({ conversationId, messageId, user, key }) {
  if (key && !REACTION_KEYS.includes(key)) return { ok: false, error: 'invalid-key' };
  const row = await Message.findOne({ where: { id: messageId, conversationId } });
  if (!row) return { ok: false, error: 'not-found' };
  if (row.deletedAt) return { ok: false, error: 'deleted' };

  const existing = await MessageReaction.findOne({ where: { messageId, userId: user.id } });
  if (existing && (!key || existing.key === key)) {
    await existing.destroy();
  } else if (existing) {
    existing.key = key;
    await existing.save();
  } else if (key) {
    await MessageReaction.create({ messageId, conversationId, userId: user.id, username: user.username, key });
  }

  // Reakcja nie zmienia wiersza wiadomości, a dociąganie zmian idzie po updatedAt - stąd ręczne "dotknięcie"
  // (Model.update z samym updatedAt niczego nie zmienia, dlatego przez instancję).
  row.changed('updatedAt', true);
  await row.save();
  const [message] = await hydrateMessages([row]);
  await publishMessage(message);
  return { ok: true, message };
}

/** Krótki podgląd ostatniej wiadomości do listy rozmów - GIF-a nie pokazujemy jako surowy adres URL. */
function previewText(message) {
  if (!message) return '';
  if (message.deletedAt) return 'Wiadomość usunięta';
  return message.kind === 'gif' ? 'GIF' : message.text.slice(0, 80);
}

module.exports = {
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
  canDestroyConversation,
  leaveGroup,
  transferGroupOwnership,
  removeGameRooms,
  getMessages,
  getLastMessage,
  getMessagesAfter,
  getMessagesSince,
  addMessage,
  editMessage,
  deleteMessage,
  setReaction,
  publishTyping,
  REACTION_KEYS,
  REPLY_PREVIEW_LENGTH,
  previewText,
  setCanReply,
  clearMessages,
  deleteConversation,
  removeUserFromConversations,
  markConversationRead,
  getUnreadCounts,
  seedConversationReads,
  DELETED_USER_LABEL,
};