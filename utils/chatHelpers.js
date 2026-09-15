const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { getGameById } = require('./gameHelpers');

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

async function getOrCreateDM(userA, userB) {
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
  const game = getGameById(gameId);
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
  const count = await Conversation.destroy({ where: { id: conversationId } });
  return count > 0;
}

/* ----------------------------- WIADOMOŚCI ----------------------------- */

async function getMessages(conversationId) {
  const rows = await Message.findAll({ where: { conversationId } });
  return rows
    .map((m) => m.get({ plain: true }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function getMessagesAfter(conversationId, afterIso) {
  const all = await getMessages(conversationId);
  if (!afterIso) return all;
  return all.filter((m) => new Date(m.createdAt) > new Date(afterIso));
}

async function addMessage({ conversationId, senderId, senderUsername, text }) {
  const instance = await Message.create({
    conversationId,
    senderId,
    senderUsername,
    text,
  });
  const message = instance.get({ plain: true });
  await touchConversation(conversationId, message.createdAt);
  return message;
}

module.exports = {
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
};