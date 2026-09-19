/**
 * Wspólna logika list gier (strona Gry, Kategorie, Szukaj) oparta na IGDB.
 * Filtry (kategoria, platforma, rok), sortowanie i wyszukiwanie są wykonywane
 * po stronie IGDB, więc dotyczą całej bazy gier, a nie tylko pierwszej strony.
 */
const {
  GAME_TYPE_FILTER,
  IGDB_GAME_FIELDS,
  PLATFORM_FILTERS,
  fetchIGDBGames,
  formatIGDBGame,
  getGenres,
} = require('./igdbService');
const { withRatings } = require('./gameHelpers');

const PAGE_SIZE = 24;
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

/** Usuwa znaki, które mogłyby zepsuć zapytanie IGDB (Apicalypse). */
function cleanSearchTerm(q) {
  return String(q || '')
    .replace(/["\\;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

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
  return Number.isInteger(n) && n > 0 ? Math.min(n, 200) : 1;
}

/**
 * Pobiera stronę gier z IGDB.
 * @returns {{ games: object[], hasNext: boolean, page: number, sort: string }}
 */
async function listGames({ q, genre, platform, year, sort, page, pageSize = PAGE_SIZE } = {}) {
  const search = cleanSearchTerm(q);
  const activeSort = normalizeSort(sort);
  const activePage = normalizePage(page);

  const where = ['version_parent = null', GAME_TYPE_FILTER];
  if (genre) where.push(`genres = (${Number(genre.id)})`);

  const platformIds = PLATFORM_FILTERS[String(platform || '').toLowerCase()];
  if (platformIds) where.push(`platforms = (${platformIds.join(',')})`);

  const yearNumber = parseInt(year, 10);
  if (yearNumber >= 1970 && yearNumber <= 2100) {
    const from = Date.UTC(yearNumber, 0, 1) / 1000;
    const to = Date.UTC(yearNumber + 1, 0, 1) / 1000;
    where.push(`first_release_date >= ${from} & first_release_date < ${to}`);
  }

  // IGDB nie pozwala łączyć wyszukiwania z sortowaniem (wyniki idą wg trafności),
  // a bez ograniczenia liczby ocen lista zaczynałaby się od nieznanych tytułów.
  let order = '';
  if (!search) {
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
      where.push('total_rating_count > 0');
      order = 'sort total_rating_count desc;';
    }
  }

  // Wyszukiwanie: IGDB zwraca wyniki wg trafności, więc pobieramy szersze okno i sami
  // układamy je tak, żeby tytuł zgodny z frazą i najpopularniejsze gry były na górze
  // (np. "minecraft" -> Minecraft: Java Edition, a nie mało znane spin-offy).
  const windowSize = search ? pageSize * 2 : pageSize + 1;

  const query = [
    search ? `search "${search}";` : '',
    IGDB_GAME_FIELDS,
    `where ${where.join(' & ')};`,
    order,
    `limit ${windowSize}; offset ${(activePage - 1) * (search ? windowSize : pageSize)};`,
  ]
    .filter(Boolean)
    .join(' ');

  let raw = await fetchIGDBGames(query);
  const hasNext = search ? raw.length >= windowSize : raw.length > pageSize;

  if (search) {
    const needle = search.toLowerCase();
    raw = raw
      .map((game, index) => ({ game, index }))
      .sort((a, b) => {
        const exactA = a.game.name.toLowerCase() === needle ? 1 : 0;
        const exactB = b.game.name.toLowerCase() === needle ? 1 : 0;
        return (
          exactB - exactA ||
          (b.game.total_rating_count || 0) - (a.game.total_rating_count || 0) ||
          a.index - b.index
        );
      })
      .map((item) => item.game);
  }

  const games = await withRatings(raw.slice(0, pageSize).map(formatIGDBGame));

  return { games, hasNext, page: activePage, sort: activeSort };
}

/** Linki "poprzednia / następna strona" z zachowaniem pozostałych filtrów w URL-u. */
function buildPagerLinks(req, page, hasNext) {
  const base = req.originalUrl.split('?')[0];
  const link = (p) => {
    const params = new URLSearchParams(req.query);
    params.set('page', p);
    return `${base}?${params.toString()}`;
  };
  return { prev: page > 1 ? link(page - 1) : null, next: hasNext ? link(page + 1) : null };
}

module.exports = {
  PAGE_SIZE,
  listGames,
  findGenre,
  availableYears,
  normalizeSort,
  buildPagerLinks,
};
