/**
 * Kopiowanie danych między lokalną bazą SQLite a Azure SQL.
 *
 *   npm run db:push                  podgląd: co z lokalnej bazy trafiłoby do Azure (nic nie zapisuje)
 *   npm run db:push -- --apply       zapisuje w Azure
 *   npm run db:pull                  podgląd: co z Azure trafiłoby do lokalnej bazy
 *   npm run db:pull -- --apply       zapisuje w lokalnej bazie (najpierw robi jej kopię w data/backups/)
 *   npm run db:list                  lista tabel
 *
 * Opcje:
 *   --apply                       zapisz zmiany (bez tego tylko raport)
 *   --tables=users,reviews        tylko te tabele (nazwy jak w bazie, zobacz db:list)
 *   --exclude=admin_logs          pomiń tabele (domyślnie zawsze pomijana jest sessions)
 *   --replace --confirm=NAZWA     zastąp zawartość wybranych tabel zamiast scalać; NAZWA to nazwa bazy docelowej
 *                                 (Azure) albo nazwa pliku (SQLite) - zabezpieczenie przed pomyłką
 *   --local=data/dev.sqlite3      plik lokalnej bazy SQLite
 *   --env-file=.env.azure         plik ze zmiennymi AZURE_SQL_* (domyślnie .env)
 *   --remote-sqlite=plik.sqlite3  zamiast Azure użyj drugiego pliku SQLite (do prób)
 *
 * Domyślnie dane są SCALANE: wiersze, które już są w bazie docelowej (to samo id), zostają bez zmian,
 * wiersze z konfliktem (np. ta sama nazwa użytkownika pod innym id) są pomijane i wypisane w raporcie.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
const HELP = `Użycie: node scripts/db-sync.js <push|pull|list> [opcje]
  push   lokalna SQLite -> Azure SQL
  pull   Azure SQL -> lokalna SQLite
  list   lista tabel

Opcje: --apply  --tables=a,b  --exclude=a,b  --replace --confirm=NAZWA
       --local=PLIK  --env-file=PLIK  --remote-sqlite=PLIK
Bez --apply skrypt tylko pokazuje, co by zrobił.`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  rest.forEach((arg) => {
    if (!arg.startsWith('--')) throw new Error(`Nieznany argument: ${arg}`);
    const [key, ...value] = arg.slice(2).split('=');
    flags[key] = value.length ? value.join('=') : true;
  });
  return { command, flags };
}

const list = (value) => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);

function printReport(result, { replace, apply }) {
  const cols = ['tabela', 'w źródle', 'do dodania', 'już są', 'konflikty', 'bez konta'];
  if (replace) cols.push('usunięte');
  const rows = result.plans
    .filter((plan) => plan.source || plan.removed || plan.notes.length)
    .map((plan) => {
      const line = [plan.table, plan.source, plan.insert.length, plan.existing, plan.conflicts.length, plan.orphans];
      if (replace) line.push(plan.removed);
      return line.map(String);
    });
  const widths = cols.map((name, i) => Math.max(name.length, ...rows.map((row) => row[i].length)));
  const fmt = (row) => row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ');
  console.log(fmt(cols));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  rows.forEach((row) => console.log(fmt(row)));
  const empty = result.plans.filter((plan) => !plan.source && !plan.removed && !plan.notes.length).map((plan) => plan.table);
  if (empty.length) console.log(`\nPuste w źródle (pominięte w tabeli): ${empty.join(', ')}`);

  result.plans.forEach((plan) => {
    plan.notes.forEach((note) => console.log(`\nUwaga - ${plan.table}: ${note}`));
    if (plan.tableMissing && plan.source) console.log(`\nUwaga - ${plan.table}: w bazie docelowej brak tabeli${apply ? ' - została utworzona' : ' - zostanie utworzona przy zapisie'}.`);
    if (plan.missingColumns.length) console.log(`\nUwaga - ${plan.table}: w bazie docelowej brakuje kolumn: ${plan.missingColumns.join(', ')}${apply ? ' - zostały dodane' : ' - zostaną dodane przy zapisie'}.`);
  });

  const conflicts = result.plans.filter((plan) => plan.conflicts.length);
  if (conflicts.length) {
    console.log('\nKonflikty (te wiersze zostały pominięte, bo takie wartości już są w bazie docelowej):');
    conflicts.forEach((plan) => {
      plan.conflicts.slice(0, 5).forEach((conflict) => {
        console.log(`  ${plan.table}: ${conflict.fields.map((field, i) => `${field}=${conflict.values[i]}`).join(', ')}`);
      });
      if (plan.conflicts.length > 5) console.log(`  ${plan.table}: ... i ${plan.conflicts.length - 5} kolejnych`);
    });
  }
  const orphans = result.plans.filter((plan) => plan.orphans);
  if (orphans.length) {
    console.log('\nPominięto wiersze odwołujące się do kont (albo wpisów), których nie będzie w bazie docelowej:');
    orphans.forEach((plan) => console.log(`  ${plan.table}: ${plan.orphans}`));
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!['push', 'pull', 'list'].includes(command) || flags.help) {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  dotenv.config({ path: path.join(ROOT, '.env') });
  if (typeof flags['env-file'] === 'string') {
    const envPath = path.resolve(flags['env-file']);
    if (!fs.existsSync(envPath)) throw new Error(`Nie znaleziono pliku ze zmiennymi: ${envPath}`);
    dotenv.config({ path: envPath, override: true });
  }

  const { sqliteConnection, azureConnection, syncDatabases, loadModels, metaOf, DEFAULT_EXCLUDE } = require('../utils/dbSync');

  if (command === 'list') {
    const memory = sqliteConnection(':memory:');
    loadModels(memory.sequelize).map(metaOf).forEach((meta) => console.log(meta.table + (DEFAULT_EXCLUDE.includes(meta.table) ? '  (domyślnie pomijana)' : '')));
    return;
  }

  const localFile = typeof flags.local === 'string' ? flags.local : path.join(ROOT, 'data', 'dev.sqlite3');
  const local = sqliteConnection(localFile);
  const remote = typeof flags['remote-sqlite'] === 'string' ? sqliteConnection(flags['remote-sqlite']) : azureConnection();
  const source = command === 'push' ? local : remote;
  const target = command === 'push' ? remote : local;

  if (source.kind === 'sqlite' && !fs.existsSync(source.file)) throw new Error(`Nie znaleziono pliku bazy źródłowej: ${source.file}`);
  if (source.kind === 'sqlite' && target.kind === 'sqlite' && source.file === target.file) throw new Error('Źródło i cel to ten sam plik.');

  const replace = !!flags.replace;
  const apply = !!flags.apply;
  if (replace && flags.confirm !== target.name) {
    throw new Error(`Tryb --replace kasuje dotychczasową zawartość wybranych tabel w bazie docelowej.\nDodaj --confirm=${target.name} (nazwa bazy docelowej), jeśli to na pewno to, co chcesz zrobić.`);
  }

  const exclude = typeof flags.exclude === 'string' ? [...new Set([...DEFAULT_EXCLUDE, ...list(flags.exclude)])] : DEFAULT_EXCLUDE;
  console.log(`Kierunek: ${command}\n  źródło: ${source.label}\n  cel:    ${target.label}`);
  console.log(`Tryb:     ${replace ? 'ZASTĘPOWANIE zawartości tabel' : 'scalanie (istniejące wiersze bez zmian)'}${apply ? '' : ' - PODGLĄD, nic nie jest zapisywane'}\n`);

  let result;
  try {
    result = await syncDatabases({ source, target, tables: list(flags.tables), exclude, replace, apply, direction: command });
  } finally {
    await Promise.allSettled([source.sequelize.close(), target.sequelize.close()]);
  }

  printReport(result, { replace, apply });

  if (!apply) {
    const total = result.plans.reduce((sum, plan) => sum + plan.insert.length, 0);
    console.log(`\nTo był podgląd: do bazy docelowej trafiłoby ${total} wierszy. Aby zapisać, dodaj --apply.`);
    return;
  }

  console.log('\nZapisano w jednej transakcji.');
  if (result.sqliteBackup) console.log(`Kopia lokalnej bazy sprzed zmian: ${result.sqliteBackup}`);
  console.log(`Lista dodanych wierszy (do ewentualnego wycofania): ${result.manifest}`);
  const wrong = result.verified.filter((item) => !item.ok);
  if (wrong.length) {
    console.log('\nUWAGA - liczby wierszy po zapisie nie zgadzają się z oczekiwanymi:');
    wrong.forEach((item) => console.log(`  ${item.table}: jest ${item.count}, oczekiwano ${item.expected}`));
    process.exitCode = 1;
  } else {
    console.log('Kontrola: liczby wierszy w bazie docelowej zgadzają się z planem.');
  }
  if (target.kind === 'azure') console.log('Pamiętaj o plikach (awatary, okładki, zdjęcia z bloga): są poza bazą, skopiuj je do UPLOADS_DIR na serwerze.');
}

main().catch((err) => {
  console.error(`\nBłąd: ${err.message}`);
  if (/firewall|Cannot open server|ELOGIN|ESOCKET|ETIMEOUT|ECONNREFUSED|getaddrinfo|Login failed/i.test(`${err.message} ${err.parent ? err.parent.message : ''}`)) {
    console.error('Wygląda na problem z połączeniem z Azure SQL: sprawdź dane AZURE_SQL_*, a w portalu Azure (serwer SQL -> Networking) dodaj swój adres IP do reguł zapory.');
  }
  process.exit(1);
});
