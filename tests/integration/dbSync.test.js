/**
 * scripts/db-sync.js (npm run db:push / db:pull) - uruchamiany jak przez prawdziwego użytkownika,
 * jako osobny proces node, na dwóch tymczasowych plikach SQLite (nie na data/dev.sqlite3 i nie na Azure).
 *
 * utils/dbSync.js wczytuje modele podmieniając require.cache (żeby ten sam plik modelu dało się
 * "podłączyć" pod dwie różne bazy naraz) - ta sztuczka nie działa wewnątrz własnego rejestru modułów
 * Jest, dlatego testujemy to przez prawdziwy proces node, a nie przez bezpośredni require() w Jest.
 * To i tak bardziej realistyczny test: sprawdza dokładnie to polecenie, które uruchamia administrator.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'scripts', 'db-sync.js');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gameverse-dbsync-cli-'));
let counter = 0;
const tmpFile = () => path.join(DIR, `db-${counter++}.sqlite3`);

function all(file, sql) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });
    db.all(sql, (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
const count = async (file, table) => (await all(file, `select count(*) n from "${table}"`))[0].n;

/** Uruchamia CLI (npm run db:push/pull) jako osobny proces; DB_SYNC_BACKUP_DIR trzyma listy zmian poza repo. */
function run(args) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DB_SYNC_BACKUP_DIR: path.join(DIR, 'backups') },
    });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

async function seed(file) {
  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file);
    db.serialize(() => {
      db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, username TEXT, passwordHash TEXT, role TEXT, friends TEXT, createdAt TEXT, updatedAt TEXT)`);
      db.run(
        `INSERT INTO users (id, email, username, passwordHash, role, friends, createdAt, updatedAt) VALUES
          ('11111111-1111-1111-1111-111111111111','a@example.test','alfa','x','user','[]','2026-01-01 00:00:00.000 +00:00','2026-01-01 00:00:00.000 +00:00'),
          ('22222222-2222-2222-2222-222222222222','b@example.test','beta','x','user','[]','2026-01-01 00:00:00.000 +00:00','2026-01-01 00:00:00.000 +00:00')`,
        (err) => { db.close(); err ? reject(err) : resolve(); },
      );
    });
  });
}

afterAll(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('`db:list` wypisuje nazwy tabel, w tym "users" i "blog_posts"', () => {
  const result = run(['list']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('users');
  expect(result.stdout).toContain('blog_posts');
});

test('bez --apply CLI tylko pokazuje plan, nic nie zapisuje w pliku docelowym', async () => {
  const src = tmpFile();
  await seed(src);
  const tgt = tmpFile();

  const result = run(['push', `--local=${src}`, `--remote-sqlite=${tgt}`, '--tables=users']);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/PODGLĄD/);
  expect(result.stdout).toMatch(/To był podgląd/);
  expect(fs.existsSync(tgt) ? fs.statSync(tgt).size : 0).toBeLessThan(200);
});

test('--apply kopiuje dane, a powtórzenie jest bezpieczne (bez duplikatów)', async () => {
  const src = tmpFile();
  await seed(src);
  const tgt = tmpFile();

  const first = run(['push', `--local=${src}`, `--remote-sqlite=${tgt}`, '--tables=users', '--apply']);
  expect(first.status).toBe(0);
  expect(first.stdout).toMatch(/Zapisano w jednej transakcji/);
  expect(await count(tgt, 'users')).toBe(2);

  const second = run(['push', `--local=${src}`, `--remote-sqlite=${tgt}`, '--tables=users', '--apply']);
  expect(second.status).toBe(0);
  expect(await count(tgt, 'users')).toBe(2); // bez duplikatów
});

test('brak pliku źródłowego kończy się czytelnym błędem (kod wyjścia 1), bez tworzenia pustego pliku', () => {
  const missing = tmpFile();
  const tgt = tmpFile();
  const result = run(['push', `--local=${missing}`, `--remote-sqlite=${tgt}`]);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Nie znaleziono pliku/);
  expect(fs.existsSync(missing)).toBe(false);
});

test('kierunek "pull" kopiuje w drugą stronę (z "zdalnej" bazy do lokalnej)', async () => {
  const remote = tmpFile();
  await seed(remote);
  const local = tmpFile();

  const result = run(['pull', `--local=${local}`, `--remote-sqlite=${remote}`, '--tables=users', '--apply']);
  expect(result.status).toBe(0);
  expect(await count(local, 'users')).toBe(2);
  // Kopia lokalnej bazy sprzed zapisu - dokładnie tak, jak przy prawdziwym pull na koncie administratora.
  expect(result.stdout).toMatch(/Kopia lokalnej bazy sprzed zmian/);
});

test('--replace bez --confirm jest odrzucane (ochrona przed przypadkowym nadpisaniem)', async () => {
  const src = tmpFile();
  await seed(src);
  const tgt = tmpFile();
  run(['push', `--local=${src}`, `--remote-sqlite=${tgt}`, '--tables=users', '--apply']);

  const result = run(['push', `--local=${src}`, `--remote-sqlite=${tgt}`, '--tables=users', '--replace', '--apply']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--confirm=/);
});

test('nieznana nazwa tabeli w --tables kończy się czytelnym błędem', async () => {
  const src = tmpFile();
  await seed(src);
  const tgt = tmpFile();
  const result = run(['push', `--local=${src}`, `--remote-sqlite=${tgt}`, '--tables=nie_ma_takiej_tabeli']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Nieznane tabele/);
});
