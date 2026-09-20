/**
 * Inteligentne wyszukiwanie gier w IGDB.
 *
 * Samo wyszukiwanie IGDB (`search "..."`) dopasowuje całe słowa, więc "cs" znajduje Counter-Strike'i,
 * ale już nie "CS2" (skrót to dla IGDB inne słowo). Dlatego łączymy dwa zapytania:
 *   1. wyszukiwanie IGDB (trafność, literówki),
 *   2. dopasowanie początku nazwy (wpisywanie "minecr") oraz - dla krótkich fraz - nazw alternatywnych
 *      (skróty: CS2, CSGO, GTA5, CoD, WoW...), ze znanymi skrótami z utils/gameAliases.js ("mc", "botw", "bg3")
 *      oraz z wariantami zapisu z utils/searchText.js ("little big planet" <-> "LittleBigPlanet", "spider man" <->
 *      "Spider-Man", "gta5" <-> "gta 5", "ff 7" <-> "Final Fantasy VII"),
 * a gdy nic nie znajdzie - trzecie: fragment nazwy w dowolnym miejscu ("raft"). Przy braku trafień szukamy
 * też literówek wśród popularnych gier ("skirym" -> Skyrim).
 * Wyniki układamy sami: najpierw gry, których nazwa lub skrót zaczyna się od frazy (lub jest jej równy),
 * potem pozostałe - w obrębie grupy od najpopularniejszych (ranking z utils/gamePopularity.js).
 */
const { fetchIGDB } = require('./igdbService');
const { aliasesFor } = require('./gameAliases');
const { peekPopularRanks, peekPopularGames, peekVocabulary } = require('./gamePopularity');
const { normalize, alternateSpelling, spellingVariants, editDistance, typoAllowance } = require('./searchText');

const SEARCH_LIMIT = 80;
const PREFIX_LIMIT = 50;
const CONTAINS_LIMIT = 40;
const MIN_CONTAINS_LENGTH = 3;
const MAX_ABBREVIATION_LENGTH = 6;
const MAX_TYPO_MATCHES = 12;

const POOL_TTL_MS = 5 * 60 * 1000;
const POOL_MAX_ENTRIES = 200;
const pools = new Map(); // klucz zapytania -> { at, games }

