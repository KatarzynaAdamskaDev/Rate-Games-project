/**
 * Ułatwienia wyszukiwarki (utils/searchText.js, utils/gameAliases.js) - same funkcje tekstowe,
 * bez bazy danych i bez IGDB. To one stoją za zachowaniami opisanymi w README: "cs2" -> Counter-Strike 2,
 * "little big planet" = LittleBigPlanet, "spider man" = Spider-Man, "final fantasy 7" = Final Fantasy VII,
 * literówki w rodzaju "skirym".
 */
const { normalize, alternateSpelling, spellingVariants, buildVocabulary, segment, editDistance, typoAllowance } = require('../../utils/searchText');
const { aliasesFor, aliasKey } = require('../../utils/gameAliases');

describe('normalize', () => {
  test('sprowadza do małych liter i usuwa myślniki/znaki specjalne', () => {
    expect(normalize('Spider-Man')).toBe('spider man');
  });

  test('usuwa polskie "ł" i inne ogonki', () => {
    expect(normalize('Łowcy Głów')).toBe('lowcy glow');
  });

  test('zamienia cyfry rzymskie (2-16) na arabskie', () => {
    expect(normalize('Final Fantasy VII')).toBe('final fantasy 7');
    expect(normalize('Diablo IV')).toBe('diablo 4');
  });

  test('pomija słowo "and"', () => {
    expect(normalize('Ratchet and Clank')).toBe('ratchet clank');
  });

  test('pusty i niepoprawny wejściowy tekst nie wywraca funkcji', () => {
    expect(normalize('')).toBe('');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('alternateSpelling', () => {
  test('dopisuje/usuwa spację przed końcową liczbą ("gta5" <-> "gta 5")', () => {
    expect(alternateSpelling('gta5')).toBe('gta 5');
    expect(alternateSpelling('gta 5')).toBe('gta5');
  });

  test('zwraca null, gdy fraza nie kończy się liczbą', () => {
    expect(alternateSpelling('minecraft')).toBeNull();
  });
});

describe('spellingVariants', () => {
  const vocabulary = buildVocabulary(['LittleBigPlanet', 'Spider-Man', 'Half-Life']);

  test('zawiera oryginalną frazę', () => {
    expect(spellingVariants('elden ring', vocabulary)).toContain('elden ring');
  });

  test('"little big planet" ma wariant sklejony "littlebigplanet"', () => {
    expect(spellingVariants('little big planet', vocabulary)).toContain('littlebigplanet');
  });

  test('"spider man" ma wariant z łącznikiem "spider-man"', () => {
    expect(spellingVariants('spider man', vocabulary)).toContain('spider-man');
  });

  test('"final fantasy 7" ma wariant z cyfrą rzymską "final fantasy VII"', () => {
    expect(spellingVariants('final fantasy 7', vocabulary)).toContain('final fantasy VII');
  });

  test('"ratchet and clank" ma wariant z ampersandem', () => {
    expect(spellingVariants('ratchet and clank', vocabulary)).toContain('ratchet & clank');
  });

  test('nie zwraca więcej niż kilkanaście wariantów (bez eksplozji kombinacji)', () => {
    expect(spellingVariants('final fantasy 7', vocabulary).length).toBeLessThanOrEqual(8);
  });
});

describe('segment (dzielenie sklejonych słów)', () => {
  // Słownik budujemy z tytułów tak, jak faktycznie wyglądają w IGDB (spacje/myślniki między słowami) -
  // normalize() rozdziela je po tych znakach, ale nie zgaduje granic w czystym sklejeniu wielkimi literami.
  const vocabulary = buildVocabulary(['Little Big Planet', 'Street Fighter', 'Half-Life']);

  test('dzieli "littlebigplanet" na trzy słowa ze słownika', () => {
    expect(segment('littlebigplanet', vocabulary)).toBe('little big planet');
  });

  test('dzieli "streetfighter" na dwa słowa', () => {
    expect(segment('streetfighter', vocabulary)).toBe('street fighter');
  });

  test('zwraca null, gdy słowa nie da się sensownie podzielić', () => {
    expect(segment('xyzxyzxyzxyz', vocabulary)).toBeNull();
  });

  test('zwraca null dla zbyt krótkiego słowa albo pustego słownika', () => {
    expect(segment('abcd', vocabulary)).toBeNull();
    expect(segment('littlebigplanet', null)).toBeNull();
  });
});

describe('editDistance i typoAllowance (literówki, np. "skirym" -> "skyrim")', () => {
  test('zamienione sąsiednie litery liczą się jako jedna zmiana', () => {
    expect(editDistance('eldne', 'elden', 2)).toBe(1);
  });

  test('identyczne słowa mają odległość 0', () => {
    expect(editDistance('elden', 'elden', 2)).toBe(0);
  });

  test('zbyt duża różnica długości przerywa liczenie i zwraca max + 1', () => {
    expect(editDistance('a', 'abcdefgh', 2)).toBe(3);
  });

  test('"skirym" mieści się w tolerancji literówek dla "skyrim" (uznane za tę samą grę)', () => {
    const distance = editDistance('skirym', 'skyrim', 2);
    expect(distance).toBeLessThanOrEqual(typoAllowance('skyrim'.length));
  });

  test('krótkie frazy (<5 znaków) nie tolerują żadnej literówki', () => {
    expect(typoAllowance(3)).toBe(0);
    expect(typoAllowance(4)).toBe(0);
  });

  test('dłuższe frazy tolerują 1-2 literówki', () => {
    expect(typoAllowance(5)).toBe(1);
    expect(typoAllowance(10)).toBe(2);
  });
});

describe('skróty gier (utils/gameAliases.js)', () => {
  test('"cs2" wskazuje na Counter-Strike 2', () => {
    expect(aliasesFor('cs2')).toEqual(['Counter-Strike 2']);
  });

  test('aliasKey ignoruje wielkość liter i znaki specjalne ("CS:GO" = "csgo")', () => {
    expect(aliasKey('CS:GO')).toBe(aliasKey('cs go'));
    expect(aliasesFor('CS:GO')).toEqual(aliasesFor('cs go'));
  });

  test('nieznany skrót zwraca pustą listę (nie null/undefined)', () => {
    expect(aliasesFor('cokolwiek-nieznanego-xyz')).toEqual([]);
  });
});
