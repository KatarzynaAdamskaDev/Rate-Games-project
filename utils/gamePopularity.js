/**
 * Ranking popularności gier.
 *
 * Samo `total_rating_count` z IGDB to w praktyce liczba osób, które oznaczyły grę jako "zagrane" na
 * IGDB - stąd wysoko lądują stare klasyki (Portal 1 tuż za Portalem 2), a ogromne gry ze Steama
 * (CS2) toną. IGDB udostępnia lepsze dane (popularity_primitives), więc łączymy kilka rankingów:
 *   - "Playing"   - kto gra teraz,
 *   - "Played"    - kto zagrał (klasyki zostają wysoko),
 *   - Steam: szczytowa liczba graczy oraz liczba recenzji.
 * Rankingi łączymy metodą "reciprocal rank fusion": gra wysoko na kilku listach wygrywa z grą, która
 * jest #1 tylko na jednej. Wynik (kilkaset najpopularniejszych gier z pełnymi danymi) trzymamy
 * w pamięci kilka godzin.
 */
const { fetchIGDB, IGDB_GAME_FIELDS, GAME_TYPE_FILTER } = require('./igdbService');
const { buildVocabulary } = require('./searchText');

// Do dopasowania skrótów w wyszukiwarce potrzebne są też nazwy alternatywne gier z rankingu.
const POOL_FIELDS = IGDB_GAME_FIELDS.replace(/;\s*$/, ', alternative_names.name;');

const LISTS = [
  { type: 3, weight: 1 }, // IGDB: grają teraz
  { type: 4, weight: 1 }, // IGDB: zagrali
  { type: 5, weight: 0.6 }, // Steam: szczyt graczy w ciągu doby
  { type: 8, weight: 0.5 }, // Steam: liczba recenzji
];
const LIST_SIZE = 500;
const FUSION_K = 30;
const POOL_SIZE = 900;
const BATCH_SIZE = 500;
const MIN_POOL = 50;

const TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

let state = { pool: null, at: 0, lastAttempt: 0, loading: null };

async function build() {
  const lists = await Promise.all(
    LISTS.map((list) =>
      fetchIGDB(
        'popularity_primitives',
        `fields game_id, value; where popularity_type = ${list.type}; sort value desc; limit ${LIST_SIZE};`,
      ),
    ),
  );

  const scores = new Map();
  lists.forEach((rows, index) => {
    rows.forEach((row, rank) => {
      scores.set(row.game_id, (scores.get(row.game_id) || 0) + LISTS[index].weight / (FUSION_K + rank));
    });
  });

  const ids = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, POOL_SIZE)
    .map(([id]) => id);

  // Pełne dane gier (tylko właściwe gry, bez DLC i wydań) - po kilkaset na zapytanie.
  const batches = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) batches.push(ids.slice(i, i + BATCH_SIZE));
  const rows = (
    await Promise.all(
      batches.map((batch) =>
        fetchIGDB(
          'games',
          `${POOL_FIELDS} where id = (${batch.join(',')}) & version_parent = null & ${GAME_TYPE_FILTER}; limit ${BATCH_SIZE};`,
        ),
      ),
    )
  ).flat();

  const byId = new Map(rows.map((row) => [row.id, row]));
  const games = ids.map((id) => byId.get(id)).filter(Boolean);
  if (games.length < MIN_POOL) return null;

  return {
    games,
    rankById: new Map(games.map((game, index) => [game.id, index])),
    idList: ids.join(','),
    vocabulary: buildVocabulary(games.map((game) => game.name)),
  };
}

function start() {
  if (state.loading) return state.loading;
  state.lastAttempt = Date.now();
  state.loading = build()
    .then((pool) => {
      if (pool) state = { ...state, pool, at: Date.now() };
    })
    .catch((err) => {
      console.error('[IGDB] BŁĄD: nie udało się zbudować rankingu popularności:', err.message);
    })
    .finally(() => {
      state.loading = null;
    });
  return state.loading;
}

function isStale() {
  return !state.pool || Date.now() - state.at > TTL_MS;
}

/** Ranking gotowy do użycia albo null (np. IGDB niedostępne). Pierwsze wywołanie czeka na zbudowanie. */
async function getPopularPool() {
  if (!state.pool) {
    if (Date.now() - state.lastAttempt > RETRY_MS || state.loading) await start();
  } else if (isStale() && Date.now() - state.lastAttempt > RETRY_MS) {
    start(); // odświeżamy w tle, na razie zwracamy poprzedni ranking
  }
  return state.pool;
}

/**
 * Pozycje gier w rankingu (id -> miejsce, 0 = najpopularniejsza) albo null, gdy ranking jeszcze
 * się buduje. Nie czeka - wyszukiwarka ma działać także bez niego (wtedy liczy się liczba ocen).
 */
function peekPopularRanks() {
  if (isStale() && !state.loading && Date.now() - state.lastAttempt > RETRY_MS) start();
  return state.pool ? state.pool.rankById : null;
}

/** Gry z rankingu (od najpopularniejszej) albo null, gdy ranking jeszcze się buduje. Nie czeka. */
function peekPopularGames() {
  peekPopularRanks();
  return state.pool ? state.pool.games : null;
}

/** Słowa z nazw popularnych gier (do dzielenia sklejonych fraz) albo null, gdy ranking się buduje. */
function peekVocabulary() {
  return state.pool ? state.pool.vocabulary : null;
}

/** Buduje ranking z wyprzedzeniem (przy starcie serwera), żeby pierwsze wejście nie czekało. */
function warmPopularPool() {
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) return Promise.resolve();
  return start();
}

module.exports = { getPopularPool, peekPopularRanks, peekPopularGames, peekVocabulary, warmPopularPool };
