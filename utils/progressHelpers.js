/**
 * Zapis punktów doświadczenia (PD) i poziomu użytkownika w bazie danych.
 * Źródłem prawdy pozostaje aktywność (na razie: liczba recenzji), a kolumny
 * users.points / users.level są jej zapisem, odświeżanym po każdej zmianie.
 */
const Review = require('../models/Review');
const User = require('../models/User');
const { pointsFromStats, levelFromPoints, POINTS_PER_REVIEW, POINTS_PER_LEVEL } = require('./pointsHelpers');

/** Zapisuje PD i poziom tylko wtedy, gdy różnią się od tego, co jest w bazie. */
async function saveProgress(userId, points, level, current) {
  if (current && current.points === points && current.level === level) return;
  await User.update({ points, level }, { where: { id: userId } });
}

/** Przelicza PD i poziom użytkownika od zera na podstawie jego recenzji. */
async function syncUserProgress(userId) {
  const user = await User.findByPk(userId);
  if (!user) return null;

  const reviewCount = await Review.count({ where: { userId } });
  const points = pointsFromStats({ reviewCount, bonusPoints: user.bonusPoints });
  const level = levelFromPoints(points);

  await saveProgress(userId, points, level, user);
  return { points, level };
}

async function syncAllUsersProgress() {
  const users = await User.findAll({ attributes: ['id'] });
  for (const user of users) {
    await syncUserProgress(user.id);
  }
}

/**
 * Ustawia poziom konta przez ręczną korektę PD (users.bonusPoints).
 * @param {number|null} level docelowy poziom (>= 1) albo null, żeby usunąć korektę
 */
async function setUserLevel(userId, level) {
  const reviewCount = await Review.count({ where: { userId } });
  const activityPoints = reviewCount * POINTS_PER_REVIEW;
  const bonusPoints = level === null ? 0 : (level - 1) * POINTS_PER_LEVEL - activityPoints;

  await User.update({ bonusPoints }, { where: { id: userId } });
  const result = await syncUserProgress(userId);
  return { ...result, activityPoints, bonusPoints };
}

module.exports = { saveProgress, syncUserProgress, syncAllUsersProgress, setUserLevel };
