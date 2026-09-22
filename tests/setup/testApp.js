/**
 * Buduje odizolowaną instancję aplikacji do testów integracyjnych: własny plik SQLite (tworzony
 * i kasowany za każdym razem), własny katalog na wgrywane pliki i wyłączone integracje zewnętrzne
 * (IGDB, reCAPTCHA, Anthropic, YouTube) - żeby testy nie potrzebowały internetu ani kluczy API
 * i nie dotykały prawdziwych danych w data/ ani public/images/.
 *
 * WAŻNE: createTestApp() musi być pierwszą rzeczą, która w danym pliku testowym wymaga (require)
 * cokolwiek z katalogów config/, models/, routes/, utils/ albo app.js - te moduły czytają zmienne
 * środowiskowe (albo require('../config/database')) w chwili wczytania, więc muszą zobaczyć
 * poprawne wartości, zanim ktokolwiek je zaimportuje. Jest domyślnie izoluje moduły między
 * plikami testowymi, więc jest to bezpieczne nawet przy równoległym uruchamianiu wielu plików.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TMP_ROOT = path.join(os.tmpdir(), 'gameverse-tests');

function uniqueDir(prefix) {
  return path.join(TMP_ROOT, `${prefix}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
}

/**
 * @returns {Promise<{ app: import('express').Express, sequelize: object, uploadsDir: string, teardown: () => Promise<void> }>}
 */
async function createTestApp() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dbFile = uniqueDir('db') + '.sqlite3';
  const uploadsDir = uniqueDir('uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  process.env.NODE_ENV = 'test';
  process.env.SQLITE_STORAGE = dbFile;
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.SESSION_SECRET = 'test-session-secret-not-used-in-production';
  process.env.SITE_URL = 'http://localhost:3100';
  // Puste (nie usunięte!) - app.js wywołuje require('dotenv').config() przy starcie, a dotenv domyślnie
  // NIE nadpisuje zmiennych, które już są ustawione w process.env (nawet na pusty string). Gdyby te klucze
  // były po prostu skasowane (delete), dotenv wczytałby je z powrotem z prawdziwego pliku .env - testy
  // wykonywałyby prawdziwe żądania do Twitch/IGDB, Anthropic, reCAPTCHA i realnie wysyłały maile.
  ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY', 'ANTHROPIC_API_KEY', 'YOUTUBE_API_KEY', 'EMAIL_USER', 'EMAIL_PASS']
    .forEach((key) => { process.env[key] = ''; });

  // Prawdziwy moduł rozmawia z IGDB/Twitch przez sieć; ten zastępnik (utils/__mocks__/igdbService.js)
  // udaje pusty katalog IGDB - dokładnie tak, jak zachowuje się aplikacja bez skonfigurowanych kluczy.
  // eslint-disable-next-line global-require
  jest.mock('../../utils/igdbService');

  // app.js musi być wymagany PRZED sequelize.sync(): to on (przez routes/ i utils/) rejestruje
  // wszystkie modele w Sequelize - sync() zobaczy tylko te modele, które są już zarejestrowane.
  // eslint-disable-next-line global-require
  const app = require('../../app');
  // eslint-disable-next-line global-require
  const { sequelize, configureSqliteConcurrency } = require('../../config/database');
  await sequelize.authenticate();
  await configureSqliteConcurrency(); // WAL + busy_timeout - te same ustawienia co na prawdziwym serwerze (bin/www)
  await sequelize.sync({ force: true }); // świeże, puste tabele - każdy plik testowy startuje od zera

  async function teardown() {
    await sequelize.close();
    fs.rmSync(dbFile, { force: true });
    fs.rmSync(`${dbFile}-journal`, { force: true });
    fs.rmSync(`${dbFile}-wal`, { force: true });
    fs.rmSync(`${dbFile}-shm`, { force: true });
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }

  return { app, sequelize, uploadsDir, teardown };
}

module.exports = { createTestApp };
