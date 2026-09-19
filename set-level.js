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
const User = require('./models/User');
const Review = require('./models/Review');
const { findByUsername } = require('./utils/userHelpers');
const { addMissingColumns } = require('./utils/schemaHelpers');
const { syncUserProgress } = require('./utils/progressHelpers');
const { POINTS_PER_REVIEW, POINTS_PER_LEVEL } = require('./utils/pointsHelpers');

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

  const reviewCount = await Review.count({ where: { userId: user.id } });
  const activityPoints = reviewCount * POINTS_PER_REVIEW;
  const bonusPoints = isReset ? 0 : (level - 1) * POINTS_PER_LEVEL - activityPoints;

  await User.update({ bonusPoints }, { where: { id: user.id } });
  const result = await syncUserProgress(user.id);

  console.log(
    `${user.username}: poziom ${result.level}, ${result.points} PD ` +
      `(z recenzji: ${activityPoints}, bonus: ${bonusPoints}).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
