/**
 * Kopiowanie danych między bazami: lokalna SQLite <-> Azure SQL (albo dwa pliki SQLite - do testów).
 *
 * Działa na modelach z katalogu models/, więc zna wszystkie tabele, ich klucze i ograniczenia unikalności.
 * Domyślnie jest to SCALANIE: wiersze, których id już są w bazie docelowej, zostają bez zmian, wiersze
 * z konfliktem pola unikalnego (np. ta sama nazwa użytkownika pod innym id) są pomijane i zgłaszane, a reszta
 * jest dodawana. Tryb "replace" zastępuje całą zawartość wybranych tabel.
 *
 * Zasady bezpieczeństwa:
 *  - bez opcji apply nic się nie zapisuje (tylko raport),
 *  - zapis idzie w jednej transakcji: albo wszystko, albo nic,
 *  - przed zapisem powstaje plik z listą dodanych wierszy (albo ze starą zawartością przy "replace"),
 *    a przy lokalnej bazie SQLite także jej kopia,
 *  - wiersze odwołujące się do kont, których nie będzie w bazie docelowej, są pomijane (aplikacja i tak
 *    usunęłaby je przy starcie: utils/cleanupHelpers.js),
 *  - tabela sessions nie jest kopiowana.
 */
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

const ROOT = path.join(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'models');
// DB_SYNC_BACKUP_DIR pozwala wskazać inny katalog (np. tests/setup/testApp.js kieruje tu pliki testowe,
// żeby żaden test nie zostawiał śladów w prawdziwym data/backups/).
const BACKUP_DIR = process.env.DB_SYNC_BACKUP_DIR || path.join(ROOT, 'data', 'backups');

const DEFAULT_EXCLUDE = ['sessions'];
const CHUNK = 200;
// Kolumny, które wskazują konto użytkownika (jak w utils/cleanupHelpers.js).
const USER_COLUMNS = ['userId', 'actorId', 'senderId', 'reporterId', 'blockerId', 'blockedId', 'followerId', 'followingId', 'targetUserId', 'ownerId'];
// Tabele z automatycznym numerem: kopiujemy je razem z wierszem nadrzędnym (numer nadaje baza docelowa).
const CHILD_RULES = { blog_post_tags: { parentTable: 'blog_posts', column: 'postId' } };

/* ------------------------------ połączenia ------------------------------ */

function sqliteConnection(file) {
  const storage = file === ':memory:' ? file : path.resolve(file);
  return {
    kind: 'sqlite',
    file: storage,
    name: path.basename(storage),
    label: `SQLite (${storage})`,
    sequelize: new Sequelize({ dialect: 'sqlite', storage, logging: false }),
  };
}