/** Usuwa znaki, które mogłyby zepsuć zapytanie IGDB (Apicalypse). */
function cleanTerm(value) {
  return String(value || '')
    .replace(/["\\;*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function withAlternativeNames(fields) {
  return /alternative_names/.test(fields) ? fields : fields.replace(/;\s*$/, ', alternative_names.name;');
}

/**
 * Warunek "zaczyna się od frazy". Nazwy alternatywne (skróty) sprawdzamy tylko dla krótkich fraz
 * bez spacji ("cs", "cs2", "gta5", "botw") - to one wyglądają jak skrót, a przeszukiwanie nazw
 * alternatywnych jest w IGDB kilka razy wolniejsze niż samej nazwy.
 */
function prefixCondition(spellings, includeAlternatives, fullNames) {
  const fields = includeAlternatives ? ['name', 'alternative_names.name'] : ['name'];
  return [
    ...spellings.flatMap((term) => fields.map((field) => `${field} ~ "${term}"*`)),
    ...fullNames.map((name) => `name ~ "${name}"*`),
  ].join(' | ');
}

function looksLikeAbbreviation(term) {
  return !/\s/.test(term) && normalize(term).replace(/ /g, '').length <= MAX_ABBREVIATION_LENGTH;
}

/** Najmniejsza odległość (w literówkach) frazy od początku nazwy gry albo od któregoś jej słowa. */
function typoDistance(game, compactTerm, allowed) {
  const names = [game.name, ...(game.alternative_names || []).map((alt) => alt.name)];
  let best = allowed + 1;
  for (const name of names) {
    const text = normalize(name);
    const candidates = [text.replace(/ /g, '').slice(0, compactTerm.length), ...text.split(' ').filter((w) => w.length >= 4)];
    for (const candidate of candidates) {
      best = Math.min(best, editDistance(compactTerm, candidate, allowed));
      if (best === 0) return 0;
    }
  }
  return best;
}

/**
 * Jak dobrze gra pasuje do frazy (nazwa albo skrót):
 *   { tier: 0, exact: true }  - nazwa lub skrót dokładnie taki jak fraza ("cs" -> Counter-Strike, "wow"),
 *   { tier: 0, exact: false } - nazwa lub skrót zaczyna się od frazy ("cs" -> CS2, CS:GO),
 *   { tier: 1 }               - każde słowo frazy zaczyna jakieś słowo nazwy,
 *   { tier: 2 }               - reszta (trafienia samego IGDB, np. literówki).
 */
function matchQuality(game, needles) {
  const names = [game.name, ...(game.alternative_names || []).map((alt) => alt.name)];
  const best = { tier: 2, exact: false };

  for (const name of names) {
    const text = normalize(name);
    if (!text) continue;
    const compact = text.replace(/ /g, '');
    const words = text.split(' ');

    for (const needle of needles) {
      if (text === needle.text || compact === needle.compact) {
        return { tier: 0, exact: true };
      }
      if (text.startsWith(needle.text) || compact.startsWith(needle.compact)) {
        best.tier = 0;
      } else if (best.tier > 1 && needle.tokens.every((token) => words.some((word) => word.startsWith(token)))) {
        best.tier = 1;
      }
    }
  }
  return best;
}

function toNeedle(term) {
  const text = normalize(term);
  return { text, compact: text.replace(/ /g, ''), tokens: text.split(' ').filter(Boolean) };
}

// Dokładna nazwa / skrót dostaje bonus liczony w ocenach (dla gier spoza rankingu popularności),
// żeby mało znana gra o identycznej nazwie nie wyprzedzała znanej, ale przy równej popularności wygrywała.
const EXACT_MATCH_BONUS = 100;

/**
 * Kolejność wyników (grupy od najlepszej):
 *   0. pasujące gry z rankingu popularności (utils/gamePopularity.js) - wg jego kolejności,
 *      także gdy fraza jest tylko słowem w tytule ("souls" -> Dark Souls, "ring" -> Elden Ring),
 *   1. pozostałe gry, których nazwa lub skrót zaczyna się od frazy,
 *   2. pozostałe gry ze wszystkimi słowami frazy,
 *   3. reszta (trafienia samego IGDB, np. literówki).
 * Poza grupą 0 porządkuje liczba ocen w IGDB (dokładna nazwa / skrót dostaje bonus).
 */
function rank(games, terms) {
  const needles = terms.map(toNeedle).filter((needle) => needle.text);
  const popular = peekPopularRanks();

  return games
    .map((game, index) => {
      const { tier, exact } = matchQuality(game, needles);
      const position = popular && popular.has(game.id) ? popular.get(game.id) : null;
      const group = position !== null && tier <= 1 ? 0 : tier + 1;
      const score = (game.total_rating_count || 0) + (exact ? EXACT_MATCH_BONUS : 0);
      return { game, index, group, position, score };
    })
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      if (a.position !== null && b.position !== null) return a.position - b.position;
      if (a.position !== null || b.position !== null) return a.position !== null ? -1 : 1;
      return b.score - a.score || a.index - b.index;
    })
    .map((item) => item.game);
}

/**
 * Szuka gier po frazie.
 * @param {string} query fraza wpisana przez użytkownika
 * @param {object} options
 * @param {string} options.fields  pola IGDB ("fields name, ...;") - zawsze dodajemy nazwy alternatywne
 * @param {string[]} options.where warunki dodawane do każdego zapytania (typ gry, filtry...)
 * @param {Function} [options.accept] ten sam filtr dla gier z rankingu popularności (sprawdzanych w pamięci)
 * @returns {Promise<object[]>} gry (surowe wiersze IGDB) od najlepszego dopasowania
 */
