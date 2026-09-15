/**
 * Drobne operacje na koncie użytkownika, których nie ma w utils/userHelpers.js
 * (nie modyfikujemy tamtego pliku - tylko go uzupełniamy z zewnątrz).
 *
 * UWAGA: użytkownicy i recenzje żyją teraz w bazie danych (Sequelize),
 * nie w plikach data/*.json.
 */
const User = require('../models/User');
const Review = require('../models/Review');

/** Zwraca dane użytkownika bezpieczne do wyświetlenia (bez hasha i tokenów). */
function getUserPublic(user) {
  if (!user) return null;
  const { passwordHash, resetPasswordToken, resetPasswordExpires, ...safe } =
    user;
  return safe;
}

/** Zmienia nazwę użytkownika, o ile nowa nazwa nie jest zajęta. */
async function updateUsername(userId, newUsername) {
  const userInstance = await User.findByPk(userId);
  if (!userInstance) return { ok: false, reason: 'not_found' };

  const existing = await User.findOne({
    where: require('sequelize').where(
      require('sequelize').fn('lower', require('sequelize').col('username')),
      newUsername.toLowerCase()
    ),
  });
  if (existing && existing.id !== userId) {
    return { ok: false, reason: 'taken' };
  }

  userInstance.username = newUsername;
  await userInstance.save();

  // Utrzymujemy spójność nazwy użytkownika w istniejących recenzjach.
  await Review.update({ username: newUsername }, { where: { userId } });

  return { ok: true, user: userInstance.get({ plain: true }) };
}

/** Usuwa konto użytkownika (recenzje zostają, by nie psuć historii innych). */
async function deleteUser(userId) {
  const count = await User.destroy({ where: { id: userId } });
  return count > 0;
}

module.exports = { getUserPublic, updateUsername, deleteUser };