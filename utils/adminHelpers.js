/**
 * Funkcje pomocnicze panelu administratora: dziennik działań, ustawienia serwisu
 * (ogłoszenie) oraz statystyki do pulpitu.
 */
const { Op } = require('sequelize');
const AdminLog = require('../models/AdminLog');
const SiteSetting = require('../models/SiteSetting');
const User = require('../models/User');
const Review = require('../models/Review');
const ReviewComment = require('../models/ReviewComment');
const ReviewLike = require('../models/ReviewLike');
const ReviewReport = require('../models/ReviewReport');
const ContentReport = require('../models/ContentReport');
const CustomGame = require('../models/CustomGame');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { readCollection } = require('./dataStore');
const { activeBanWhere } = require('./moderationStatus');

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------ dziennik działań ------------------------------ */

/** Zapisuje działanie administratora (nie przerywa akcji, jeśli zapis się nie uda). */
async function logAdminAction(req, action, targetType, targetLabel, details) {
  try {
    await AdminLog.create({
      adminId: req.session.user.id,
      adminUsername: req.session.user.username,
      action,
      targetType: targetType || null,
      targetLabel: targetLabel ? String(targetLabel).slice(0, 200) : null,
      details: details ? String(details).slice(0, 300) : null,
    });
  } catch (err) {
    console.error('[admin] nie udało się zapisać dziennika:', err.message);
  }
}

/* ------------------------------ ustawienia serwisu ------------------------------ */

const SETTINGS_TTL_MS = 30 * 1000;
let announcementCache = { value: null, at: 0 };

async function getSetting(key, fallback = null) {
  const row = await SiteSetting.findByPk(key);
  return row && row.value !== null ? row.value : fallback;
}

async function setSetting(key, value) {
  await SiteSetting.upsert({ key, value: value === null ? null : String(value) });
  announcementCache = { value: null, at: 0 };
}

/** Ogłoszenie wyświetlane na górze każdej strony: { enabled, text, type } lub null. */
async function getAnnouncement() {
  if (Date.now() - announcementCache.at < SETTINGS_TTL_MS) return announcementCache.value;

  const [enabled, text, type] = await Promise.all([
    getSetting('announcement_enabled', '0'),
    getSetting('announcement_text', ''),
    getSetting('announcement_type', 'info'),
  ]);
  const value = enabled === '1' && text ? { enabled: true, text, type } : null;
  announcementCache = { value, at: Date.now() };
  return value;
}

/* ------------------------------ statystyki pulpitu ------------------------------ */

/** Liczba rekordów utworzonych w każdym z ostatnich `days` dni (od najstarszego). */
function bucketByDay(rows, days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setTime(start.getTime() - (days - 1) * DAY_MS);

  const buckets = Array.from({ length: days }, (_, i) => ({
    date: new Date(start.getTime() + i * DAY_MS),
    count: 0,
  }));
  rows.forEach((row) => {
    const index = Math.floor((new Date(row.createdAt) - start) / DAY_MS);
    if (index >= 0 && index < days) buckets[index].count += 1;
  });
  return buckets;
}

async function getDashboardStats() {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const chartDays = 14;
  const chartSince = new Date(Date.now() - chartDays * DAY_MS);

  const [
    users, admins, banned, reviews, comments, likes, pendingReports,
    customGames, conversations, messages, newUsers, newReviews, userRows, reviewRows,
  ] = await Promise.all([
    User.count(),
    User.count({ where: { role: 'admin' } }),
    User.count({ where: activeBanWhere() }),
    Review.count(),
    ReviewComment.count(),
    ReviewLike.count(),
    Promise.all([
      ReviewReport.count({ where: { status: 'pending' } }),
      ContentReport.count({ where: { status: 'pending' } }),
    ]).then(([a, b]) => a + b),
    CustomGame.count(),
    Conversation.count(),
    Message.count(),
    User.count({ where: { createdAt: { [Op.gte]: weekAgo } } }),
    Review.count({ where: { createdAt: { [Op.gte]: weekAgo } } }),
    User.findAll({ where: { createdAt: { [Op.gte]: chartSince } }, attributes: ['createdAt'], raw: true }),
    Review.findAll({ where: { createdAt: { [Op.gte]: chartSince } }, attributes: ['createdAt'], raw: true }),
  ]);

  return {
    users, admins, banned, reviews, comments, likes, pendingReports,
    customGames, conversations, messages, newUsers, newReviews,
    blogPosts: readCollection('blog').length,
    usersChart: bucketByDay(userRows, chartDays),
    reviewsChart: bucketByDay(reviewRows, chartDays),
  };
}

module.exports = {
  logAdminAction,
  getSetting,
  setSetting,
  getAnnouncement,
  getDashboardStats,
};
