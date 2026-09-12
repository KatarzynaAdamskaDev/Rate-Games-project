const { v4: uuidv4 } = require('uuid');
const { readCollection, writeCollection } = require('./dataStore');

const STATUSES = ['gram', 'ukonczone', 'porzucone', 'lista'];

const STATUS_LABELS = {
  gram: 'Gram teraz',
  ukonczone: 'Ukończone',
  porzucone: 'Porzucone',
  lista: 'Na liście',
};

function getUserBacklog(userId) {
  return readCollection('backlog').filter((b) => b.userId === userId);
}

function setStatus(userId, gameId, status) {
  if (!STATUSES.includes(status)) return null;

  const backlog = readCollection('backlog');
  const idx = backlog.findIndex(
    (b) => b.userId === userId && b.gameId === gameId
  );

  if (idx === -1) {
    const entry = {
      id: uuidv4(),
      userId,
      gameId,
      status,
      updatedAt: new Date().toISOString(),
    };
    backlog.push(entry);
    writeCollection('backlog', backlog);
    return entry;
  }

  backlog[idx].status = status;
  backlog[idx].updatedAt = new Date().toISOString();
  writeCollection('backlog', backlog);
  return backlog[idx];
}

function removeEntry(userId, gameId) {
  const backlog = readCollection('backlog');
  const next = backlog.filter(
    (b) => !(b.userId === userId && b.gameId === gameId)
  );
  writeCollection('backlog', next);
  return next.length !== backlog.length;
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  getUserBacklog,
  setStatus,
  removeEntry,
};
