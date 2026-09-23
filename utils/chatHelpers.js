const { Op, fn, col } = require('sequelize');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ConversationRead = require('../models/ConversationRead');
const User = require('../models/User');
const { getGameById } = require('./gameCatalog');

/** Zamienia instancję Sequelize na zwykły obiekt, parsując pola JSON. */
function serializeConversation(instance) {
  if (!instance) return null;
  const plain = instance.get({ plain: true });
  plain.memberIds = JSON.parse(plain.memberIds || '[]');
  plain.memberNames = JSON.parse(plain.memberNames || '{}');
  return plain;
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
  return serializeConversation(instance);
}

async function createGroup({ name, ownerId, ownerUsername, members }) {
  const memberIds = [ownerId, ...members.map((m) => m.id)];
  const memberNames = { [ownerId]: ownerUsername };
  members.forEach((m) => {
    memberNames[m.id] = m.username;
  });

  const instance = await Conversation.create({
    type: 'group',
    name,
    ownerId,
    memberIds: JSON.stringify([...new Set(memberIds)]),
    memberNames: JSON.stringify(memberNames),
  });
  return serializeConversation(instance);
}

/** Zwraca (lub tworzy) pokój dyskusyjny przypisany do konkretnej gry. */
async function getOrCreateGameRoom(gameId, userId, username) {
  const game = await getGameById(gameId);
  if (!game) return null;

  let instance = await Conversation.findOne({
    where: { type: 'game-room', gameId },
  });

  if (!instance) {
    instance = await Conversation.create({
      type: 'game-room',
      name: `#${game.title.toLowerCase().replace(/\s+/g, '-')}`,
      gameId,
      memberIds: '[]',
      memberNames: '{}',
    });
  }

  const conv = serializeConversation(instance);

  if (userId && !conv.memberIds.includes(userId)) {
    conv.memberIds.push(userId);
    conv.memberNames[userId] = username;
    instance.memberIds = JSON.stringify(conv.memberIds);
    instance.memberNames = JSON.stringify(conv.memberNames);
    await instance.save();
  }

  return serializeConversation(instance);
}

/** Włącza/wyłącza możliwość odpowiedzi w rozmowie prywatnej (patrz routes/chat.js, tylko admin). */
async function setCanReply(conversationId, canReply) {
  const [count] = await Conversation.update({ canReply }, { where: { id: conversationId, type: 'dm' } });
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
  return Message.destroy({ where: { conversationId } });
}

/** Usuwa całą rozmowę razem z jej wiadomościami. */
async function deleteConversation(conversationId) {
  await Message.destroy({ where: { conversationId } });
  await ConversationRead.destroy({ where: { conversationId } });
  const count = await Conversation.destroy({ where: { id: conversationId } });
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
  await ConversationRead.destroy({ where: { userId } });
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

/**
 * Liczba nieprzeczytanych wiadomości (cudzych, nowszych niż ostatni odczyt):
 * łącznie i w podziale na rozmowy. Rozmowa bez wpisu odczytu liczy się od jej utworzenia.
 *
 * To jest odpytywane bardzo często (navbar co 2s, lista czatu co 6s), więc licząc wiadomości
 * per rozmowa nie robimy N osobnych zapytań w pętli - jedno zapytanie z GROUP BY per użytkownika,
 * niezależnie od tego, ile ma rozmów.
 */
async function getUnreadCounts(userId) {
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
      [Op.or]: conversations.map((conv) => ({
        conversationId: conv.id,
        createdAt: { [Op.gt]: lastRead.get(conv.id) || conv.createdAt },
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

async function getMessages(conversationId) {
  const rows = await Message.findAll({ where: { conversationId } });
  return rows
    .map((m) => ({
      ...m.get({ plain: true }),
      senderDeleted: m.senderUsername === DELETED_USER_LABEL,
    }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** Ostatnia wiadomość rozmowy (do podglądu na liście mini czatu). */
async function getLastMessage(conversationId) {
  const row = await Message.findOne({
    where: { conversationId },
    order: [['createdAt', 'DESC']],
  });
  return row ? row.get({ plain: true }) : null;
}

async function getMessagesAfter(conversationId, afterIso) {
  const all = await getMessages(conversationId);
  if (!afterIso) return all;
  return all.filter((m) => new Date(m.createdAt) > new Date(afterIso));
}

async function addMessage({ conversationId, senderId, senderUsername, text, kind = 'text' }) {
  const instance = await Message.create({
    conversationId,
    senderId,
    senderUsername,
    text,
    kind,
  });
  const message = instance.get({ plain: true });
  await touchConversation(conversationId, message.createdAt);
  return message;
}

/** Krótki podgląd ostatniej wiadomości do listy rozmów - GIF-a nie pokazujemy jako surowy adres URL. */
function previewText(message) {
  if (!message) return '';
  return message.kind === 'gif' ? 'GIF' : message.text.slice(0, 80);
}

module.exports = {
  getConversationsForUser,
  getConversationById,
  canAccessConversation,
  attachAvatars,
  getOrCreateDM,
  createGroup,
  getOrCreateGameRoom,
  getMessages,
  getLastMessage,
  getMessagesAfter,
  addMessage,
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