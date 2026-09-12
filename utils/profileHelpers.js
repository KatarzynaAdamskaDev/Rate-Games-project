/**
 * Drobne operacje na koncie użytkownika, których nie ma w utils/userHelpers.js
 * (nie modyfikujemy tamtego pliku - tylko go uzupełniamy z zewnątrz).
 *
 * UWAGA: użytkownicy żyją teraz w bazie danych (Sequelize/User model),
 * nie w pliku data/users.json - wszystkie funkcje operują na bazie.
 */
const { readCollection, writeCollection } = require('./dataStore');
const User = require('../models/User');

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

  const oldUsername = userInstance.username;
  userInstance.username = newUsername;
  await userInstance.save();

  // Utrzymujemy spójność nazwy użytkownika w istniejących recenzjach
  // (recenzje na razie zostają w JSON, stąd dataStore tylko tutaj).
  const reviews = readCollection('reviews').map((r) =>
    r.username === oldUsername ? { ...r, username: newUsername } : r
  );
  writeCollection('reviews', reviews);

  return { ok: true, user: userInstance.get({ plain: true }) };
}

/** Usuwa konto użytkownika (recenzje zostają, by nie psuć historii innych). */
async function deleteUser(userId) {
  const count = await User.destroy({ where: { id: userId } });
  return count > 0;
}

module.exports = { getUserPublic, updateUsername, deleteUser };