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

module.exports = { sequelize };