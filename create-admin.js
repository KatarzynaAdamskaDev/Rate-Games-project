/**
 * Pomocniczy skrypt do utworzenia konta administratora.
 * Użycie: node create-admin.js <email> <username> <hasło>
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { findByEmail, findByUsername, createUser } = require('./utils/userHelpers');
const { sequelize } = require('./config/database');
const User = require('./models/User');

async function main() {
  const [, , email, username, password] = process.argv;

  if (!email || !username || !password) {
    console.log('Użycie: node create-admin.js <email> <username> <hasło>');
    process.exit(1);
  }

  await sequelize.sync();

  const existingByEmail = await findByEmail(email);
  const existingByUsername = await findByUsername(username);

  if (existingByEmail || existingByUsername) {
    console.log('Użytkownik z tym e-mailem lub nazwą już istnieje.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await createUser({ email, username, passwordHash });

  // Konto trzymamy teraz w bazie danych (nie w data/users.json),
  // więc rolę ustawiamy bezpośrednio przez model Sequelize.
  await User.update({ role: 'admin' }, { where: { id: user.id } });

  console.log(`Utworzono administratora: ${username} (${email})`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Błąd podczas tworzenia administratora:', err);
  process.exit(1);
});