/**
 * Pomocniczy skrypt do utworzenia konta administratora.
 * Użycie: node create-admin.js <email> <username> <hasło>
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { findByEmail, findByUsername, createUser } = require('./utils/userHelpers');
const { readCollection, writeCollection } = require('./utils/dataStore');

async function main() {
  const [, , email, username, password] = process.argv;

  if (!email || !username || !password) {
    console.log('Użycie: node create-admin.js <email> <username> <hasło>');
    process.exit(1);
  }

  if (findByEmail(email) || findByUsername(username)) {
    console.log('Użytkownik z tym e-mailem lub nazwą już istnieje.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = createUser({ email, username, passwordHash });

  const users = readCollection('users');
  const idx = users.findIndex((u) => u.id === user.id);
  users[idx].role = 'admin';
  writeCollection('users', users);

  console.log(`Utworzono administratora: ${username} (${email})`);
}

main();