async function smartSearch(query, { fields, where = [], accept = () => true } = {}) {
  const term = cleanTerm(query);
  if (!term) return [];

  const selected = withAlternativeNames(fields);
  const filter = where.join(' & ');
  const key = JSON.stringify([term, selected, filter]);
  const cached = pools.get(key);
  if (cached && Date.now() - cached.at < POOL_TTL_MS) return cached.games;

  // Warianty zapisu: "little big planet" -> "littlebigplanet", "spider man" -> "spider-man", "ff 7" -> "ff VII"...
  const spellings = spellingVariants(term, peekVocabulary());
  const fullNames = aliasesFor(term); // znane skróty ("mc" -> Minecraft, "botw" -> Breath of the Wild)
  const prefixes = prefixCondition(spellings, looksLikeAbbreviation(term), fullNames);
  const withFilter = (condition) => `where ${filter ? `(${condition}) & ${filter}` : condition};`;

  const [relevant, prefixed] = await Promise.all([
    fetchIGDB('games', `search "${term}"; ${selected} ${filter ? `where ${filter};` : ''} limit ${SEARCH_LIMIT};`),
    fetchIGDB('games', `${selected} ${withFilter(prefixes)} sort total_rating_count desc; limit ${PREFIX_LIMIT};`),
  ]);

  const merged = new Map();
  [...prefixed, ...relevant].forEach((game) => {
    if (!merged.has(game.id)) merged.set(game.id, game);
  });

  // Popularne gry pasujące do frazy dokładamy z pamięci - także te, których IGDB nie zwróciło w pierwszych
  // wynikach (np. "souls" -> Dark Souls, gdzie "Souls" jest tylko jednym ze słów tytułu).
  const popularGames = peekPopularGames();
  const needles = [...spellings, ...fullNames].map(toNeedle).filter((needle) => needle.text);
  if (popularGames) {
    popularGames.forEach((game) => {
      if (!merged.has(game.id) && accept(game) && matchQuality(game, needles).tier <= 1) merged.set(game.id, game);
    });
  }

  // Żadna gra nie pasuje do frazy: może to literówka ("skirym", "cyberpnk") - szukamy podobnych
  // tytułów wśród popularnych gier.
  const compactTerm = normalize(term).replace(/ /g, '');
  const allowed = typoAllowance(compactTerm.length);
  const anyMatch = [...merged.values()].some((game) => matchQuality(game, needles).tier <= 1);
  if (!anyMatch && popularGames && allowed > 0) {
    popularGames
      .filter((game) => accept(game))
      .map((game) => ({ game, distance: typoDistance(game, compactTerm, allowed) }))
      .filter((item) => item.distance <= allowed)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_TYPO_MATCHES)
      .forEach(({ game }) => {
        if (!merged.has(game.id)) merged.set(game.id, game);
      });
  }

  // Nic nie znaleziono: szukamy jeszcze fragmentu nazwy w środku ("raft" -> Minecraft, StarCraft).
  if (merged.size === 0 && normalize(term).length >= MIN_CONTAINS_LENGTH) {
    const inside = await fetchIGDB(
      'games',
      `${selected} ${withFilter(`name ~ *"${term}"*`)} sort total_rating_count desc; limit ${CONTAINS_LIMIT};`,
    );
    inside.forEach((game) => {
      if (!merged.has(game.id)) merged.set(game.id, game);
    });
  }

  const games = rank([...merged.values()], [...spellings, ...fullNames]);

  // Puste wyniki mogą oznaczać chwilowy błąd IGDB - ich nie zapamiętujemy.
  if (games.length > 0) {
    if (pools.size >= POOL_MAX_ENTRIES) pools.delete(pools.keys().next().value);
    pools.set(key, { at: Date.now(), games });
  }
  return games;
}

module.exports = { smartSearch, cleanTerm, normalize, alternateSpelling };
