/**
 * Serwer dla testów responsywności (Playwright, zob. playwright.config.js).
 * Tak jak tests/setup/testApp.js dla Jest: własna, tymczasowa baza SQLite i katalog na pliki
 * (nigdy data/dev.sqlite3 ani public/images/...), zmienne API ustawione na pusty string
 * (dotenv w app.js nie nadpisuje już ustawionych zmiennych - patrz komentarz w testApp.js).
 * Dogrywa trochę treści (gra, recenzja, wpis bloga), żeby strony nie były puste podczas
 * sprawdzania układu, i zapisuje ich identyfikatory do seed-info.json na użytek testów.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = process.env.PORT || '4321';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameverse-responsive-'));
const uploadsDir = path.join(dir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.PORT = PORT;
process.env.SQLITE_STORAGE = path.join(dir, 'db.sqlite3');
process.env.UPLOADS_DIR = uploadsDir;
process.env.SESSION_SECRET = 'responsive-test-secret-not-used-in-production';
process.env.SITE_URL = `http://localhost:${PORT}`;
['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY', 'ANTHROPIC_API_KEY', 'YOUTUBE_API_KEY', 'EMAIL_USER', 'EMAIL_PASS', 'GIPHY_API_KEY']
  .forEach((key) => { process.env[key] = ''; });

const SEED_INFO_PATH = path.join(__dirname, 'seed-info.json');

async function seed() {
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  const { sequelize } = require('../../config/database');
  const User = require('../../models/User');
  const CustomGame = require('../../models/CustomGame');
  const Review = require('../../models/Review');
  const { savePost } = require('../../utils/blogHelpers');
  const { getOrCreateDM, addMessage } = require('../../utils/chatHelpers');

  await sequelize.authenticate();
  await sequelize.sync();

  const passwordHash = await bcrypt.hash('HasloTest123', 4);
  const user = await User.create({
    email: 'responsywnosc@example.test',
    username: 'testowyrecenzent',
    passwordHash,
    role: 'user',
    friends: '[]',
    bio: 'Konto testowe używane wyłącznie do automatycznego sprawdzania układu stron na różnych szerokościach ekranu.',
  });

  const admin = await User.create({
    email: 'responsywnyadmin@example.test',
    username: 'responsywnyadmin',
    passwordHash,
    role: 'admin',
    friends: '[]',
  });

  const game = await CustomGame.create({
    title: 'Gra Testowa Responsywności',
    category: 'RPG',
    platform: 'PC',
    releaseYear: 2024,
    description: 'Opis testowej gry używanej wyłącznie do automatycznego sprawdzania układu strony na różnych ekranach - wystarczająco długi, żeby zobaczyć zachowanie tekstu.',
  });

  await Review.create({
    gameId: game.id,
    userId: user.id,
    username: user.username,
    rating: 4.5,
    text: 'Wystarczająco długa recenzja testowa, żeby sprawdzić, jak karta recenzji zachowuje się na wąskich ekranach i czy tekst albo ocena się nie ucinają w dziwny sposób na telefonie.',
  });

  // Rozmowa z jedną wiadomością, żeby /chat od razu miał aktywną rozmowę do sprawdzenia
  // (panel emoji/GIF, dymki wiadomości itd.) zamiast pustego stanu "wybierz rozmowę".
  const conversation = await getOrCreateDM(user, admin);
  await addMessage({
    conversationId: conversation.id,
    senderId: admin.id,
    senderUsername: admin.username,
    text: 'Cześć! To testowa wiadomość na potrzeby sprawdzania responsywności czatu.',
  });

  const blogPostId = uuidv4();
  await savePost({
    id: blogPostId,
    title: 'Testowy wpis do sprawdzenia responsywności bloga',
    author: 'Redakcja GameVerse',
    category: 'Aktualności',
    tags: ['test'],
    excerpt: 'Krótki opis testowego wpisu na potrzeby automatycznych testów układu strony.',
    content: 'Treść testowego wpisu na blogu, wystarczająco długa, żeby zobaczyć, jak zachowuje się typografia i łamanie tekstu na różnych szerokościach ekranu, łącznie z telefonami.',
    coverImage: '/images/game-placeholder.svg',
    status: 'published',
    publishAt: null,
    createdAt: new Date().toISOString(),
  });

  // Nie zamykamy połączenia - to ta sama, jedna instancja Sequelize (config/database.js),
  // której zaraz potem użyje bin/www (require korzysta z tego samego cache modułów w tym procesie).

  fs.writeFileSync(
    SEED_INFO_PATH,
    JSON.stringify(
      {
        username: user.username,
        password: 'HasloTest123',
        adminUsername: admin.username,
        adminPassword: 'HasloTest123',
        gameId: game.id,
        blogPostId,
        conversationId: conversation.id,
      },
      null,
      2
    )
  );
}

seed()
  .then(() => {
    // eslint-disable-next-line global-require
    require('../../bin/www');
  })
  .catch((err) => {
    console.error('[responsive] Nie udało się przygotować danych testowych:', err);
    process.exit(1);
  });
