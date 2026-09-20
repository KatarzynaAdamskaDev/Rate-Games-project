/**
 * Ręczny import wpisów bloga z pliku JSON do bazy danych (lokalnej albo Azure SQL - zależnie od NODE_ENV i .env).
 *
 *   npm run blog:import                        - wpisy z data/blog.json
 *   npm run blog:import -- sciezka/do/pliku.json
 *   npm run blog:import -- plik.json --overwrite  - nadpisuje wpisy o tych samych id
 *
 * Wpisy, które już są w bazie (to samo id), są pomijane, więc import można powtarzać.
 */
require('dotenv').config();
const path = require('path');
const { sequelize } = require('../config/database');
const BlogPost = require('../models/BlogPost');
const BlogPostTag = require('../models/BlogPostTag');
const { LEGACY_FILE, readPostsFile, importPosts } = require('../utils/blogImport');

async function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes('--overwrite');
  const fileArg = args.find((arg) => !arg.startsWith('--'));
  const file = fileArg ? path.resolve(fileArg) : LEGACY_FILE;

  const list = readPostsFile(file);
  if (!list) {
    console.error(`Nie znaleziono pliku: ${file}`);
    process.exit(1);
  }

  await sequelize.authenticate();
  await BlogPost.sync();
  await BlogPostTag.sync();

  const { imported, skipped } = await importPosts(list, { overwrite });
  console.log(`Gotowe: zaimportowano ${imported}, pominięto ${skipped} (już były w bazie lub bez tytułu).`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('Import nie powiódł się:', err);
  process.exit(1);
});
