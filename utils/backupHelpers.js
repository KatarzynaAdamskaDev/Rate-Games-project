/**
 * Eksport danych i kopie zapasowe bazy dla panelu admina.
 * - eksport CSV wybranych tabel (użytkownicy, recenzje, komentarze, zgłoszenia, dziennik),
 * - kopia JSON wszystkich tabel (działa na SQLite i Azure SQL),
 * - kopia pliku bazy SQLite (tylko środowisko developerskie).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sequelize } = require('../config/database');
const User = require('../models/User');
const Review = require('../models/Review');
const ReviewComment = require('../models/ReviewComment');
const BlogComment = require('../models/BlogComment');
const ReviewReport = require('../models/ReviewReport');
const ContentReport = require('../models/ContentReport');
const AdminLog = require('../models/AdminLog');
const { toCsv } = require('./csv');

const EXPORTS = {
  users: {
    label: 'Użytkownicy',
    description: 'Konta: nazwa, e-mail, rola, poziom, status blokady, data rejestracji.',
    model: User,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'username', label: 'Nazwa' },
      { key: 'email', label: 'E-mail' },
      { key: 'role', label: 'Rola' },
      { key: 'level', label: 'Poziom' },
      { key: 'points', label: 'PD' },
      { key: 'isBanned', label: 'Zablokowany' },
      { key: 'banReason', label: 'Powód blokady' },
      { key: 'bannedUntil', label: 'Blokada do' },
      { key: 'mutedUntil', label: 'Wyciszony do' },
      { key: 'twoFactorEnabled', label: '2FA' },
      { key: 'createdAt', label: 'Data rejestracji' },
    ],
  },
  reviews: {
    label: 'Recenzje',
    description: 'Wszystkie recenzje wraz z ocenami i treścią.',
    model: Review,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'gameId', label: 'ID gry' },
      { key: 'username', label: 'Autor' },
      { key: 'rating', label: 'Ocena' },
      { key: 'text', label: 'Treść' },
      { key: 'createdAt', label: 'Dodano' },
      { key: 'editedAt', label: 'Edytowano' },
    ],
  },
  comments: {
    label: 'Komentarze',
    description: 'Komentarze pod recenzjami.',
    model: ReviewComment,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'reviewId', label: 'ID recenzji' },
      { key: 'username', label: 'Autor' },
      { key: 'text', label: 'Treść' },
      { key: 'createdAt', label: 'Dodano' },
    ],
  },
  blogComments: {
    label: 'Komentarze pod wpisami',
    description: 'Komentarze pod wpisami na blogu.',
    model: BlogComment,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'postId', label: 'ID wpisu' },
      { key: 'username', label: 'Autor' },
      { key: 'text', label: 'Treść' },
      { key: 'createdAt', label: 'Dodano' },
    ],
  },
  reports: {
    label: 'Zgłoszenia',
    description: 'Zgłoszenia recenzji i ich status.',
    model: ReviewReport,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'reviewId', label: 'ID recenzji' },
      { key: 'reporterId', label: 'ID zgłaszającego' },
      { key: 'reason', label: 'Powód' },
      { key: 'comment', label: 'Dopisek zgłaszającego' },
      { key: 'status', label: 'Status' },
      { key: 'resolution', label: 'Uzasadnienie decyzji' },
      { key: 'resolvedBy', label: 'Rozpatrzył(a)' },
      { key: 'createdAt', label: 'Zgłoszono' },
    ],
  },
  'content-reports': {
    label: 'Zgłoszenia komentarzy, użytkowników i wiadomości',
    description: 'Zgłoszenia pozostałych rodzajów treści wraz z migawką treści i decyzją.',
    model: ContentReport,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'targetType', label: 'Rodzaj' },
      { key: 'targetUsername', label: 'Zgłoszony użytkownik' },
      { key: 'snapshot', label: 'Treść' },
      { key: 'reporterId', label: 'ID zgłaszającego' },
      { key: 'reason', label: 'Powód' },
      { key: 'comment', label: 'Dopisek zgłaszającego' },
      { key: 'status', label: 'Status' },
      { key: 'resolution', label: 'Uzasadnienie decyzji' },
      { key: 'resolvedBy', label: 'Rozpatrzył(a)' },
      { key: 'createdAt', label: 'Zgłoszono' },
    ],
  },
  log: {
    label: 'Dziennik działań',
    description: 'Wszystkie zapisane działania administratorów.',
    model: AdminLog,
    columns: [
      { key: 'createdAt', label: 'Data' },
      { key: 'adminUsername', label: 'Administrator' },
      { key: 'action', label: 'Działanie' },
      { key: 'targetLabel', label: 'Obiekt' },
      { key: 'details', label: 'Szczegóły' },
    ],
  },
};

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Zwraca { filename, content } pliku CSV albo null dla nieznanego rodzaju. */
async function buildCsvExport(kind) {
  const spec = EXPORTS[kind];
  if (!spec) return null;
  const rows = await spec.model.findAll({ order: [['createdAt', 'DESC']], raw: true });
  if (kind === 'users') {
    rows.forEach((row) => {
      row.isBanned = !!row.isBanned;
      row.twoFactorEnabled = !!row.twoFactorEnabled;
    });
  }
  return { filename: `gameverse-${kind}-${timestamp()}.csv`, content: toCsv(spec.columns, rows), count: rows.length };
}

// Pola, których nie zapisujemy w kopii JSON (tokeny resetu i sekrety 2FA).
const BACKUP_SKIPPED_FIELDS = new Set([
  'resetPasswordToken',
  'resetPasswordExpires',
  'twoFactorSecret',
  'twoFactorRecovery',
]);

/** Kopia zapasowa wszystkich tabel w jednym pliku JSON. */
async function buildJsonBackup() {
  const tables = {};
  const counts = {};

  for (const model of Object.values(sequelize.models)) {
    // Sesje zawierają dane logowanych osób i tokeny - nie należą do kopii zapasowej.
    if (model.tableName === 'sessions') continue;
    const rows = await model.findAll({ raw: true });
    tables[model.tableName] = rows.map((row) => {
      const clean = {};
      Object.keys(row).forEach((key) => {
        if (!BACKUP_SKIPPED_FIELDS.has(key)) clean[key] = row[key];
      });
      return clean;
    });
    counts[model.tableName] = rows.length;
  }

  const payload = {
    app: 'GameVerse',
    createdAt: new Date().toISOString(),
    dialect: sequelize.getDialect(),
    counts,
    tables,
  };
  return { filename: `gameverse-backup-${timestamp()}.json`, content: JSON.stringify(payload, null, 2), counts };
}

function canBackupSqliteFile() {
  return sequelize.getDialect() === 'sqlite' && !!sequelize.options.storage && sequelize.options.storage !== ':memory:';
}

/**
 * Spójna kopia pliku SQLite (VACUUM INTO nie blokuje bazy i daje zwarty plik).
 * @returns {{ filename: string, filePath: string }} plik tymczasowy do wysłania i usunięcia
 */
async function buildSqliteBackup() {
  const filePath = path.join(os.tmpdir(), `gameverse-backup-${Date.now()}.sqlite3`);
  const escaped = filePath.replace(/'/g, "''");
  await sequelize.query(`VACUUM INTO '${escaped}'`);
  return { filename: `gameverse-backup-${timestamp()}.sqlite3`, filePath };
}

function removeFile(filePath) {
  fs.unlink(filePath, () => {});
}

module.exports = {
  EXPORTS,
  buildCsvExport,
  buildJsonBackup,
  buildSqliteBackup,
  canBackupSqliteFile,
  removeFile,
};
