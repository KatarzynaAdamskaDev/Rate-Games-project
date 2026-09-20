/**
 * Wspólna logika list gier (strona Gry, Kategorie, Szukaj) oparta na IGDB.
 * Filtry (kategoria, platforma, rok), sortowanie i wyszukiwanie są wykonywane
 * po stronie IGDB, więc dotyczą całej bazy gier, a nie tylko pierwszej strony.
 */
const {
  GAME_TYPE_FILTER,
  IGDB_GAME_FIELDS,
  PLATFORM_FILTERS,
  fetchIGDB,
  fetchIGDBGames,
  formatIGDBGame,
  getGenres,
} = require('./igdbService');
const { withRatings } = require('./gameHelpers');
const { smartSearch, cleanTerm } = require('./gameSearch');
const { getPopularPool } = require('./gamePopularity');

const PAGE_SIZE = 24;
const MAX_PAGE = 100000; // rzeczywisty limit wynika z liczby gier (ostatnia strona)
const COUNT_TTL_MS = 30 * 60 * 1000;
const COUNT_MAX_ENTRIES = 300;
const countCache = new Map(); // warunki zapytania -> { count, at }
const SORTS = ['popular', 'rating', 'newest', 'title'];

/** Stare (polskie) nazwy kategorii z linków na stronie głównej -> slugi gatunków IGDB. */
const LEGACY_CATEGORY_ALIASES = {
  akcja: 'shooter',
  przygodowe: 'adventure',
  rpg: 'role-playing-rpg',
  strategia: 'strategy',
  platformowka: 'platform',
  symulator: 'simulator',
};

/** Znajduje gatunek po slugu lub nazwie (bez względu na wielkość liter). */
async function findGenre(value) {
  if (!value) return null;
  const needle = String(value).toLowerCase();
  const slug = LEGACY_CATEGORY_ALIASES[needle] || needle;
  const genres = await getGenres();
  return genres.find((g) => g.slug === slug || g.name.toLowerCase() === needle) || null;
}

function availableYears() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current; y >= 1990; y--) years.push(y);
  return years;
}

function normalizeSort(sort) {
  return SORTS.includes(sort) ? sort : 'popular';
}

function normalizePage(page) {
  const n = parseInt(page, 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_PAGE) : 1;
}

/** Liczba gier spełniających warunki (do numeracji stron); null, gdy IGDB nie odpowie. Wynik na chwilę w pamięci. */
async function countGames(conditions) {
  const cached = countCache.get(conditions);
  if (cached && Date.now() - cached.at < COUNT_TTL_MS) return cached.count;

  const result = await fetchIGDB('games/count', `where ${conditions};`);
  const count = result && Number.isInteger(result.count) ? result.count : null;
  if (count !== null) {
    if (countCache.size >= COUNT_MAX_ENTRIES) countCache.delete(countCache.keys().next().value);
    countCache.set(conditions, { count, at: Date.now() });
  }
  return count;
}

function pageCount(total, pageSize) {
  return total === null ? null : Math.max(1, Math.ceil(total / pageSize));
}

/** Czy gra z rankingu popularności spełnia wybrane filtry (te same, które w IGDB idą w `where`). */
function matchesFilters(game, { genre, platformIds, yearRange }) {
  if (genre && !(game.genres || []).some((g) => g.id === genre.id)) return false;
  if (platformIds && !(game.platforms || []).some((p) => platformIds.includes(p.id))) return false;
  if (yearRange && !(game.first_release_date >= yearRange.from && game.first_release_date < yearRange.to)) return false;
  return true;
}

/**
 * Strona listy "Popularne": najpierw gry z rankingu popularności pasujące do filtrów (liczone w pamięci),
 * a gdy ranking się skończy (wąskie filtry, dalsze strony) - reszta gier z IGDB wg liczby ocen.
 */
async function popularPage(pool, { where, genre, platformIds, yearRange, page, pageSize }) {
  const matching = pool.games.filter((game) => matchesFilters(game, { genre, platformIds, yearRange }));
  const extraConditions = [...where, 'total_rating_count > 0', `id != (${pool.idList})`].join(' & ');

  const extraTotal = await countGames(extraConditions);
  const totalPages = pageCount(extraTotal === null ? null : matching.length + extraTotal, pageSize);
  const activePage = totalPages ? Math.min(page, totalPages) : page;

  const start = (activePage - 1) * pageSize;
  const head = matching.slice(start, start + pageSize);
  let games = head;
  let hasNext = matching.length > start + pageSize;

  if (!hasNext) {
    const missing = pageSize - head.length;
    const extra = await fetchIGDBGames(
      [
        IGDB_GAME_FIELDS,
        `where ${extraConditions};`,
        'sort total_rating_count desc;',
        `limit ${missing + 1}; offset ${Math.max(0, start - matching.length)};`,
      ].join(' '),
    );
    games = [...head, ...extra.slice(0, missing)];
    hasNext = extra.length > missing;
  }

  return { games: await withRatings(games.map(formatIGDBGame)), hasNext, page: activePage, totalPages, sort: 'popular' };
}

/**
 * Pobiera stronę gier z IGDB.
 * @returns {{ games: object[], hasNext: boolean, page: number, sort: string }}
 */
