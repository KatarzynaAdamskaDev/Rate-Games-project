/**
 * Konfiguracja Jest. Patrz tests/README.md po opis, jak uruchamiać i pisać testy.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // Każdy plik testowy dostaje własny "realm" (Jest domyślnie izoluje moduły między plikami),
  // więc może bezpiecznie ustawić swoje zmienne środowiskowe (baza, katalog uploadów) przed
  // pierwszym require('../../app') bez wpływu na inne pliki testowe uruchomione równolegle.
  testTimeout: 20000,
  // sqlite3 i sharp mają natywne dodatki - domyślna liczba workerów bywa zbyt agresywna na słabszych maszynach.
  maxWorkers: '50%',
  collectCoverageFrom: [
    'utils/**/*.js',
    'routes/**/*.js',
    'middleware/**/*.js',
    'models/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  verbose: true,
};
