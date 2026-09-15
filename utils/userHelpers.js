const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('../models/User');

/** Zamienia instancję Sequelize na zwykły obiekt, parsując pole friends z JSON. */
function serializeUser(userInstance) {
  if (!userInstance) return null;
  const plain = userInstance.get({ plain: true });
  plain.friends = JSON.parse(plain.friends || '[]');
  return plain;
}

async function getAllUsers() {
  const users = await User.findAll();
  return users.map(serializeUser);
}

async function findByEmail(email) {
  const user = await User.findOne({
    where: sequelize.where(
      sequelize.fn('lower', sequelize.col('email')),
      String(email).toLowerCase()
    ),
  });
  return serializeUser(user);
}

async function findByUsername(username) {
  const user = await User.findOne({
    where: sequelize.where(
      sequelize.fn('lower', sequelize.col('username')),
      String(username).toLowerCase()
    ),
  });
  return serializeUser(user);
}

async function findByUsernameOrEmail(value) {
  const byUsername = await findByUsername(value);
  if (byUsername) return byUsername;
  return findByEmail(value);
}

/** Wyszukuje użytkowników po fragmencie nazwy (do wyszukiwarki na stronie). */
async function searchUsersByUsername(query, limit = 10) {
  if (!query || !query.trim()) return [];
  const users = await User.findAll({
    where: {
      username: { [Op.like]: `%${query.trim()}%` },
    },
    limit,
  });
  return users.map(serializeUser);
}

async function findById(id) {
  const user = await User.findByPk(id);
  return serializeUser(user);
}

async function createUser({ email, username, passwordHash }) {
  const user = await User.create({
    email,
    username,
    passwordHash,
    role: 'user',
    friends: '[]',
  });
  return serializeUser(user);
}

async function updatePassword(userId, passwordHash) {
  const [count] = await User.update({ passwordHash }, { where: { id: userId } });
  return count > 0;
}

/** Haszuje surowy token, żeby w bazie nigdy nie leżał w formie jawnej. */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function setResetToken(userId, rawToken, expiresInMs) {
  const [count] = await User.update(
    {
      resetPasswordToken: hashToken(rawToken),
      resetPasswordExpires: Date.now() + expiresInMs,
    },
    { where: { id: userId } }
  );
  return count > 0;
}

async function findByResetToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const user = await User.findOne({
    where: {
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { [Op.gt]: Date.now() },
    },
  });
  return serializeUser(user);
}

async function clearResetToken(userId) {
  const [count] = await User.update(
    { resetPasswordToken: null, resetPasswordExpires: null },
    { where: { id: userId } }
  );
  return count > 0;
}

/* ---------------------------- ZNAJOMI ---------------------------- */

async function areFriends(userIdA, userIdB) {
  const user = await findById(userIdA);
  return !!(user && user.friends.includes(userIdB));
}

async function addFriend(userIdA, userIdB) {
  await Promise.all(
    [userIdA, userIdB].map(async (id) => {
      const otherId = id === userIdA ? userIdB : userIdA;
      const userInstance = await User.findByPk(id);
      if (!userInstance) return;
      const friends = JSON.parse(userInstance.friends || '[]');
      if (!friends.includes(otherId)) {
        friends.push(otherId);
        userInstance.friends = JSON.stringify(friends);
        await userInstance.save();
      }
    })
  );
}

async function getFriendsOfUser(userId) {
  const user = await findById(userId);
  if (!user) return [];
  const friends = await Promise.all(user.friends.map((id) => findById(id)));
  return friends.filter(Boolean);
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
  areFriends,
  addFriend,
  getFriendsOfUser,
  searchUsersByUsername,
};