async function listGames({ q, genre, platform, year, sort, page, pageSize = PAGE_SIZE } = {}) {
  const search = cleanTerm(q);
  const activeSort = normalizeSort(sort);
  const activePage = normalizePage(page);

  const where = ['version_parent = null', GAME_TYPE_FILTER];
  if (genre) where.push(`genres = (${Number(genre.id)})`);

  const platformIds = PLATFORM_FILTERS[String(platform || '').toLowerCase()];
  if (platformIds) where.push(`platforms = (${platformIds.join(',')})`);

  let yearRange = null;
  const yearNumber = parseInt(year, 10);
  if (yearNumber >= 1970 && yearNumber <= 2100) {
    yearRange = { from: Date.UTC(yearNumber, 0, 1) / 1000, to: Date.UTC(yearNumber + 1, 0, 1) / 1000 };
    where.push(`first_release_date >= ${yearRange.from} & first_release_date < ${yearRange.to}`);
  }

  // Wyszukiwanie po frazie: nazwy, skróty ("cs2", "gta5", "cod") i fragmenty nazw, ułożone
  // wg trafności i popularności (szczegóły w utils/gameSearch.js). Filtry działają jak zawsze.
  if (search) {
    const found = await smartSearch(search, {
      fields: IGDB_GAME_FIELDS,
      where,
      accept: (game) => matchesFilters(game, { genre, platformIds, yearRange }),
    });
    const totalPages = pageCount(found.length, pageSize);
    const shownPage = Math.min(activePage, totalPages);
    const start = (shownPage - 1) * pageSize;
    const games = await withRatings(found.slice(start, start + pageSize).map(formatIGDBGame));
    return { games, hasNext: found.length > start + pageSize, page: shownPage, totalPages, sort: activeSort };
  }

  // Bez frazy sortujemy po stronie IGDB, a bez ograniczenia liczby ocen lista
  // zaczynałaby się od nieznanych tytułów.
  let order;
  if (activeSort === 'newest') {
    where.push(`first_release_date <= ${Math.floor(Date.now() / 1000)}`, 'total_rating_count > 0');
    order = 'sort first_release_date desc;';
  } else if (activeSort === 'rating') {
    where.push('total_rating_count > 25');
    order = 'sort total_rating desc;';
  } else if (activeSort === 'title') {
    where.push('total_rating_count > 20');
    order = 'sort name asc;';
  } else {
    // "Popularne": ranking z danych o graczach (utils/gamePopularity.js) zamiast samej liczby ocen w IGDB.
    const pool = await getPopularPool();
    if (pool) return popularPage(pool, { where, genre, platformIds, yearRange, page: activePage, pageSize });

    where.push('total_rating_count > 0');
    order = 'sort total_rating_count desc;';
  }

  const conditions = where.join(' & ');
  const fetchPage = (number) =>
    fetchIGDBGames(
      [
        IGDB_GAME_FIELDS,
        `where ${conditions};`,
        order,
        `limit ${pageSize + 1}; offset ${(number - 1) * pageSize};`,
      ].join(' '),
    );

  // Liczba gier (do numeracji stron) idzie równolegle z pobraniem strony i jest zapamiętywana.
  let shownPage = activePage;
  let [raw, total] = await Promise.all([fetchPage(shownPage), countGames(conditions)]);
  const totalPages = pageCount(total, pageSize);
  if (totalPages && shownPage > totalPages) {
    shownPage = totalPages; // adres z numerem strony większym niż ostatnia
    raw = await fetchPage(shownPage);
  }

  const games = await withRatings(raw.slice(0, pageSize).map(formatIGDBGame));
  const hasNext = totalPages ? shownPage < totalPages : raw.length > pageSize;

  return { games, hasNext, page: shownPage, totalPages, sort: activeSort };
}

/** Numery stron do wyświetlenia: pierwsza, ostatnia i okolice bieżącej (null = przerwa "..."). */
function pageNumbers(page, total) {
  const wanted = new Set([1, total]);
  for (let n = page - 2; n <= page + 2; n += 1) if (n >= 1 && n <= total) wanted.add(n);

  const items = [];
  let previous = 0;
  [...wanted]
    .sort((a, b) => a - b)
    .forEach((n) => {
      if (n - previous === 2) items.push(previous + 1); // przerwa na jedną stronę - lepiej pokazać ją niż "..."
      else if (n - previous > 2) items.push(null);
      items.push(n);
      previous = n;
    });
  return items;
}

/**
 * Linki do stron z zachowaniem pozostałych filtrów w URL-u: poprzednia / następna oraz - gdy znamy
 * liczbę stron - numerowany pasek (pierwsza, ostatnia, okolice bieżącej) i pole "idź do strony".
 */
function buildPagerLinks(req, page, hasNext, totalPages = null) {
  const base = req.originalUrl.split('?')[0];
  const link = (p) => {
    const params = new URLSearchParams(req.query);
    params.set('page', p);
    return `${base}?${params.toString()}`;
  };
  const pager = { prev: page > 1 ? link(page - 1) : null, next: hasNext ? link(page + 1) : null };

  if (totalPages && totalPages > 1) {
    pager.total = totalPages;
    pager.current = page;
    pager.pages = pageNumbers(page, totalPages).map((n) =>
      n === null ? { gap: true } : { n, href: link(n), current: n === page, far: Math.abs(n - page) === 2 },
    );
    pager.jump = {
      action: base,
      max: totalPages,
      fields: [...new URLSearchParams(req.query)].filter(([name]) => name !== 'page'),
    };
  }
  return pager;
}

module.exports = {
  PAGE_SIZE,
  listGames,
  findGenre,
  availableYears,
  normalizeSort,
  buildPagerLinks,
};
