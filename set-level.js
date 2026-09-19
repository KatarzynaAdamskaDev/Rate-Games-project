/**
 * Skrypt do testów: ustawia poziom konta bez pisania fałszywych recenzji.
 * Użycie:
 *   node set-level.js <nazwa_użytkownika> <poziom>   - ustawia dany poziom
 *   node set-level.js <nazwa_użytkownika> reset      - usuwa ręczny bonus PD
 *
 * Skrypt zapisuje różnicę jako users.bonusPoints, więc poziom nie zostanie
 * nadpisany przy przeliczaniu PD z recenzji. Działa na tej samej bazie co
 * aplikacja (SQLite w dev, Azure SQL gdy NODE_ENV=production).
 */
require('dotenv').config();
const { sequelize } = require('./config/database');
const { findByUsername } = require('./utils/userHelpers');
const { addMissingColumns } = require('./utils/schemaHelpers');
const { setUserLevel } = require('./utils/progressHelpers');

async function main() {
  const [, , username, levelArg] = process.argv;

  if (!username || !levelArg) {
    console.log('Użycie: node set-level.js <nazwa_użytkownika> <poziom | reset>');
    process.exit(1);
  }

  const isReset = levelArg === 'reset';
  const level = Number(levelArg);
  if (!isReset && (!Number.isInteger(level) || level < 1)) {
    console.log('Poziom musi być liczbą całkowitą >= 1 (albo "reset").');
    process.exit(1);
  }

  await sequelize.sync();
  await addMissingColumns();

  const user = await findByUsername(username);
  if (!user) {
    console.log(`Nie znaleziono użytkownika "${username}".`);
    process.exit(1);
  }

  const result = await setUserLevel(user.id, isReset ? null : level);

  console.log(
    `${user.username}: poziom ${result.level}, ${result.points} PD ` +
      `(z recenzji: ${result.activityPoints}, bonus: ${result.bonusPoints}).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
