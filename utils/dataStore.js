const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

/**
 * Odczytuje kolekcję (np. "games", "users") z pliku JSON.
 * Zwraca pustą tablicę, jeśli plik nie istnieje.
 */
function readCollection(name) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf-8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Zapisuje całą kolekcję do pliku JSON (nadpisuje zawartość).
 */
function writeCollection(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { readCollection, writeCollection };
