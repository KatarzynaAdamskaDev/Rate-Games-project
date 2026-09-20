#!/usr/bin/env node
/**
 * Jedna komenda do przygotowania projektu:  npm run setup
 *
 *  1. sprawdza wersję Node.js,
 *  2. instaluje wszystkie zależności (npm install - lista w package.json),
 *  3. tworzy plik .env z .env.example i losuje SESSION_SECRET (jeśli .env jeszcze nie ma),
 *  4. tworzy katalogi na wgrywane pliki (awatary, okładki bloga i gier),
 *  5. podpowiada, co zrobić dalej.
 *
 * Skrypt używa tylko modułów wbudowanych w Node.js, więc działa przed instalacją zależności.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIN_NODE = [20, 17]; // wymaga tego sqlite3 (sharp: 20.9, Azure SQL - tedious: 22)

const say = (text = '') => console.log(text);
const step = (n, text) => say(`\n[${n}/4] ${text}`);

/* ------------------------------ 1. Node.js ------------------------------ */

step(1, 'Sprawdzam wersję Node.js');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  console.error(`Masz Node.js ${process.versions.node}, a potrzebny jest ${MIN_NODE.join('.')} lub nowszy (najlepiej 22 LTS).`);
  console.error('Pobierz aktualną wersję z https://nodejs.org i uruchom skrypt ponownie.');
  process.exit(1);
}
say(`OK: Node.js ${process.versions.node}`);
if (major < 22) {
  say('Uwaga: do połączenia z Azure SQL (produkcja) potrzebny jest Node.js 22+. Lokalnie (SQLite) wystarczy ta wersja.');
}

/* ------------------------------ 2. zależności ------------------------------ */

step(2, 'Instaluję zależności (npm install)');
// Jedno polecenie w powłoce działa tak samo na Windows, macOS i Linuksie.
const install = spawnSync('npm install', { cwd: ROOT, stdio: 'inherit', shell: true });
if (install.status !== 0) {
  console.error('\nnpm install zakończył się błędem - popraw go i uruchom "npm run setup" ponownie.');
  process.exit(install.status || 1);
}

/* ------------------------------ 3. plik .env ------------------------------ */

step(3, 'Przygotowuję plik .env');
const envPath = path.join(ROOT, '.env');
const examplePath = path.join(ROOT, '.env.example');
if (fs.existsSync(envPath)) {
  say('Plik .env już istnieje - zostawiam bez zmian.');
} else if (!fs.existsSync(examplePath)) {
  say('Brak pliku .env.example - pomijam (utwórz .env ręcznie według README).');
} else {
  const secret = crypto.randomBytes(32).toString('hex');
  const content = fs.readFileSync(examplePath, 'utf8').replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`);
  fs.writeFileSync(envPath, content);
  say('Utworzono .env z wylosowanym SESSION_SECRET. Uzupełnij w nim klucze IGDB i reCAPTCHA.');
}

/* ------------------------------ 4. katalogi ------------------------------ */

step(4, 'Tworzę katalogi na wgrywane pliki');
['data', 'public/images/avatars', 'public/images/blog/uploads', 'public/images/games/uploads'].forEach((dir) => {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
});
say('Gotowe.');

/* ------------------------------ co dalej ------------------------------ */

say('\n=========================================================');
say(' Instalacja zakończona. Co dalej:');
say('  1. Uzupełnij .env (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET - katalog gier IGDB;');
say('     RECAPTCHA_* i EMAIL_* są opcjonalne)');
say('  2. npm run dev                     - uruchom aplikację (http://localhost:3000)');
say('  3. npm run create-admin -- mail@example.com NazwaAdmina Haslo12345');
say('=========================================================');
