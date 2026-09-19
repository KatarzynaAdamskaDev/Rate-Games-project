/**
 * Powiadomienia w aplikacji (dzwonek w navbarze): nowy obserwujący, polubienia
 * i komentarze pod recenzją. Nie powiadamiamy o własnych akcjach, a identyczne
 * nieprzeczytane powiadomienie nie jest tworzone drugi raz (np. lajk-unlajk-lajk).
 */
const Notification = require('../models/Notification');
const { isNotificationEnabled } = require('./notificationPrefs');

const MAX_PER_USER = 50;
// Komunikaty od moderatorów (np. usunięta recenzja) nie podlegają ustawieniom powiadomień użytkownika.
const ALWAYS_DELIVERED = new Set(['moderation', 'admin-idea', 'admin-role']);
const NO_DEDUPE = new Set(['moderation', 'report-result', 'admin-idea', 'admin-role']);

async function createNotification({ userId, type, actorId, message, link }) {
  if (!userId || userId === actorId) return null;
  // Odbiorca mógł wyłączyć ten rodzaj powiadomień w ustawieniach profilu.
  if (!ALWAYS_DELIVERED.has(type) && !(await isNotificationEnabled(userId, type))) return null;

  // Powiadomienia o decyzjach moderatorów niosą różne treści, więc nie są traktowane jako duplikaty.
  if (!NO_DEDUPE.has(type)) {
    const duplicate = await Notification.findOne({
      where: { userId, type, actorId: actorId || null, link: link || null, isRead: false },
    });
    if (duplicate) return null;
  }

  const notification = await Notification.create({
    userId,
    type,
    actorId: actorId || null,
    message: String(message).slice(0, 300),
    link: link || null,
  });

  // Trzymamy tylko najnowsze MAX_PER_USER powiadomień użytkownika.
  const rows = await Notification.findAll({
    where: { userId },
    attributes: ['id'],
    order: [['createdAt', 'DESC']],
  });
  const stale = rows.slice(MAX_PER_USER).map((r) => r.id);
  if (stale.length > 0) await Notification.destroy({ where: { id: stale } });

  return notification.get({ plain: true });
}

async function getNotifications(userId, limit = 10) {
  const rows = await Notification.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit,
  });
  return rows.map((r) => r.get({ plain: true }));
}

function countUnreadNotifications(userId) {
  return Notification.count({ where: { userId, isRead: false } });
}

async function markAllNotificationsRead(userId) {
  await Notification.update({ isRead: true }, { where: { userId, isRead: false } });
}

/** Oznacza powiadomienie jako przeczytane i zwraca je (tylko jeśli należy do użytkownika). */
async function openNotification(userId, id) {
  const notification = await Notification.findOne({ where: { id, userId } });
  if (!notification) return null;
  if (!notification.isRead) {
    notification.isRead = true;
    await notification.save();
  }
  return notification.get({ plain: true });
}

module.exports = {
  createNotification,
  getNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
  openNotification,
};
