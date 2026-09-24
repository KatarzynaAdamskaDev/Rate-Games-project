/**
 * Krótka ankieta "Dołącz do społeczności" na stronie głównej - ocena 1-5 i opcjonalny
 * komentarz. Wyniki (średnia, rozkład ocen, wykres dzienny, ostatnie komentarze) trafiają
 * do panelu admina (zakładka Opinie).
 */
const { Op } = require('sequelize');
const Feedback = require('../models/Feedback');
const { bucketByDay } = require('./adminHelpers');

const DAY_MS = 24 * 60 * 60 * 1000;

async function submitFeedback({ userId, username, rating, comment }) {
  return Feedback.create({
    userId,
    username,
    rating,
    comment: comment ? comment.slice(0, 500) : null,
  });
}

/** Średnia, liczba ocen, rozkład 1-5 i wykres dzienny (ostatnie 14 dni) - do panelu admina. */
async function getFeedbackStats() {
  const chartDays = 14;
  const chartSince = new Date(Date.now() - chartDays * DAY_MS);

  const [all, recentRows] = await Promise.all([
    Feedback.findAll({ attributes: ['rating', 'createdAt'], raw: true }),
    Feedback.findAll({ where: { createdAt: { [Op.gte]: chartSince } }, attributes: ['createdAt'], raw: true }),
  ]);

  const distribution = [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    count: all.filter((f) => f.rating === rating).length,
  }));
  const total = all.length;
  const average = total > 0 ? all.reduce((sum, f) => sum + f.rating, 0) / total : 0;

  return {
    total,
    average,
    distribution,
    chart: bucketByDay(recentRows, chartDays),
  };
}

async function getRecentFeedback(limit = 20) {
  const rows = await Feedback.findAll({ order: [['createdAt', 'DESC']], limit });
  return rows.map((r) => r.get({ plain: true }));
}

module.exports = { submitFeedback, getFeedbackStats, getRecentFeedback };