function azureConnection(env = process.env) {
  const missing = ['AZURE_SQL_SERVER', 'AZURE_SQL_DATABASE', 'AZURE_SQL_USER', 'AZURE_SQL_PASSWORD'].filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Brak zmiennych: ${missing.join(', ')}. Ustaw je w .env albo w pliku podanym przez --env-file.`);
  }
  return {
    kind: 'azure',
    name: env.AZURE_SQL_DATABASE,
    label: `Azure SQL (${env.AZURE_SQL_SERVER} / ${env.AZURE_SQL_DATABASE})`,
    sequelize: new Sequelize(env.AZURE_SQL_DATABASE, env.AZURE_SQL_USER, env.AZURE_SQL_PASSWORD, {
      host: env.AZURE_SQL_SERVER,
      dialect: 'mssql',
      logging: false,
      dialectOptions: { options: { encrypt: true, trustServerCertificate: false, requestTimeout: 120000 } },
    }),
  };
}

/**
 * Wczytuje modele z models/ związane z podanym połączeniem (modele biorą połączenie z config/database,
 * więc na czas wczytania podmieniamy ten moduł). Zwraca modele w kolejności zależności (rodzice przed dziećmi).
 */
function loadModels(sequelize) {
  const dbPath = require.resolve('../config/database');
  const previous = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { sequelize } };
  const files = fs.readdirSync(MODELS_DIR).filter((name) => name.endsWith('.js')).map((name) => path.join(MODELS_DIR, name));
  files.forEach((file) => delete require.cache[require.resolve(file)]);
  try {
    files.forEach((file) => require(file));
  } finally {
    if (previous) require.cache[dbPath] = previous;
    else delete require.cache[dbPath];
  }
  const ordered = [];
  sequelize.modelManager.forEachModel((model) => ordered.push(model));
  return ordered;
}

/* ------------------------------ metadane tabel ------------------------------ */

const tableOf = (model) => {
  const name = model.getTableName();
  return typeof name === 'string' ? name : name.tableName;
};

function uniqueSets(model) {
  const seen = new Map();
  const add = (fields) => {
    if (fields && fields.length) seen.set(fields.join(','), fields);
  };
  Object.values(model.uniqueKeys || {}).forEach((key) => add(key.fields));
  (model.options.indexes || [])
    .filter((index) => index.unique)
    .forEach((index) => add(index.fields.map((field) => (typeof field === 'string' ? field : field.name || field.attribute))));
  return [...seen.values()];
}

function metaOf(model) {
  const attrs = model.rawAttributes;
  const names = Object.keys(attrs);
  return {
    model,
    table: tableOf(model),
    attrs,
    pk: names.filter((name) => attrs[name].primaryKey),
    auto: names.find((name) => attrs[name].autoIncrement) || null,
    uniques: uniqueSets(model),
  };
}

async function describeTable(conn, table) {
  try {
    return await conn.sequelize.getQueryInterface().describeTable(table);
  } catch (err) {
    if (/No description found/i.test(err.message)) return null;
    throw err;
  }
}

/* ------------------------------ wartości ------------------------------ */

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  const text = String(value).trim();
  let date = new Date(text);
  if (Number.isNaN(date.getTime())) date = new Date(text.replace(' ', 'T').replace(/ ?\+00:00$/, 'Z'));
  if (Number.isNaN(date.getTime())) throw new Error(`Nieprawidłowa data: ${value}`);
  return date;
}

/** Ujednolica wartość, żeby ta sama dane wyglądała tak samo w SQLite i w Azure SQL (daty, logiczne, UUID). */
function normalize(attribute, value) {
  if (value === null || value === undefined) return null;
  const key = attribute.type && (attribute.type.key || (attribute.type.constructor && attribute.type.constructor.key));
  if (key === 'DATE') return toDate(value);
  if (key === 'BOOLEAN') return value === true || value === 1 || value === '1' || value === 'true';
  if (key === 'UUID') return String(value).toLowerCase();
  if (key === 'INTEGER' || key === 'BIGINT' || key === 'SMALLINT') return Number(value);
  return value;
}

const keyPart = (value) => String(value).toLowerCase();
const pkKey = (meta, row) => meta.pk.map((name) => keyPart(row[name])).join('|');

/* ------------------------------ odczyt ------------------------------ */

async function readRows(conn, meta, columns) {
  if (!columns.length) return [];
  const rows = await meta.model.findAll({ attributes: columns, raw: true });
  return rows.map((row) => {
    const clean = {};
    columns.forEach((name) => {
      clean[name] = normalize(meta.attrs[name], row[name]);
    });
    return clean;
  });
}

/* ------------------------------ plan ------------------------------ */

function planTable({ src, tgt, srcRows, tgtRows, replace, ctx }) {
  const table = src.table;
  const plan = {
    table,
    source: srcRows.length,
    targetBefore: tgtRows.length,
    insert: [],
    existing: 0,
    conflicts: [],
    orphans: 0,
    removed: replace ? tgtRows.length : 0,
    tableMissing: !tgt.exists,
    missingColumns: tgt.missingColumns,
    notes: [],
  };

  const rule = CHILD_RULES[table];
  const insertedParents = rule ? ctx.inserted.get(rule.parentTable) : null;
  const targetKeys = new Set(replace || src.auto ? [] : tgtRows.map((row) => pkKey(src, row)));

  // Zbiory wartości pól unikalnych zajęte w bazie docelowej (bez uwzględniania wielkości liter, jak w Azure SQL).
  const usable = src.uniques.filter((fields) => fields.every((field) => tgt.columns.has(field) && src.attrs[field]));
  const taken = usable.map(() => new Map());
  if (!replace) {
    tgtRows.forEach((row) => {
      usable.forEach((fields, i) => {
        const values = fields.map((field) => row[field]);
        if (values.some((value) => value === null || value === undefined)) return;
        taken[i].set(values.map(keyPart).join(''), pkKey(src, row) || 'istniejący wiersz');
      });
    });
  }

  for (const row of srcRows) {
    if (rule) {
      const parent = row[rule.column] == null ? null : keyPart(row[rule.column]);
      if (!replace && !(insertedParents && insertedParents.has(parent))) {
        plan.existing += 1;
        continue;
      }
      if (!ctx.finalIds.get(rule.parentTable) || !ctx.finalIds.get(rule.parentTable).has(parent)) {
        plan.orphans += 1;
        continue;
      }
      plan.insert.push(row);
      continue;
    }

    if (!src.auto && targetKeys.has(pkKey(src, row))) {
      plan.existing += 1;
      continue;
    }

    const missingUser = USER_COLUMNS.find((column) => src.attrs[column] && row[column] != null && !ctx.userIds.has(keyPart(row[column])));
    if (missingUser) {
      plan.orphans += 1;
      continue;
    }

    let conflict = null;
    for (let i = 0; i < usable.length && !conflict; i += 1) {
      const values = usable[i].map((field) => row[field]);
      if (values.some((value) => value === null || value === undefined)) continue;
      const key = values.map(keyPart).join('');
      if (taken[i].has(key)) conflict = { fields: usable[i], values, with: taken[i].get(key) };
    }
    if (conflict) {
      plan.conflicts.push(conflict);
      continue;
    }

    usable.forEach((fields, i) => {
      const values = fields.map((field) => row[field]);
      if (values.every((value) => value !== null && value !== undefined)) taken[i].set(values.map(keyPart).join(''), 'ten sam plik źródłowy');
    });
    plan.insert.push(row);
  }
  return plan;
}

/** Wybiera tabele do kopiowania (w kolejności zależności, users na początku, żeby znać konta do sprawdzania odwołań). */
function selectTables(srcMetas, { tables, exclude }) {
  const known = new Set(srcMetas.map((meta) => meta.table));
  const wanted = (tables || []).filter(Boolean);
  const unknown = [...wanted, ...(exclude || [])].filter((name) => !known.has(name));
  if (unknown.length) throw new Error(`Nieznane tabele: ${unknown.join(', ')}. Dostępne: ${[...known].join(', ')}`);
  let selected = srcMetas.filter((meta) => !(exclude || []).includes(meta.table));
  if (wanted.length) selected = selected.filter((meta) => wanted.includes(meta.table));
  return [...selected.filter((meta) => meta.table === 'users'), ...selected.filter((meta) => meta.table !== 'users')];
}

/* ------------------------------ zapis ------------------------------ */

async function ensureSchema(conn, tgtMetas, plans) {
  const qi = conn.sequelize.getQueryInterface();
  for (const plan of plans) {
    const meta = tgtMetas.get(plan.table);
    if (plan.tableMissing) {
      await meta.model.sync();
    } else {
      for (const name of plan.missingColumns) {
        const attribute = meta.attrs[name];
        await qi.addColumn(meta.table, attribute.field || name, attribute);
      }
    }
  }
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

/** Ścieżka pliku w data/backups/, która jeszcze nie istnieje (przy kilku zapisach w tej samej sekundzie dodaje numer). */
function freshBackupPath(name, extension) {
  let candidate = path.join(BACKUP_DIR, `${name}${extension}`);
  for (let i = 2; fs.existsSync(candidate); i += 1) candidate = path.join(BACKUP_DIR, `${name}-${i}${extension}`);
  return candidate;
}

async function backupSqliteFile(conn, tag) {
  if (conn.kind !== 'sqlite' || !fs.existsSync(conn.file)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = freshBackupPath(`${path.basename(conn.file, path.extname(conn.file))}-przed-${tag}-${stamp()}`, '.sqlite3');
  await conn.sequelize.query(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

async function insertRows(conn, meta, rows, transaction) {
  const columns = Object.keys(meta.attrs).filter((name) => name !== meta.auto);
  const attributes = {};
  columns.forEach((name) => {
    attributes[name] = meta.attrs[name];
  });
  const qi = conn.sequelize.getQueryInterface();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((row) => {
      const values = {};
      columns.forEach((name) => {
        if (name in row) values[name] = row[name];
      });
      return values;
    });
    await qi.bulkInsert(meta.table, chunk, { transaction }, attributes);
  }
}

/* ------------------------------ całość ------------------------------ */

/**
 * @param {object} options
 * @param {object} options.source   połączenie źródłowe (sqliteConnection / azureConnection)
 * @param {object} options.target   połączenie docelowe
 * @param {string[]} [options.tables]   tylko te tabele
 * @param {string[]} [options.exclude]  pomiń te tabele (domyślnie sessions)
 * @param {boolean} [options.replace]   zastąp zawartość tabel zamiast scalać
 * @param {boolean} [options.apply]     zapisz zmiany (bez tego tylko plan)
 * @param {string}  [options.direction] opis kierunku do nazwy pliku z listą zmian (push / pull)
 * @returns {Promise<{ plans: object[], applied: boolean, manifest: string|null, sqliteBackup: string|null, verified: object[] }>}
 */
async function syncDatabases({ source, target, tables, exclude = DEFAULT_EXCLUDE, replace = false, apply = false, direction = 'sync' }) {
  await source.sequelize.authenticate();
  await target.sequelize.authenticate();

  const srcMetas = loadModels(source.sequelize).map(metaOf);
  const tgtMetas = new Map(loadModels(target.sequelize).map(metaOf).map((meta) => [meta.table, meta]));
  const selected = selectTables(srcMetas, { tables, exclude }).filter((meta) => tgtMetas.has(meta.table));

  const ctx = { inserted: new Map(), finalIds: new Map(), userIds: new Set() };
  const plans = [];
  const preImages = new Map();

  // Konta w bazie docelowej (do sprawdzania odwołań), gdy tabela users nie jest kopiowana.
  const usersSelected = selected.some((meta) => meta.table === 'users');
  if (!usersSelected && tgtMetas.has('users')) {
    const desc = await describeTable(target, 'users');
    if (desc) (await readRows(target, tgtMetas.get('users'), ['id'])).forEach((row) => ctx.userIds.add(keyPart(row.id)));
  }

  for (const src of selected) {
    const tgt = tgtMetas.get(src.table);
    const srcDesc = await describeTable(source, src.table);
    if (!srcDesc) {
      plans.push({ table: src.table, source: 0, targetBefore: 0, insert: [], existing: 0, conflicts: [], orphans: 0, removed: 0, tableMissing: false, missingColumns: [], notes: ['brak tabeli w bazie źródłowej'] });
      continue;
    }
    const tgtDesc = await describeTable(target, src.table);
    const srcColumns = Object.keys(src.attrs).filter((name) => srcDesc[src.attrs[name].field || name]);
    const tgtColumnSet = new Set(tgtDesc ? Object.keys(tgt.attrs).filter((name) => tgtDesc[tgt.attrs[name].field || name]) : Object.keys(tgt.attrs));
    const missingColumns = tgtDesc ? Object.keys(tgt.attrs).filter((name) => !tgtDesc[tgt.attrs[name].field || name]) : [];

    const srcRows = await readRows(source, src, srcColumns);
    const keyColumns = [...new Set([...src.pk, ...src.uniques.flat()])].filter((name) => tgtDesc && tgtDesc[tgt.attrs[name].field || name]);
    const tgtRows = tgtDesc ? await readRows(target, tgt, keyColumns) : [];
    if (replace && tgtDesc && apply) preImages.set(src.table, await readRows(target, tgt, Object.keys(tgt.attrs).filter((name) => tgtDesc[tgt.attrs[name].field || name])));

    const plan = planTable({
      src,
      tgt: { exists: !!tgtDesc, columns: tgtColumnSet, missingColumns },
      srcRows,
      tgtRows,
      replace,
      ctx,
    });
    plans.push(plan);

    const insertedKeys = new Set(plan.insert.map((row) => pkKey(src, row)));
    ctx.inserted.set(src.table, new Set(plan.insert.map((row) => keyPart(row[src.pk[0]]))));
    // Identyfikatory wierszy, które będą w bazie docelowej po zapisie (do sprawdzania odwołań w tabelach zależnych).
    const finalIds = new Set(plan.insert.map((row) => keyPart(row[src.pk[0]])));
    if (!replace) tgtRows.forEach((row) => src.pk.length === 1 && row[src.pk[0]] != null && finalIds.add(keyPart(row[src.pk[0]])));
    ctx.finalIds.set(src.table, finalIds);
    if (src.table === 'users') {
      plan.insert.forEach((row) => ctx.userIds.add(keyPart(row.id)));
      if (!replace) tgtRows.forEach((row) => ctx.userIds.add(keyPart(row.id)));
    }
    plan.keys = src.auto ? [] : [...insertedKeys];
    plan.rows = plan.insert;
  }

  const result = { plans, applied: false, manifest: null, sqliteBackup: null, verified: [] };
  if (!apply) return result;

  const active = plans.filter((plan) => plan.notes.length === 0);
  await ensureSchema(target, tgtMetas, active);
  result.sqliteBackup = await backupSqliteFile(target, direction);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    direction,
    source: source.label,
    target: target.label,
    mode: replace ? 'replace' : 'merge',
    tables: {},
  };
  active.forEach((plan) => {
    manifest.tables[plan.table] = { inserted: plan.keys };
    if (preImages.has(plan.table)) manifest.tables[plan.table].previous = preImages.get(plan.table);
  });
  result.manifest = freshBackupPath(`db-sync-${direction}-${stamp()}`, '.json');
  fs.writeFileSync(result.manifest, JSON.stringify(manifest, null, 2), 'utf-8');

  await target.sequelize.transaction(async (transaction) => {
    if (replace) {
      for (const plan of [...active].reverse()) {
        await tgtMetas.get(plan.table).model.destroy({ where: {}, transaction });
      }
    }
    for (const plan of active) {
      await insertRows(target, tgtMetas.get(plan.table), plan.rows, transaction);
    }
  });
  result.applied = true;

  for (const plan of active) {
    const count = await tgtMetas.get(plan.table).model.count();
    const expected = (replace ? 0 : plan.targetBefore) + plan.insert.length;
    result.verified.push({ table: plan.table, count, expected, ok: count === expected });
  }
  return result;
}

module.exports = {
  DEFAULT_EXCLUDE,
  sqliteConnection,
  azureConnection,
  syncDatabases,
  loadModels,
  metaOf,
  // Wewnętrzne funkcje udostępnione testom.
  internals: { readRows, insertRows, normalize },
};
