const { v4: uuidv4 } = require('uuid');
const { readCollection, writeCollection } = require('./dataStore');
const { getGameById } = require('./gameHelpers');

/* ------------------------------ ROZMOWY ------------------------------ */

function getConversationsForUser(userId) {
  return readCollection('conversations')
    .filter((c) => c.memberIds.includes(userId))
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt || b.createdAt) -
        new Date(a.lastMessageAt || a.createdAt)
    );
}

function getConversationById(id) {
  return readCollection('conversations').find((c) => c.id === id) || null;
}

function canAccessConversation(userId, conversationId) {
  const conv = getConversationById(conversationId);
  return !!conv && conv.memberIds.includes(userId);
}

function getOrCreateDM(userA, userB) {
  const conversations = readCollection('conversations');
  const existing = conversations.find(
    (c) =>
      c.type === 'dm' &&
      c.memberIds.length === 2 &&
      c.memberIds.includes(userA.id) &&
      c.memberIds.includes(userB.id)
  );
  if (existing) return existing;

  const conv = {
    id: uuidv4(),
    type: 'dm',
    name: null,
    memberIds: [userA.id, userB.id],
    memberNames: { [userA.id]: userA.username, [userB.id]: userB.username },
    createdAt: new Date().toISOString(),
    lastMessageAt: null,
  };
  conversations.push(conv);
  writeCollection('conversations', conversations);
  return conv;
}

function createGroup({ name, ownerId, ownerUsername, members }) {
  const conversations = readCollection('conversations');
  const memberIds = [ownerId, ...members.map((m) => m.id)];
  const memberNames = { [ownerId]: ownerUsername };
  members.forEach((m) => {
    memberNames[m.id] = m.username;
  });

  const conv = {
    id: uuidv4(),
    type: 'group',
    name,
    ownerId,
    memberIds: [...new Set(memberIds)],
    memberNames,
    createdAt: new Date().toISOString(),
    lastMessageAt: null,
  };
  conversations.push(conv);
  writeCollection('conversations', conversations);
  return conv;
}

/** Zwraca (lub tworzy) pokój dyskusyjny przypisany do konkretnej gry. */
function getOrCreateGameRoom(gameId, userId, username) {
  const game = getGameById(gameId);
  if (!game) return null;

  const conversations = readCollection('conversations');
  let conv = conversations.find(
    (c) => c.type === 'game-room' && c.gameId === gameId
  );

  if (!conv) {
    conv = {
      id: uuidv4(),
      type: 'game-room',
      name: `#${game.title.toLowerCase().replace(/\s+/g, '-')}`,
      gameId,
      memberIds: [],
      memberNames: {},
      createdAt: new Date().toISOString(),
      lastMessageAt: null,
    };
    conversations.push(conv);
  }

  if (userId && !conv.memberIds.includes(userId)) {
    conv.memberIds.push(userId);
    conv.memberNames[userId] = username;
  }

  writeCollection('conversations', conversations);
  return conv;
}

function touchConversation(conversationId, when) {
  const conversations = readCollection('conversations');
  const idx = conversations.findIndex((c) => c.id === conversationId);
  if (idx === -1) return;
  conversations[idx].lastMessageAt = when;
  writeCollection('conversations', conversations);
}

/* ----------------------------- WIADOMOŚCI ----------------------------- */

function getMessages(conversationId) {
  return readCollection('messages')
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function getMessagesAfter(conversationId, afterIso) {
  const all = getMessages(conversationId);
  if (!afterIso) return all;
  return all.filter((m) => new Date(m.createdAt) > new Date(afterIso));
}

function addMessage({ conversationId, senderId, senderUsername, text }) {
  const messages = readCollection('messages');
  const message = {
    id: uuidv4(),
    conversationId,
    senderId,
    senderUsername,
    text,
    createdAt: new Date().toISOString(),
  };
  messages.push(message);
  writeCollection('messages', messages);
  touchConversation(conversationId, message.createdAt);
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
};
