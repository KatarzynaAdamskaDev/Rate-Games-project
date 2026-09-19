const express = require('express');
const router = express.Router();

const {
  getNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
  openNotification,
} = require('../utils/notificationHelpers');
const { getUnreadCounts } = require('../utils/chatHelpers');

// Endpointy JSON dla navbaru - dla niezalogowanych zwracają 401 zamiast przekierowania.
router.use((req, res, next) => {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Nie jesteś zalogowany.' });
});

/** Liczniki do plakietek przy ikonach czatu i powiadomień. */
router.get('/summary', async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [notifications, unreadMessages] = await Promise.all([
      countUnreadNotifications(userId),
      getUnreadCounts(userId),
    ]);
    res.json({ notifications, messages: unreadMessages.total });
  } catch (err) {
    next(err);
  }
});

/** Ostatnie powiadomienia do rozwijanego panelu. */
router.get('/list', async (req, res, next) => {
  try {
    const items = await getNotifications(req.session.user.id, 10);
    res.json({
      items: items.map((n) => ({
        id: n.id,
        message: n.message,
        isRead: n.isRead,
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await markAllNotificationsRead(req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Kliknięcie powiadomienia: oznacza jako przeczytane i przenosi pod jego link. */
router.get('/:id/open', async (req, res, next) => {
  try {
    const notification = await openNotification(req.session.user.id, req.params.id);
    res.redirect(notification && notification.link ? notification.link : '/');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
