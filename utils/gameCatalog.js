/**
 * Katalog gier: jedno miejsce, z którego reszta aplikacji pobiera dane gry po id.
 * Gry z IGDB mają id numeryczne (pobierane partiami i cache'owane w pamięci),
 * a gry dodane przez administratora - id w postaci UUID (tabela custom_games).
 */
const { fetchIGDBGames, formatIGDBGame, IGDB_GAME_FIELDS } = require('./igdbService');
const CustomGame = require('../models/CustomGame');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 3000;
const IGDB_BATCH_SIZE = 100;

const cache = new Map(); // id (string) -> { game, at }

function isIgdbId(id) {
  return /^\d+$/.test(String(id));
}

function fromCustomRow(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    platform: row.platform,
    releaseYear: row.releaseYear || 'Brak danych',
    coverImage: row.coverImage || '/images/game-placeholder.svg',
    description: row.description,
  };
}

function remember(game) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const key of [...cache.keys()].slice(0, 500)) cache.delete(key);
  }
  cache.set(String(game.id), { game, at: Date.now() });
}

/** Zwraca Map: id (string) -> gra. Gier, których nie udało się pobrać, w mapie nie ma. */
async function getGamesByIds(ids) {
  const unique = [...new Set(ids.filter((id) => id !== null && id !== undefined).map(String))];
  const result = new Map();
  const missingIgdb = [];
  const customIds = [];

  for (const id of unique) {
    const cached = cache.get(id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      result.set(id, cached.game);
    } else if (isIgdbId(id)) {
      missingIgdb.push(id);
    } else {
      customIds.push(id);
    }
  }

  for (let i = 0; i < missingIgdb.length; i += IGDB_BATCH_SIZE) {
    const batch = missingIgdb.slice(i, i + IGDB_BATCH_SIZE);
    const raw = await fetchIGDBGames(
      `${IGDB_GAME_FIELDS} where id = (${batch.join(',')}); limit ${batch.length};`
    );
    raw.forEach((row) => {
      const game = formatIGDBGame(row);
      remember(game);
      result.set(String(game.id), game);
    });
  }

  if (customIds.length > 0) {
    const rows = await CustomGame.findAll({ where: { id: customIds } });
    rows.forEach((row) => result.set(String(row.id), fromCustomRow(row)));
  }

  return result;
}

async function getGameById(id) {
  if (id === null || id === undefined || id === '') return null;
  const games = await getGamesByIds([id]);
  return games.get(String(id)) || null;
}

module.exports = { getGamesByIds, getGameById, fromCustomRow, isIgdbId };
