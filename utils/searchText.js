/**
 * Ułatwienia wyszukiwania tytułów: normalizacja tekstu oraz warianty zapisu frazy, które ten sam
 * tytuł może mieć w bazie ("little big planet" <-> "LittleBigPlanet", "spider man" <-> "Spider-Man",
 * "final fantasy 7" <-> "Final Fantasy VII", "ratchet and clank" <-> "Ratchet & Clank")
 * oraz dopasowanie z literówkami.
 */

const ROMAN_TO_NUMBER = {
  ii: 2, iii: 3, iv: 4, vi: 6, vii: 7, viii: 8, ix: 9, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16,
};
const NUMBER_TO_ROMAN = Object.fromEntries(Object.entries(ROMAN_TO_NUMBER).map(([roman, n]) => [n, roman]));
// Bez "i", "v", "x" - pojedyncze litery to zwykle nie cyfry rzymskie.

const MAX_VARIANTS = 6;

/**
 * Małe litery, bez ogonków i znaków specjalnych ("Spider-Man" -> "spider man"). Cyfry rzymskie
 * zamieniamy na arabskie ("VII" -> "7"), a "and" pomijamy ("Ratchet & Clank" = "ratchet and clank").
 */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== 'and')
    .map((word) => (ROMAN_TO_NUMBER[word] ? String(ROMAN_TO_NUMBER[word]) : word))
    .join(' ');
}

/** Ta sama fraza z dopisaną lub usuniętą spacją przed końcową liczbą: "gta5" <-> "gta 5". */
function alternateSpelling(term) {
  const match = term.match(/^(.*[^\d\s])(\s*)(\d+)$/);
  if (!match) return null;
  return match[2] ? `${match[1]}${match[3]}` : `${match[1]} ${match[3]}`;
}

/** Pierwsza liczba 2-16 lub cyfra rzymska (nie na początku frazy) zamieniona na drugi zapis. */
function swapNumeral(term) {
  const words = term.split(' ');
  for (let i = 1; i < words.length; i += 1) {
    const lower = words[i].toLowerCase();
    if (NUMBER_TO_ROMAN[lower]) {
      words[i] = NUMBER_TO_ROMAN[lower].toUpperCase();
      return words.join(' ');
    }
    if (ROMAN_TO_NUMBER[lower]) {
      words[i] = String(ROMAN_TO_NUMBER[lower]);
      return words.join(' ');
    }
  }
  return null;
}

/** "ratchet and clank" <-> "ratchet & clank". */
function swapAmpersand(term) {
  if (/ and /i.test(term)) return term.replace(/ and /i, ' & ');
  if (/ & /.test(term)) return term.replace(/ & /, ' and ');
  return null;
}

// Słowa spotykane w tytułach gier - uzupełniają słownik zbudowany z rankingu popularnych gier.
const COMMON_WORDS = [
  'little', 'big', 'super', 'mega', 'star', 'stars', 'wars', 'war', 'planet', 'world', 'land', 'dark', 'light',
  'dragon', 'dragons', 'knight', 'fantasy', 'final', 'need', 'for', 'speed', 'grand', 'theft', 'auto', 'street',
  'fighter', 'counter', 'strike', 'half', 'life', 'red', 'dead', 'black', 'ops', 'call', 'duty', 'last', 'god',
  'age', 'empire', 'empires', 'tomb', 'raider', 'resident', 'evil', 'silent', 'hill', 'metal', 'gear', 'solid',
  'assassin', 'creed', 'mortal', 'kombat', 'tower', 'defense', 'farm', 'simulator', 'city', 'cities', 'skylines',
  'five', 'nights', 'left', 'team', 'fortress', 'rainbow', 'six', 'siege', 'far', 'cry', 'watch', 'dogs', 'dying',
  'death', 'stranding', 'crash', 'bandicoot', 'ratchet', 'clank', 'donkey', 'kong', 'mario', 'kart', 'party',
  'bros', 'smash', 'legend', 'zelda', 'animal', 'crossing', 'new', 'horizons', 'sword', 'shield', 'space',
  'craft', 'mine', 'sim', 'lego', 'batman', 'spider', 'man', 'iron', 'captain', 'america', 'hunter', 'monster',
  'need', 'road', 'rage', 'rush', 'blood', 'shadow', 'shadows', 'night', 'day', 'time', 'lost', 'hero', 'heroes',
  'ultimate', 'edition', 'remastered', 'remake', 'origins', 'legacy', 'reborn', 'rising', 'fall', 'falls',
];
const ALLOWED_SHORT = new Set(['of', 'in', 'on', 'to', 'at', 'my', 'no', 'us', 'is', 'by', 'me', 'we', 'or', 'oh']);

