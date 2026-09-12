/**
 * Drobne operacje na koncie użytkownika, których nie ma w utils/userHelpers.js
 * (nie modyfikujemy tamtego pliku - tylko go uzupełniamy z zewnątrz).
 */
const { readCollection, writeCollection } = require('./dataStore');

/** Zwraca dane użytkownika bezpieczne do wyświetlenia (bez hasha i tokenów). */
function getUserPublic(user) {
  if (!user) return null;
  const { passwordHash, resetPasswordToken, resetPasswordExpires, ...safe } =
    user;
  return safe;
}

/** Zmienia nazwę użytkownika, o ile nowa nazwa nie jest zajęta. */
function updateUsername(userId, newUsername) {
  const users = readCollection('users');
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return { ok: false, reason: 'not_found' };

  const taken = users.some(
    (u) =>
      u.id !== userId &&
      u.username.toLowerCase() === newUsername.toLowerCase()
  );
  if (taken) return { ok: false, reason: 'taken' };

  const oldUsername = users[idx].username;
  users[idx].username = newUsername;
  writeCollection('users', users);

  // Utrzymujemy spójność nazwy użytkownika w istniejących recenzjach.
  const reviews = readCollection('reviews').map((r) =>
    r.username === oldUsername ? { ...r, username: newUsername } : r
  );
  writeCollection('reviews', reviews);

  return { ok: true, user: users[idx] };
}

/** Usuwa konto użytkownika (recenzje zostają, by nie psuć historii innych). */
function deleteUser(userId) {
  const users = readCollection('users');
  const next = users.filter((u) => u.id !== userId);
  writeCollection('users', next);
  return next.length !== users.length;
}

module.exports = { getUserPublic, updateUsername, deleteUser };
