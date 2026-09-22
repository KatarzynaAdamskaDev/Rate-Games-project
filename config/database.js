const { Sequelize } = require('sequelize');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

let sequelize;

if (isProduction) {
  // PROD: Azure SQL Database
  sequelize = new Sequelize(
    process.env.AZURE_SQL_DATABASE,
    process.env.AZURE_SQL_USER,
    process.env.AZURE_SQL_PASSWORD,
    {
      host: process.env.AZURE_SQL_SERVER,
      dialect: 'mssql',
      dialectOptions: {
        options: {
          encrypt: true, // wymagane przez Azure SQL
          trustServerCertificate: false,
        },
      },
      logging: false,
    }
  );
} else {
  // DEV: lokalny plik SQLite, zero konfiguracji. SQLITE_STORAGE pozwala testom (tests/setup/testApp.js)
  // wskazać własny, tymczasowy plik zamiast dev.sqlite3 - bez tego każdy test czyściłby prawdziwe dane.
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.SQLITE_STORAGE || path.join(__dirname, '..', 'data', 'dev.sqlite3'),
    logging: false,
  });
}

/**
 * SQLite domyślnie blokuje bazę na czas zapisu, więc częsty odczyt w tle (polling czatu i
 * powiadomień co kilka sekund) mógłby się zderzać z zapisem wiadomości ("database is locked").
 * WAL pozwala czytać i pisać jednocześnie, a busy_timeout każe czekać i spróbować ponownie,
 * gdyby mimo to dwa zapisy trafiły się naprawdę równocześnie, zamiast od razu rzucać błąd.
 * Trzeba to ustawić explicit zapytaniem (nie przez opcję Sequelize) - dialekt sqlite w tej
 * wersji Sequelize nadpisuje getConnection() z pominięciem hooka "afterConnect".
 * Bez znaczenia dla Azure SQL (prod) - tam o to dba sama baza.
 */
async function configureSqliteConcurrency() {
  if (isProduction) return;
  await sequelize.query('PRAGMA journal_mode = WAL');
  await sequelize.query('PRAGMA busy_timeout = 5000');
}

module.exports = { sequelize, configureSqliteConcurrency };