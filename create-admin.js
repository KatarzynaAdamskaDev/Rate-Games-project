/**
 * Pomocniczy skrypt do utworzenia konta administratora.
 * Użycie: node create-admin.js <email> <username> <hasło>
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { findByEmail, findByUsername, createUser } = require('./utils/userHelpers');
const { isReservedUsername } = require('./utils/reservedUsernames');
const { sequelize } = require('./config/database');
const User = require('./models/User');

async function main() {
  const [, , email, username, password] = process.argv;

  if (!email || !username || !password) {
    console.log('Użycie: node create-admin.js <email> <username> <hasło>');
    process.exit(1);
  }

  // "admin" i inne słowa zarezerwowane pod trasy aplikacji (/admin, /blog, /profile...) nie mogą być
  // niczyją nazwą użytkownika - inaczej adres /nazwa nie prowadzi do profilu tej osoby, tylko do tej
  // trasy. Formularz rejestracji to sprawdza, więc ten sam warunek obowiązuje i tutaj.
  if (isReservedUsername(username)) {
    console.log(`Nazwa "${username}" jest zarezerwowana przez trasy aplikacji i nie może być nazwą konta. Wybierz inną.`);
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