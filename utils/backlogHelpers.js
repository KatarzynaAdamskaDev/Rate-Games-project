const BacklogEntry = require('../models/BacklogEntry');

const STATUSES = ['gram', 'ukonczone', 'porzucone', 'lista'];

const STATUS_LABELS = {
  gram: 'Gram teraz',
  ukonczone: 'Ukończone',
  porzucone: 'Porzucone',
  lista: 'Na liście',
};

async function getUserBacklog(userId) {
  const rows = await BacklogEntry.findAll({ where: { userId } });
  return rows.map((r) => r.get({ plain: true }));
}

async function setStatus(userId, gameId, status) {
  if (!STATUSES.includes(status)) return null;

  const [entry, created] = await BacklogEntry.findOrCreate({
    where: { userId, gameId },
    defaults: { status },
  });

  if (!created) {
    entry.status = status;
    await entry.save();
  }

  return entry.get({ plain: true });
}

async function removeEntry(userId, gameId) {
  const count = await BacklogEntry.destroy({ where: { userId, gameId } });
  return count > 0;
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  getUserBacklog,
  setStatus,
  removeEntry,
};