/** Zbiór słów z nazw gier (do dzielenia sklejonych fraz, np. "streetfighter" -> "street fighter"). */
function buildVocabulary(names) {
  const vocabulary = new Set(COMMON_WORDS);
  names.forEach((name) => {
    normalize(name)
      .split(' ')
      .forEach((word) => {
        if (/^[a-z]+$/.test(word) && (word.length >= 3 || ALLOWED_SHORT.has(word))) vocabulary.add(word);
      });
  });
  return vocabulary;
}

/**
 * Dzieli sklejone słowo na słowa ze słownika ("littlebigplanet" -> "little big planet"). Ostatni
 * fragment może być początkiem słowa (użytkownik wciąż pisze). Zwraca null, gdy się nie da.
 */
function segment(word, vocabulary) {
  const n = word.length;
  if (!vocabulary || n < 5 || n > 40 || !/^[a-z]+$/.test(word)) return null;

  const isWord = (piece) => vocabulary.has(piece);
  const isWordStart = (piece) => piece.length >= 3 && [...vocabulary].some((w) => w.startsWith(piece));

  const best = new Array(n + 1).fill(null);
  best[0] = [];
  for (let end = 1; end <= n; end += 1) {
    for (let start = Math.max(0, end - 16); start < end; start += 1) {
      if (!best[start]) continue;
      const piece = word.slice(start, end);
      const fits = isWord(piece) || (end === n && isWordStart(piece));
      if (!fits) continue;
      const candidate = [...best[start], piece];
      if (!best[end] || candidate.length < best[end].length) best[end] = candidate;
    }
  }
  return best[n] && best[n].length >= 2 && best[n].length <= 6 ? best[n].join(' ') : null;
}

/**
 * Warianty zapisu frazy do zapytań o początek nazwy (pierwszy element to sama fraza).
 * @param {string} term fraza wpisana przez użytkownika (już oczyszczona)
 * @param {Set<string>} [vocabulary] słownik do dzielenia sklejonych słów
 */
function spellingVariants(term, vocabulary) {
  const variants = new Set([term]);
  const add = (value) => {
    if (value) variants.add(value);
  };

  add(alternateSpelling(term));
  const tokens = term.split(' ').filter(Boolean);

  if (tokens.length >= 2 && tokens.length <= 5) {
    add(tokens.join('')); // little big planet -> littlebigplanet
    add([`${tokens[0]}-${tokens[1]}`, ...tokens.slice(2)].join(' ')); // spider man -> spider-man
  }

  // Sklejone słowa dzielimy na słowa: streetfighter -> street fighter, halflife 2 -> half life 2.
  [...variants].forEach((variant) => {
    const words = variant.split(' ');
    const split = words.map((word) => segment(word.toLowerCase(), vocabulary) || word).join(' ');
    if (split !== variant) add(split);
  });

  [...variants].forEach((variant) => {
    add(swapNumeral(variant)); // final fantasy 7 <-> final fantasy VII
    add(swapAmpersand(variant)); // ratchet and clank <-> ratchet & clank
  });

  return [...variants].slice(0, MAX_VARIANTS + 2);
}

/** Odległość edycyjna (z zamianą sąsiednich liter); przerywa liczenie po przekroczeniu `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i += 1) {
    rows.push(new Array(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/** Ile literówek tolerujemy we frazie o danej długości (krótkie frazy - wcale). */
function typoAllowance(length) {
  if (length < 5) return 0;
  return length === 5 ? 1 : 2;
}

module.exports = {
  normalize,
  alternateSpelling,
  spellingVariants,
  buildVocabulary,
  segment,
  editDistance,
  typoAllowance,
};
