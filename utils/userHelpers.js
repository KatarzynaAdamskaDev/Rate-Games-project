const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { readCollection, writeCollection } = require('./dataStore');

function getAllUsers() {
  return readCollection('users');
}

function findByEmail(email) {
  return getAllUsers().find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase()
  );
}

function findByUsername(username) {
  return getAllUsers().find(
    (u) => u.username.toLowerCase() === String(username).toLowerCase()
  );
}

function findByUsernameOrEmail(value) {
  return findByUsername(value) || findByEmail(value);
}

function findById(id) {
  return getAllUsers().find((u) => u.id === id);
}

function createUser({ email, username, passwordHash }) {
  const users = getAllUsers();
  const newUser = {
    id: uuidv4(),
    email,
    username,
    passwordHash,
    role: 'user',
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  writeCollection('users', users);
  return newUser;
}

function updatePassword(userId, passwordHash) {
  const users = getAllUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return false;
  users[idx].passwordHash = passwordHash;
  writeCollection('users', users);
  return true;
}

/** Haszuje surowy token, żeby w pliku users.json nigdy nie leżał w formie jawnej. */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Zapisuje przy użytkowniku zahaszowany token resetu hasła oraz czas wygaśnięcia.
 * @param {string} userId
 * @param {string} rawToken - token w formie jawnej (ten, który trafia do maila)
 * @param {number} expiresInMs - za ile milisekund token wygasa
 */
function setResetToken(userId, rawToken, expiresInMs) {
  const users = getAllUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return false;
  users[idx].resetPasswordToken = hashToken(rawToken);
  users[idx].resetPasswordExpires = Date.now() + expiresInMs;
  writeCollection('users', users);
  return true;
}

/** Zwraca użytkownika powiązanego z podanym (jawnym) tokenem, jeśli token jest wciąż ważny. */
function findByResetToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const user = getAllUsers().find(
    (u) =>
      u.resetPasswordToken === tokenHash &&
      u.resetPasswordExpires &&
      u.resetPasswordExpires > Date.now()
  );
  return user || null;
}

/** Unieważnia token po jego wykorzystaniu (żeby link zadziałał tylko raz). */
function clearResetToken(userId) {
  const users = getAllUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return false;
  delete users[idx].resetPasswordToken;
  delete users[idx].resetPasswordExpires;
  writeCollection('users', users);
  return true;
}

module.exports = {
  getAllUsers,
  findByEmail,
  findByUsername,
  findByUsernameOrEmail,
  findById,
  createUser,
  updatePassword,
  setResetToken,
  findByResetToken,
  clearResetToken,
};