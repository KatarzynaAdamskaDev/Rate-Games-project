/**
 * Zastępnik utils/igdbService.js na potrzeby testów (Jest "manual mock", włączany przez
 * jest.mock('../../utils/igdbService') w tests/setup/testApp.js).
 *
 * Prawdziwy moduł rozmawia z Twitch/IGDB przez sieć - w testach nie ma do tego kluczy
 * (tests/setup/testApp.js celowo je usuwa) ani dostępu do internetu. Ten zastępnik udaje
 * dokładnie to, co robi prawdziwa aplikacja bez skonfigurowanych kluczy IGDB: pusty katalog
 * gier z IGDB (`Bez kluczy IGDB formularz działa jak dotychczas` - patrz README). Gry dodane
 * ręcznie (custom_games) nie przechodzą przez ten moduł, więc testy oparte na nich (patrz
 * tests/setup/factories.js -> createCustomGame) działają normalnie.
 *
 * Stałe (bez operacji sieciowych) bierzemy z prawdziwego modułu, żeby nie się rozjechały.
 */
// Ten plik leży w utils/__mocks__/, więc prawdziwy moduł jest wyżej, w utils/.
const real = jest.requireActual('../igdbService');

module.exports = {
  GAME_TYPE_FILTER: real.GAME_TYPE_FILTER,
  IGDB_GAME_FIELDS: real.IGDB_GAME_FIELDS,
  PLATFORM_OPTIONS: real.PLATFORM_OPTIONS,
  PLATFORM_FILTERS: real.PLATFORM_FILTERS,
  formatIGDBGame: real.formatIGDBGame, // czysta funkcja formatująca - bez sieci
  fetchIGDB: async () => [],
  fetchIGDBGames: async () => [],
  getGenres: async () => [],
  getPopularGames: async () => [],
};
