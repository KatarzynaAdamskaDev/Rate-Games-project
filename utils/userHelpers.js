const { v4: uuidv4 } = require('uuid');
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

module.exports = {
  getAllUsers,
  findByEmail,
  findByUsername,
  findByUsernameOrEmail,
  findById,
  createUser,
  updatePassword,
};
