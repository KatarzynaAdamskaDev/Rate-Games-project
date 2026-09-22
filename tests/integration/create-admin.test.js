/**
 * create-admin.js (npm run create-admin) jako osobny proces node, na tymczasowej bazie SQLite - nie
 * na data/dev.sqlite3. Sprawdza głównie to, co naprawiłem po zgłoszeniu: konto administratora nie
 * może dostać zarezerwowanej nazwy (np. literalnie "admin"), bo wtedy adres /admin - zamiast na jego
 * publiczny profil - zawsze prowadzi do panelu administratora (trasa /admin jest zamontowana wcześniej
 * niż łapacz /:username, patrz app.js i utils/reservedUsernames.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'create-admin.js');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gameverse-create-admin-'));
let counter = 0;
const dbFile = () => path.join(DIR, `db-${counter++}.sqlite3`);

function run(args, storage) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: '', SQLITE_STORAGE: storage },
    });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

afterAll(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('nazwy zarezerwowanej przez trasy aplikacji (np. "admin") nie da się użyć', () => {
  const storage = dbFile();
  const result = run(['a@example.test', 'admin', 'HasloTest123'], storage);
  expect(result.status).toBe(1);
  expect(result.stdout).toMatch(/zarezerwowana/);
  // Nic nie zostało zapisane w bazie.
  expect(fs.existsSync(storage) ? fs.statSync(storage).size : 0).toBeLessThan(50);
});

test('inne zarezerwowane nazwy (np. "blog", "profile") też są odrzucane', () => {
  const storage = dbFile();
  ['blog', 'profile', 'chat'].forEach((name) => {
    const result = run([`${name}@example.test`, name, 'HasloTest123'], storage);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/zarezerwowana/);
  });
});

test('poprawna nazwa tworzy konto administratora w bazie', () => {
  const storage = dbFile();
  const result = run(['prawdziwy@example.test', 'prawdziwyadmin', 'HasloTest123'], storage);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/Utworzono administratora: prawdziwyadmin/);
});

test('tej samej nazwy nie da się użyć drugi raz', () => {
  const storage = dbFile();
  run(['pierwszy@example.test', 'zajetanazwa', 'HasloTest123'], storage);
  const result = run(['drugi@example.test', 'zajetanazwa', 'HasloTest123'], storage);
  expect(result.status).toBe(1);
  expect(result.stdout).toMatch(/już istnieje/);
});
