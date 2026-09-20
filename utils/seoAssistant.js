/**
 * Asystent SEO dla edytora bloga: propozycje tagów z treści, analiza pod kątem SEO oraz automatyczne
 * formatowanie wpisu (pogrubienie słów kluczowych, linki do gier z katalogu, porządkowanie list i nagłówków,
 * dzielenie ścian tekstu, uzupełnianie tekstów alternatywnych zdjęć).
 *
 * Wszystko liczy się lokalnie, bez zewnętrznych usług. Polski jest fleksyjny, więc zamiast pełnego stemmera
 * używamy prostego obcinania końcówek do grupowania form tego samego słowa oraz - co ważniejsze dla bloga
 * o grach - rozpoznajemy nazwy własne (tytuły gier, platformy, gatunki) wraz ze skrótami ("The Binding of Isaac"
 * = TBOI), które najlepiej sprawdzają się jako tagi i słowa kluczowe.
 *
 * Pogrubienie nie "podbija" pozycji w wyszukiwarce samo z siebie, ale ułatwia skanowanie tekstu i wskazuje,
 * o czym jest wpis; dlatego pogrubiamy oszczędnie (pierwsze wystąpienie kilku najważniejszych fraz).
 */

/* ------------------------------ słowniki ------------------------------ */

const fold = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

const wordSet = (list) => new Set(list.split(/\s+/).filter(Boolean));

// Słowa funkcyjne (polskie i angielskie) - zapisane bez ogonków, porównujemy z fold().
const STOPWORDS = wordSet(`
  a aby ale am ani bardzo bez bo by byc byl byla bylo byly byli bedzie beda co czy czyli dla do gdy gdyby gdzie go i ich
  ile im inne inny inna innych jak jako jednak jego jej jest jestem jestes jestesmy jesli jezeli juz kazdy kazda kazde
  kiedy kto ktora ktore ktory ktorzy ktorych ktorym ktora ktorej lub ma maja mamy mial miala mialo mnie moj moja moje
  moze moga mozna mu my na nad nam nas nasz nasza nasze nawet nic nie niej niego nich o od on ona one oni ono oraz po pod
  ponad potem przed przez przy sa sam sama same sie sobie swoj swoja swoje tak takze taki taka takie tam te tego tej ten
  teraz to tu tez twoj tylko tym u w wiec wiecej wszystko wszystkie wszystkich wtedy wy z za ze zeby zas
  np tzn itd itp tzw wg ok oto oba obie dwa dwie trzy cztery jeden jedna jedno pierwszy pierwsza pierwsze kolejny kolejna
  kolejne ostatni ostatnia ostatnie dobry dobra dobre dobrze zly zla zle duzy duza duze maly mala male wielki wielka wielkie
  the of and in for to is are was were be been with on at by an as it its this that these those from or not you your we our
  they their he she his her have has had will would can could should may might do does did but if so than then there
`);

// Słowa zbyt ogólne w serwisie o grach, żeby były sensownym tagiem.
const GENERIC = wordSet(`
  gra gry gier grze gre gra graczy gracz gracze graczom graczami grac gral grali gramy grasz graj grajac gramy granie
  rok roku lata lat czas czasu wpis wpisu artykul tekst serwis temat rzecz rzeczy sposob przyklad czesc czesci
  tytul tytuly tytulow tytulem nowy nowa nowe nowych najlepszy najlepsza najlepsze wiele wielu duzo malo
  swiat swiata opinia opinie recenzja recenzje ocena oceny poziom poziomy mozliwosc mozliwosci wersja wersji
  element elementy rodzaj rodzaje kwestia kwestie miejsce miejsca chwila moment ludzie osoba osoby strona strony
  informacje informacja dzien dni tydzien miesiac godzina minuta minuty generalnie jednak niemniej
`);

// Platformy i gatunki: wyrażenie -> tag, który proponujemy.
const TOPICS = [
  { tag: 'PS5', kind: 'platforma', re: /(?<![\p{L}\p{N}])(?:PS5|PlayStation\s?5)(?![\p{L}\p{N}])/giu },
  { tag: 'PS4', kind: 'platforma', re: /(?<![\p{L}\p{N}])(?:PS4|PlayStation\s?4)(?![\p{L}\p{N}])/giu },
  { tag: 'Xbox', kind: 'platforma', re: /(?<![\p{L}\p{N}])Xbox(?![\p{L}\p{N}])/giu },
  { tag: 'Switch', kind: 'platforma', re: /(?<![\p{L}\p{N}])Nintendo\s+Switch(?:\s?2)?(?![\p{L}\p{N}])/giu },
  { tag: 'Nintendo', kind: 'platforma', re: /(?<![\p{L}\p{N}])Nintendo(?![\p{L}\p{N}])/gu },
  { tag: 'PC', kind: 'platforma', re: /(?<![\p{L}\p{N}])PC(?![\p{L}\p{N}])/gu },
  { tag: 'Steam', kind: 'platforma', re: /(?<![\p{L}\p{N}])Steam(?:a|em|owi|ie)?(?![\p{L}\p{N}])/gu },
  { tag: 'VR', kind: 'platforma', re: /(?<![\p{L}\p{N}])VR(?![\p{L}\p{N}])/gu },
  { tag: 'mobilne', kind: 'platforma', re: /(?<![\p{L}\p{N}])(?:Android|iOS|mobiln\p{L}+)(?![\p{L}\p{N}])/giu },
  { tag: 'RPG', kind: 'gatunek', re: /(?<![\p{L}\p{N}])(?:RPG|cRPG|JRPG)\p{L}{0,3}(?![\p{L}\p{N}])/gu },
  { tag: 'roguelike', kind: 'gatunek', re: /(?<![\p{L}\p{N}])rogue-?lik\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'roguelite', kind: 'gatunek', re: /(?<![\p{L}\p{N}])rogue-?lit\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'metroidvania', kind: 'gatunek', re: /(?<![\p{L}\p{N}])metroidvani\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'soulslike', kind: 'gatunek', re: /(?<![\p{L}\p{N}])souls-?lik\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'FPS', kind: 'gatunek', re: /(?<![\p{L}\p{N}])FPS\p{L}{0,3}(?![\p{L}\p{N}])/gu },
  { tag: 'MMO', kind: 'gatunek', re: /(?<![\p{L}\p{N}])MMO(?:RPG)?\p{L}{0,3}(?![\p{L}\p{N}])/gu },
  { tag: 'MOBA', kind: 'gatunek', re: /(?<![\p{L}\p{N}])MOBA\p{L}{0,3}(?![\p{L}\p{N}])/gu },
  { tag: 'battle royale', kind: 'gatunek', re: /(?<![\p{L}\p{N}])battle\s+royale(?![\p{L}\p{N}])/giu },
  { tag: 'strategia', kind: 'gatunek', re: /(?<![\p{L}\p{N}])strategi\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'symulator', kind: 'gatunek', re: /(?<![\p{L}\p{N}])symulator\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'horror', kind: 'gatunek', re: /(?<![\p{L}\p{N}])horror\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'platformówka', kind: 'gatunek', re: /(?<![\p{L}\p{N}])platform[oó]w\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'indie', kind: 'gatunek', re: /(?<![\p{L}\p{N}])indie(?![\p{L}\p{N}])/giu },
  { tag: 'sandbox', kind: 'gatunek', re: /(?<![\p{L}\p{N}])sandbox\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'survival', kind: 'gatunek', re: /(?<![\p{L}\p{N}])survival\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'wyścigi', kind: 'gatunek', re: /(?<![\p{L}\p{N}])wy[śs]cig\p{L}*(?![\p{L}\p{N}])/giu },
  { tag: 'DLC', kind: 'temat', re: /(?<![\p{L}\p{N}])DLC\p{L}{0,3}(?![\p{L}\p{N}])/gu },
  { tag: 'multiplayer', kind: 'temat', re: /(?<![\p{L}\p{N}])(?:multiplayer|wieloosobow\p{L}+|co-?op\p{L}*)(?![\p{L}\p{N}])/giu },
];

const CONNECTORS = new Set(['of', 'the', 'and', 'de', 'la', 'von', '&']);
const ROMAN = /^(?:II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)$/;

const TOKEN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|&/gu;

/* ------------------------------ tekst ------------------------------ */

const MEDIA_LINE = /^(?:!\[[^\]]*\]\([^)]*\)(?:\{[a-z]+\})?|@\[youtube\]\([^)]*\)|\[\[game:[^\]]*\]\]|(?:-{3,}|\*{3,}|_{3,}))$/;

/** Treść wpisu bez znaczników Markdown: zwykły tekst, nagłówki i pierwszy akapit. */
function toPlain(content) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const headings = [];
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !MEDIA_LINE.test(block));
  let firstParagraph = '';

  const plainBlocks = blocks.map((block) => {
    const clean = block
      .replace(/!\[[^\]]*\]\([^)]*\)(?:\{[a-z]+\})?/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^\s*>\s*\[![A-Z]+\]\s*/gm, '')
      .replace(/^\s*(?:#{1,6}|>|[-*]|\d+[.)])\s+/gm, '')
      .replace(/[*_`]+/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (/^##\s+/.test(block)) headings.push(clean);
    else if (!firstParagraph && !/^(?:[-*]|\d+[.)]|>)\s/.test(block)) firstParagraph = clean;
    return clean;
  });

  return { text: plainBlocks.join('\n\n'), headings, firstParagraph };
}

function stem(word) {
  const w = fold(word);
  if (w.length <= 4) return w;
  const suffixes = ['ami', 'ach', 'ego', 'emu', 'owi', 'ymi', 'imi', 'ich', 'ych', 'ow', 'om', 'ie', 'ej', 'ia', 'ii', 'ka', 'ke', 'ki', 'a', 'e', 'i', 'o', 'u', 'y'];
  for (const suffix of suffixes) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) return w.slice(0, -suffix.length);
  }
  return w;
}

const isCapitalized = (token) => /^\p{Lu}/u.test(token);
const isAcronym = (token) => /^\p{Lu}{2,5}\d?$/u.test(token);

/** Tokeny z informacją o położeniu i o tym, czy stoją na początku zdania. */
function tokenize(text) {
  const tokens = [];
  let match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(text)) !== null) {
    const before = text.slice(0, match.index).replace(/[ \t]+$/, '');
    const last = before.slice(-1);
    tokens.push({
      text: match[0],
      index: match.index,
      end: match.index + match[0].length,
      sentenceStart: before === '' || /[.!?…\n]/.test(last),
    });
  }
  return tokens;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BOUND_BEFORE = '(?<![\\p{L}\\p{N}])';
const BOUND_AFTER = '(?![\\p{L}\\p{N}])';

/** Wyrażenie znajdujące frazę jako całe słowa (z prostą końcówką fleksyjną: "Elden Ringu"). */
function phraseRegex(phrase, { ignoreCase = true, inflection = true } = {}) {
  const body = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
  const ending = inflection ? '\\p{Ll}{0,3}' : '';
  return new RegExp(`${BOUND_BEFORE}${body}${ending}${BOUND_AFTER}`, ignoreCase ? 'iu' : 'u');
}

/** Słowo z dłuższą końcówką ("isaac" -> "isaaczka"): na potrzeby dopasowania form i zdrobnień. */
function wordFormRegex(word) {
  return new RegExp(`${BOUND_BEFORE}${escapeRegExp(word)}\\p{L}{0,5}${BOUND_AFTER}`, 'iu');
}

function countMatches(text, regex) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return (text.match(new RegExp(regex.source, flags)) || []).length;
}

/** Skróty tytułów: "The Binding of Isaac" -> ["TBOI", "BOI"] (od trzech słów wzwyż). */
function acronymsOf(name) {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = (list) => list.map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase())).join('');
  const result = new Set();
  if (words.length >= 3) result.add(letters(words));
  const withoutArticle = words[0] && /^(?:the|a|an)$/i.test(words[0]) ? words.slice(1) : words;
  if (withoutArticle.length >= 3) result.add(letters(withoutArticle));
  return [...result].filter((value) => value.length >= 3 && value.length <= 6);
}

/** Nazwy własne złożone z wielkich liter: "Elden Ring", "Baldur's Gate 3", "Legend of Zelda". */
function properPhrases(tokens, text) {
  const found = new Map(); // klucz -> { text, count }
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const startsPhrase = isCapitalized(token.text) && !STOPWORDS.has(fold(token.text));
    if (!startsPhrase) {
      i += 1;
      continue;
    }

    let end = i;
    let lastCapital = i;
    for (let j = i + 1; j < tokens.length && j - i < 6; j += 1) {
      const next = tokens[j];
      const gap = next.index - tokens[j - 1].end;
      if (gap > 1 || (gap === 1 && text.charAt(tokens[j - 1].end) !== ' ')) break;
      const capital = isCapitalized(next.text) || /^\d+$/.test(next.text) || ROMAN.test(next.text);
      const connector = CONNECTORS.has(next.text.toLowerCase()) && j + 1 < tokens.length && isCapitalized(tokens[j + 1].text);
      if (capital) {
        lastCapital = j;
        end = j;
      } else if (connector) {
        end = j;
      } else break;
    }
    end = Math.max(lastCapital, i);

    const words = tokens.slice(i, end + 1);
    const phrase = words.map((w) => w.text).join(' ');
    const single = words.length === 1;
    const usable = single ? !token.sentenceStart || isAcronym(token.text) : true;
    // Pojedyncze słowo na początku zdania to zwykle zwykłe słowo pisane wielką literą - pomijamy.
    if (usable && (!single || fold(phrase).length >= 3)) {
      const key = fold(phrase);
      const entry = found.get(key) || { text: phrase, count: 0 };
      entry.count += 1;
      found.set(key, entry);
    }
    i = end + 1;
  }
  return found;
}

/** Nazwy gier z katalogu (baza i nazwy własne) znalezione w tekście. */
function knownGamesIn(text, games) {
  const found = [];
  const seen = new Set();
  const folded = fold(text);

  games.forEach((game) => {
    const variants = new Set([game.name]);
    const base = game.name.split(/\s*[:–—]\s+|\s+-\s+/)[0].trim();
    if (base.split(/\s+/).length >= 2 || base.length >= 6) variants.add(base);

    variants.forEach((variant) => {
      const key = fold(variant);
      if (key.length < 4 || seen.has(key) || GENERIC.has(key) || STOPWORDS.has(key)) return;
      const multiword = /\s/.test(variant);
      const aliases = multiword ? acronymsOf(variant) : [];
      const named = folded.includes(key);
      // Tytuł może występować w tekście tylko jako skrót ("TBOI") - sprawdzamy go osobno, z uwzględnieniem wielkości liter.
      const aliasHits = aliases.reduce((sum, alias) => sum + countMatches(text, phraseRegex(alias, { ignoreCase: false, inflection: false })), 0);
      if (!named && aliasHits === 0) return;

      // Jednowyrazowe tytuły ("Portal", "Control", "Rust") to często zwykłe słowa - dopasowujemy tylko wielką literą.
      const regex = phraseRegex(variant, { ignoreCase: multiword });
      const count = (named ? countMatches(text, regex) : 0) + aliasHits;
      if (count === 0) return;
      seen.add(key);
      found.push({ name: variant, id: game.id, count, multiword, regex, aliases: aliasHits ? aliases : [] });
    });
  });
  return found;
}

/**
 * Wyszukuje słowa kluczowe wpisu.
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.content
 * @param {Array<{ name: string, id: string|number }>} [input.games] gry z katalogu (do rozpoznawania tytułów)
 * @param {string[]} [input.existingTags] tagi już używane na blogu (zachowujemy ich pisownię)
 * @param {string[]} [input.tags] tagi wybrane przez autora dla tego wpisu (traktujemy je jako deklarowane słowa kluczowe)
 * @returns {Array<{ text, tag, score, count, kind, why, gameId?, aliases? }>} od najważniejszych
 */
function extractKeywords({ title = '', content = '', games = [], existingTags = [], tags = [] }) {
  const { text, headings } = toPlain(content);
  const fullText = `${title}\n\n${text}`;
  const tokens = tokenize(text);
  const foldedTitle = fold(title);
  const foldedHeadings = fold(headings.join(' '));
  const existing = new Map(existingTags.map((tag) => [fold(tag), tag]));

  const candidates = new Map(); // klucz -> kandydat
  const add = (key, item) => {
    const previous = candidates.get(key);
    if (!previous || item.score > previous.score) candidates.set(key, item);
  };
  const boost = (text_, base) => {
    const key = fold(text_);
    let score = base;
    const reasons = [];
    if (foldedTitle.includes(key)) { score += 4; reasons.push('w tytule'); }
    if (foldedHeadings.includes(key)) { score += 2; reasons.push('w śródtytule'); }
    if (existing.has(key)) { score += 2; reasons.push('tag używany na blogu'); }
    return { score, reasons };
  };

  // 1. Gry z katalogu.
  knownGamesIn(fullText, games).forEach((game) => {
    const { score, reasons } = boost(game.name, game.count * 3 + 6);
    add(fold(game.name), {
      text: game.name, tag: existing.get(fold(game.name)) || game.name, score, count: game.count, kind: 'gra',
      why: ['gra z katalogu', `${game.count}×`, ...reasons].join(', '), gameId: game.id, multiword: game.multiword,
      aliases: game.aliases,
    });
  });

  // 2. Platformy i gatunki.
  TOPICS.forEach((topic) => {
    const count = countMatches(fullText, topic.re);
    if (count === 0) return;
    const inTitle = countMatches(title, topic.re) > 0;
    if (count < 2 && !inTitle) return;
    const { score, reasons } = boost(topic.tag, count * 2.2 + 2);
    add(fold(topic.tag), {
      text: topic.tag, tag: existing.get(fold(topic.tag)) || topic.tag, score, count, kind: topic.kind,
      why: [topic.kind, `${count}×`, ...reasons].join(', '),
      regex: new RegExp(topic.re.source, topic.re.flags.replace('g', '')),
    });
  });

  // 3. Nazwy własne (spoza katalogu): "Elden Ring", "Bandai Namco", "FromSoftware".
  properPhrases(tokenize(fullText), fullText).forEach((entry, key) => {
    if (candidates.has(key) || GENERIC.has(key) || STOPWORDS.has(key)) return;
    const words = entry.text.split(' ').length;
    const inTitle = foldedTitle.includes(key);
    if (entry.count < 2 && !inTitle && words < 2) return;
    const { score, reasons } = boost(entry.text, entry.count * (words > 1 ? 2.6 : 1.8) + (words > 1 ? 2 : 0));
    add(key, {
      text: entry.text, tag: existing.get(key) || entry.text, score, count: entry.count, kind: 'nazwa',
      why: ['nazwa własna', `${entry.count}×`, ...reasons].join(', '), multiword: words > 1,
      aliases: words > 1 ? acronymsOf(entry.text) : [],
    });
  });

  // 4. Często powtarzane słowa i dwuwyrazowe frazy (tematy: "system walki", "otwarty świat").
  const stems = new Map();
  const grams = new Map();
  const words = tokens.filter((t) => /\p{L}/u.test(t.text));
  const usableWord = (t) => {
    const f = fold(t.text);
    return f.length >= 4 && !STOPWORDS.has(f) && !GENERIC.has(f) && !/^\d+$/.test(f);
  };
  words.forEach((token, index) => {
    if (usableWord(token) && fold(token.text).length >= 5) {
      const key = stem(token.text);
      const entry = stems.get(key) || { forms: new Map(), count: 0 };
      const surface = isCapitalized(token.text) && !token.sentenceStart ? token.text : token.text.toLowerCase();
      entry.forms.set(surface, (entry.forms.get(surface) || 0) + 1);
      entry.count += 1;
      stems.set(key, entry);
    }
    const next = words[index + 1];
    if (next && usableWord(token) && usableWord(next) && next.index - token.end <= 1) {
      const key = `${stem(token.text)} ${stem(next.text)}`;
      const entry = grams.get(key) || { forms: new Map(), count: 0 };
      const surface = `${token.text.toLowerCase()} ${next.text.toLowerCase()}`;
      entry.forms.set(surface, (entry.forms.get(surface) || 0) + 1);
      entry.count += 1;
      grams.set(key, entry);
    }
  });
  const bestForm = (entry) => [...entry.forms.entries()].sort((a, b) => b[1] - a[1])[0][0];

  grams.forEach((entry, key) => {
    const surface = bestForm(entry);
    const inTitle = foldedTitle.includes(fold(surface));
    const inHeading = foldedHeadings.includes(fold(surface));
    // Dwuwyrazowe frazy łatwo o przypadkowe ("wybierz klasę") - potrzebują trzech powtórzeń albo tytułu/śródtytułu.
    if (entry.count < 3 && !inTitle && !(inHeading && entry.count >= 2)) return;
    if (candidates.has(fold(surface))) return;
    const { score, reasons } = boost(surface, entry.count * 2.4);
    add(`g:${key}`, {
      text: surface, tag: existing.get(fold(surface)) || surface, score, count: entry.count, kind: 'temat',
      why: ['fraza', `${entry.count}×`, ...reasons].join(', '), multiword: true,
    });
  });
  stems.forEach((entry, key) => {
    const surface = bestForm(entry);
    const inTitle = foldedTitle.includes(fold(surface)) || foldedTitle.includes(key);
    if (entry.count < 3 && !(inTitle && entry.count >= 2)) return;
    if (candidates.has(fold(surface))) return;
    const { score, reasons } = boost(surface, entry.count * 1.1);
    add(`s:${key}`, {
      text: surface, tag: existing.get(fold(surface)) || surface, score, count: entry.count, kind: 'temat',
      why: ['słowo kluczowe', `${entry.count}×`, ...reasons].join(', '),
    });
  });

  // 5. Tagi wybrane przez autora to deklarowane słowa kluczowe - uwzględniamy je, nawet gdy występują w tekście
  // tylko raz albo w innej formie ("isaac" -> "isaaczka").
  tags.forEach((tag) => {
    const key = fold(tag);
    if (!key || candidates.has(key) || GENERIC.has(key) || STOPWORDS.has(key)) return;
    const single = !/\s/.test(tag.trim());
    const regex = single && key.length >= 4 ? wordFormRegex(tag.trim()) : phraseRegex(tag.trim());
    const count = countMatches(fullText, regex);
    const { score, reasons } = boost(tag, 6 + count * 2);
    add(`t:${key}`, {
      text: tag.trim(), tag: tag.trim(), score, count, kind: 'tag', declared: true, regex, multiword: !single,
      why: ['wybrany tag', `${count}×`, ...reasons].join(', '),
    });
  });

  // Wybór: bez powtórzeń i bez fraz zawartych w mocniejszych frazach.
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const chosen = [];
  ranked.forEach((item) => {
    const key = fold(item.text);
    const stemKey = stem(item.text);
    const redundant = chosen.some((other) => {
      const otherKey = fold(other.text);
      return otherKey.includes(key) || key.includes(otherKey) || (!item.multiword && !other.multiword && stem(other.text) === stemKey);
    });
    if (!redundant) chosen.push(item);
  });
  return chosen;
}

/* ------------------------------ propozycje tagów ------------------------------ */

const MAX_SUGGESTED = 8;
const MAX_TAG = 24;

/** Propozycje tagów z treści; `taken` to tagi już wybrane (nie proponujemy ich ponownie). */
function suggestTags({ keywords, taken = [], maxTagLength = MAX_TAG }) {
  const used = new Set(taken.map(fold));
  return keywords
    .filter((item) => !item.declared && item.tag.length <= maxTagLength && item.tag.length >= 2 && !used.has(fold(item.tag)))
    .slice(0, MAX_SUGGESTED)
    .map((item) => ({ tag: item.tag, kind: item.kind, why: item.why, score: Math.round(item.score * 10) / 10 }));
}

/* ------------------------------ analiza SEO ------------------------------ */

const wordsIn = (text) => (String(text).match(/[\p{L}\p{N}]+/gu) || []).length;

/** Podział na zdania (po kropce, wykrzykniku, pytajniku lub wielokropku przed wielką literą albo cyfrą). */
function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}"„(\d])/u)
    .filter(Boolean);
}

/**
 * Krótki opis (meta description) z początku tekstu: pełne zdania do `max` znaków; gdy pierwsze zdanie jest za długie,
 * ucinamy je na granicy słowa. Krótszy opis mniej "zjada" treści niż sztywne obcięcie do 160 znaków.
 */
function makeExcerpt(text, max = 140) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;

  let result = '';
  for (const sentence of splitSentences(clean)) {
    const next = result ? `${result} ${sentence}` : sentence;
    if (next.length > max) break;
    result = next;
  }
  if (result.length >= Math.min(60, max * 0.5)) return result;

  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!-]+$/, '')}…`;
}

function containsKeyword(text, keyword) {
  if (!keyword) return false;
  const folded = fold(text);
  const key = fold(keyword.text);
  if (folded.includes(key)) return true;
  if ((keyword.aliases || []).some((alias) => new RegExp(`${BOUND_BEFORE}${escapeRegExp(alias)}${BOUND_AFTER}`, 'u').test(String(text)))) return true;
  return folded.split(/\s+/).some((w) => key.length >= 5 && stem(w) === stem(key));
}

/** Zdjęcia w treści i ile z nich nie ma tekstu alternatywnego. */
function imageStats(content) {
  const images = [...String(content || '').matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)].map((m) => ({ alt: m[1].trim(), src: m[2] }));
  return { total: images.length, missingAlt: images.filter((image) => image.alt.length < 3).length };
}

/**
 * Ocena wpisu pod kątem SEO: lista kontrolna z podpowiedziami i wynik 0-100.
 * @returns {{ score: number, checks: Array<{ id, ok, label, hint }>, wordCount: number, primary: string|null }}
 */
function analyze({ title = '', excerpt = '', content = '', tags = [], hasCover = false, keywords = [] }) {
  const plain = toPlain(content);
  const wordCount = wordsIn(plain.text);
  const primary = keywords[0] || null;
  const headingCount = (String(content).match(/^##\s+\S/gm) || []).length;
  const hasLink = /(?<!!)\[[^\]]*\]\((?:https?:\/\/|\/)[^)]+\)/.test(content);
  const sentences = splitSentences(plain.text);
  const avgSentence = sentences.length ? wordCount / sentences.length : 0;
  const firstWords = plain.firstParagraph.split(/\s+/).slice(0, 100).join(' ');
  const titleLength = title.trim().length;
  const images = imageStats(content);
  // Pusty opis serwer uzupełni początkiem treści przy zapisie - oceniamy więc ten automatyczny opis.
  const autoExcerpt = !excerpt.trim();
  const effectiveExcerpt = autoExcerpt ? makeExcerpt(plain.text, 140) : excerpt.trim();
  const excerptLength = effectiveExcerpt.length;

  const checks = [
    {
      id: 'title-length', weight: 11, ok: titleLength >= 30 && titleLength <= 65,
      label: `Długość tytułu: ${titleLength} znaków`,
      hint: titleLength < 30 ? 'Za krótki - rozwiń tytuł do 30-65 znaków, żeby lepiej opisywał wpis.' : 'Za długi - wyszukiwarki utną tytuł po ok. 65 znakach.',
    },
    {
      id: 'title-keyword', weight: 13, ok: !!primary && containsKeyword(title, primary),
      label: 'Słowo kluczowe w tytule',
      hint: primary ? `Wpisz w tytule główne słowo kluczowe: „${primary.text}”.` : 'Napisz więcej treści, a wskażemy główne słowo kluczowe.',
    },
    {
      id: 'excerpt-length', weight: 9, ok: excerptLength >= 70 && excerptLength <= 160,
      label: `Krótki opis: ${excerptLength} znaków${autoExcerpt ? ' (z treści)' : ''}`,
      hint: excerptLength < 70 ? 'Rozwiń opis do 70-160 znaków - tyle wyświetla wyszukiwarka i podgląd linku.' : 'Skróć opis do 160 znaków, bo dalsza część zostanie ucięta.',
    },
    {
      id: 'excerpt-keyword', weight: 7, ok: !!primary && containsKeyword(effectiveExcerpt, primary),
      label: 'Słowo kluczowe w opisie',
      hint: primary ? `Użyj w opisie frazy „${primary.text}”.` : 'Dodaj do opisu główne słowo kluczowe.',
    },
    {
      id: 'length', weight: 11, ok: wordCount >= 300,
      label: `Długość tekstu: ${wordCount} słów`,
      hint: 'Dłuższe, rzeczowe wpisy (300+ słów) częściej trafiają do wyników; rozwiń temat.',
    },
    {
      id: 'intro-keyword', weight: 9, ok: !!primary && containsKeyword(firstWords, primary),
      label: 'Słowo kluczowe w pierwszym akapicie',
      hint: primary ? `Wspomnij „${primary.text}” w pierwszych zdaniach.` : 'Wspomnij główny temat w pierwszym akapicie.',
    },
    {
      id: 'headings', weight: 9, ok: wordCount < 250 || headingCount >= 2,
      label: `Śródtytuły: ${headingCount}`,
      hint: 'Podziel tekst śródtytułami (## Tytuł) co 150-250 słów - łatwiej się czyta i skanuje.',
    },
    {
      id: 'links', weight: 7, ok: hasLink,
      label: 'Linki w treści',
      hint: 'Dodaj linki do gier z katalogu albo do źródeł - przycisk „Formatuj pod SEO” zrobi to za Ciebie.',
    },
    {
      id: 'images', weight: 5, ok: images.total > 0,
      label: images.total ? `Zdjęcia w treści: ${images.total}` : 'Zdjęcia w treści',
      hint: 'Dodaj zdjęcie, zrzut ekranu lub infografikę (przycisk zdjęcia w pasku) - ilustracje zatrzymują czytelnika i trafiają do wyszukiwarki grafiki.',
    },
    {
      id: 'alt', weight: 6, ok: images.total === 0 || images.missingAlt === 0,
      label: images.missingAlt ? `Zdjęcia bez tekstu alternatywnego: ${images.missingAlt}` : 'Teksty alternatywne zdjęć',
      hint: 'Opisz każde zdjęcie (tekst alternatywny) - czytają go wyszukiwarki i osoby niewidzące. „Formatuj pod SEO” uzupełni braki.',
    },
    {
      id: 'tags', weight: 6, ok: tags.length >= 3 && tags.length <= 8,
      label: `Tagi: ${tags.length}`,
      hint: 'Dodaj 3-8 tagów - skorzystaj z podpowiedzi obok pola tagów.',
    },
    {
      id: 'readability', weight: 5, ok: avgSentence === 0 || avgSentence <= 22,
      label: avgSentence ? `Średnia długość zdania: ${Math.round(avgSentence)} słów` : 'Czytelność zdań',
      hint: 'Zdania są długie - krótsze (do ok. 20 słów) czyta się łatwiej.',
    },
    {
      id: 'cover', weight: 2, ok: !!hasCover,
      label: 'Okładka', hint: 'Dodaj okładkę - włącz automatyczną albo wgraj własną.',
    },
  ];

  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.ok ? check.weight : 0), 0);
  return {
    score: Math.round((earned / total) * 100),
    checks: checks.map(({ id, ok, label, hint }) => ({ id, ok, label, hint })),
    wordCount,
    primary: primary ? primary.text : null,
  };
}

/* ------------------------------ automatyczne formatowanie ------------------------------ */

const BULLET = /^[ \t]*[•·▪●‣◦–—][ \t]+/;
const NUMBERED = /^[ \t]*(\d+)\)[ \t]+/;
const LIST_LINE = /^(?:[-*][ \t]+|\d+\.[ \t]+)/;

const MAX_BOLD = 5;
const MAX_LINKS = 5;
const LONG_PARAGRAPH_WORDS = 110;
const SPLIT_TARGET_WORDS = 60;

// Znacznik miejsca (znak z prywatnego zakresu Unicode) - nie występuje w tekstach.
const SLOT = String.fromCharCode(0xe000);
const SLOT_PATTERN = new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g');

const blockKind = (block) => {
  if (/^##\s+/.test(block)) return 'heading';
  if (block.split('\n').length === 1 && MEDIA_LINE.test(block.trim())) return 'media';
  const lines = block.split('\n');
  if (lines.every((line) => LIST_LINE.test(line))) return 'list';
  if (lines.every((line) => /^>\s?/.test(line))) return 'quote';
  return 'paragraph';
};

/** Ukrywa fragmenty, których nie wolno zmieniać (linki, pogrubienia, kursywa, adresy), na czas podmiany. */
function mask(text) {
  const saved = [];
  const masked = text.replace(/\[[^\]]*\]\([^)]*\)|\*\*[^*\n]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*)|https?:\/\/\S+/g, (part) => {
    saved.push(part);
    return `${SLOT}${saved.length - 1}${SLOT}`;
  });
  return { masked, restore: (value) => value.replace(SLOT_PATTERN, (_, i) => saved[Number(i)]) };
}

/** Czy sama linia wygląda jak śródtytuł: krótka, od wielkiej litery, bez kropki na końcu ("Zalety i wady", "Gdzie kupić?"). */
function isHeadingLine(line) {
  const text = line.trim();
  const words = text.split(/\s+/).length;
  if (words > 9 || text.length > 70 || !/^[\p{Lu}\d]/u.test(text)) return false;
  if (/[.!,;…]$/.test(text) || /[*#>\[\]`|]/.test(text) || MEDIA_LINE.test(text)) return false;
  if (/^[-*]/.test(text) || (/^\d/.test(text) && !/^\d+\s+\p{L}/u.test(text))) return false;
  return true;
}

/** Nagłówek z samotnej linii: "Zalety i wady" -> "## Zalety i wady". */
function looksLikeHeading(block, next) {
  if (block.includes('\n') || !next) return false;
  return isHeadingLine(block) && !['heading', 'media'].includes(blockKind(next)) && wordsIn(next) >= 8;
}

/** Długi akapit -> kilka krótszych (podział na granicach zdań, ok. 60 słów w akapicie). */
function splitLongParagraph(block) {
  const flat = block.replace(/\s*\n\s*/g, ' ').trim();
  if (wordsIn(flat) < LONG_PARAGRAPH_WORDS) return [block];
  const parts = [];
  let current = [];
  let count = 0;
  splitSentences(flat).forEach((sentence) => {
    current.push(sentence);
    count += wordsIn(sentence);
    if (count >= SPLIT_TARGET_WORDS) {
      parts.push(current.join(' '));
      current = [];
      count = 0;
    }
  });
  if (current.length) {
    if (parts.length && count < 20) parts[parts.length - 1] += ` ${current.join(' ')}`;
    else parts.push(current.join(' '));
  }
  return parts.length > 1 ? parts : [block];
}

/** Słowa wyróżniające nazwę (bez słów funkcyjnych), od ostatniego - np. "Isaac" z "The Binding of Isaac". */
function distinctiveWords(name) {
  return name
    .split(/\s+/)
    .filter((word) => word.length >= 5 && !STOPWORDS.has(fold(word)) && !GENERIC.has(fold(word)))
    .reverse();
}

/**
 * Formatuje wpis pod SEO i zwraca nową treść wraz z listą zmian i uwag do ręcznej poprawy. Niczego nie wymyśla:
 * porządkuje zapis, wyróżnia najważniejsze frazy i linkuje gry z katalogu.
 */
function autoFormat({ title = '', content = '', games = [], existingTags = [], tags = [] }) {
  const changes = [];
  const original = String(content).replace(/\r\n/g, '\n');
  let text = original.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (text !== original.trim()) changes.push({ id: 'spacing', label: 'Uporządkowano odstępy i puste linie' });

  // 1. Punktory i numeracja w zapisie z edytorów tekstu.
  let bullets = 0;
  text = text
    .split('\n')
    .map((line) => {
      if (BULLET.test(line)) { bullets += 1; return line.replace(BULLET, '- '); }
      if (NUMBERED.test(line)) { bullets += 1; return line.replace(NUMBERED, '$1. '); }
      return line;
    })
    .join('\n');
  if (bullets) changes.push({ id: 'lists', label: `Zamieniono punktory na listy Markdown (${bullets})` });

  // 2. Listy oddzielone od akapitów pustą linią (tego wymaga renderer wpisu).
  const rawLines = text.split('\n');
  const spaced = [];
  rawLines.forEach((line, index) => {
    const prev = rawLines[index - 1];
    const isList = LIST_LINE.test(line);
    const prevList = prev !== undefined && LIST_LINE.test(prev);
    if (prev !== undefined && prev.trim() !== '' && line.trim() !== '' && isList !== prevList && (isList || prevList)) spaced.push('');
    spaced.push(line);
  });
  text = spaced.join('\n');

  let blocks = text.split(/\n{2,}/);

  // Nagłówek wklejony tuż nad akapitem (bez pustej linii): "Budowa postaci\nNa początku..." -> dwa bloki.
  blocks = blocks.flatMap((block) => {
    const rows = block.split('\n');
    if (rows.length > 1 && blockKind(block) === 'paragraph' && isHeadingLine(rows[0]) && wordsIn(rows[1]) >= 6) {
      return [rows[0], rows.slice(1).join('\n')];
    }
    return [block];
  });

  // 3. Śródtytuły z pojedynczych linii.
  const paragraphCount = blocks.filter((block) => blockKind(block) === 'paragraph').length;
  if (paragraphCount >= 3) {
    let headings = 0;
    const candidates = blocks.map((block, index) => index > 0 && looksLikeHeading(block, blocks[index + 1]));
    if (candidates.filter(Boolean).length <= Math.ceil(blocks.length * 0.4)) {
      blocks = blocks.map((block, index) => {
        if (!candidates[index]) return block;
        headings += 1;
        return `## ${block.trim().replace(/:$/, '')}`;
      });
      if (headings) changes.push({ id: 'headings', label: `Zamieniono krótkie linie na śródtytuły ## (${headings})` });
    }
  }

  // 4. Ściany tekstu -> krótsze akapity.
  let splitCount = 0;
  blocks = blocks.flatMap((block) => {
    if (blockKind(block) !== 'paragraph') return [block];
    const parts = splitLongParagraph(block);
    if (parts.length > 1) splitCount += 1;
    return parts;
  });
  if (splitCount) changes.push({ id: 'paragraphs', label: `Podzielono długie akapity na krótsze (${splitCount})` });

  // 5. Gołe adresy URL -> linki z nazwą serwisu.
  let urls = 0;
  blocks = blocks.map((block) => {
    if (['heading', 'media'].includes(blockKind(block))) return block;
    const saved = [];
    const masked = block.replace(/\[[^\]]*\]\([^)]*\)/g, (part) => { saved.push(part); return `${SLOT}${saved.length - 1}${SLOT}`; });
    const replaced = masked.replace(/(?<![("'<])https?:\/\/[^\s<>()\]]+/g, (url) => {
      const trailing = (url.match(/[.,;:!?]+$/) || [''])[0];
      const clean = trailing ? url.slice(0, -trailing.length) : url;
      let host;
      try { host = new URL(clean).hostname.replace(/^www\./, ''); } catch (err) { return url; }
      urls += 1;
      return `[${host}](${clean})${trailing}`;
    });
    return replaced.replace(SLOT_PATTERN, (_, i) => saved[Number(i)]);
  });
  if (urls) changes.push({ id: 'urls', label: `Zamieniono adresy URL na linki z nazwą serwisu (${urls})` });

  // 6. Teksty alternatywne zdjęć: brakujące uzupełniamy podpisem albo tytułem wpisu.
  let alts = 0;
  const altBase = title.trim() || 'wpis na blogu GameVerse';
  blocks = blocks.map((block) => {
    if (!/!\[\s*\]\(/.test(block)) return block;
    return block.replace(/!\[\s*\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (whole, src, caption) => {
      alts += 1;
      const label = (caption && caption.trim()) || `Ilustracja do wpisu: ${altBase}`;
      return whole.replace('![]', `![${label.replace(/[\[\]]/g, '').slice(0, 120)}]`);
    });
  });
  if (alts) changes.push({ id: 'alt', label: `Uzupełniono teksty alternatywne zdjęć (${alts})` });

  // 7. Słowa kluczowe: linki do gier z katalogu i pogrubienie pierwszego wystąpienia.
  const joined = () => blocks.join('\n\n');
  const keywords = extractKeywords({ title, content: joined(), games, existingTags, tags });
  const eligible = (block) => ['paragraph', 'list'].includes(blockKind(block));
  const linked = [];
  const bolded = [];
  const boldSegments = () => [...joined().matchAll(/\*\*([^*\n]+)\*\*/g)].map((m) => fold(m[1]));
  const alreadyBold = (item) => boldSegments().some((segment) => segment.includes(fold(item.text)) || (item.aliases || []).some((a) => segment.includes(fold(a))));
  const alreadyLinked = (id) => joined().includes(`](/games/${id})`);

  /** Miejsca do wyróżnienia: pełna fraza, skrót, a na końcu (tylko do pogrubień) charakterystyczne słowo. */
  const patternsFor = (item, { allowWordFallback }) => {
    const list = [];
    list.push(item.regex || phraseRegex(item.text, { ignoreCase: item.kind !== 'gra' || item.multiword !== false }));
    (item.aliases || []).forEach((alias) => list.push(phraseRegex(alias, { ignoreCase: false, inflection: false })));
    if (allowWordFallback && ['gra', 'nazwa', 'tag'].includes(item.kind)) {
      distinctiveWords(item.text).forEach((word) => list.push(wordFormRegex(word)));
    }
    return list;
  };

  const apply = (item, wrap, options) => {
    for (const regex of patternsFor(item, options)) {
      for (let i = 0; i < blocks.length; i += 1) {
        if (!eligible(blocks[i])) continue;
        const { masked, restore } = mask(blocks[i]);
        const match = regex.exec(masked);
        if (!match) continue;
        blocks[i] = restore(masked.slice(0, match.index) + wrap(match[0]) + masked.slice(match.index + match[0].length));
        return true;
      }
    }
    return false;
  };

  keywords
    .filter((item) => item.kind === 'gra' && item.gameId !== undefined)
    .slice(0, MAX_LINKS)
    .forEach((item) => {
      if (alreadyLinked(item.gameId)) return;
      if (apply(item, (found) => `[**${found}**](/games/${item.gameId})`, { allowWordFallback: false })) linked.push(item.text);
    });

  // Pogrubiamy najważniejsze frazy; deklarowane tagi i nazwy własne nawet przy jednym wystąpieniu.
  const boldable = keywords.filter(
    (item) =>
      !linked.includes(item.text) &&
      !(item.gameId !== undefined && alreadyLinked(item.gameId)) &&
      ['nazwa', 'gra', 'gatunek', 'platforma', 'temat', 'tag'].includes(item.kind) &&
      item.text.length >= 3,
  );
  boldable.slice(0, MAX_BOLD + 4).forEach((item) => {
    if (bolded.length >= MAX_BOLD || alreadyBold(item)) return;
    if (apply(item, (found) => `**${found}**`, { allowWordFallback: true })) bolded.push(item.text);
  });

  if (linked.length) changes.push({ id: 'links', label: `Dodano linki do gier z katalogu: ${linked.join(', ')}` });
  if (bolded.length) changes.push({ id: 'bold', label: `Pogrubiono słowa kluczowe: ${bolded.join(', ')}` });

  // Uwagi, których nie da się poprawić automatycznie (bez zmyślania treści).
  const notes = [];
  const result = blocks.join('\n\n');
  const plain = toPlain(result);
  const wordCount = wordsIn(plain.text);
  const focus = keywords[0];
  if (focus && !containsKeyword(plain.text, focus) && bolded.length === 0 && linked.length === 0) {
    notes.push(`Główne słowo kluczowe „${focus.text}” nie występuje w treści - użyj go w pierwszym akapicie, a wtedy zostanie wyróżnione.`);
  } else if (focus && !containsKeyword(plain.firstParagraph, focus)) {
    notes.push(`Wspomnij „${focus.text}” w pierwszym akapicie - wyszukiwarki i czytelnicy szybciej zrozumieją temat.`);
  }
  if (wordCount < 300) notes.push(`Tekst ma ${wordCount} słów - wpisy od 300 słów częściej trafiają do wyników wyszukiwania.`);
  if (wordCount >= 250 && (result.match(/^##\s+\S/gm) || []).length < 2) notes.push('Dodaj śródtytuły (## Tytuł) co 150-250 słów.');
  if (imageStats(result).total === 0) notes.push('Dodaj zdjęcie, zrzut ekranu lub infografikę - przycisk zdjęcia w pasku narzędzi.');

  return {
    content: result,
    changed: result !== original.trim() && changes.length > 0,
    changes,
    notes,
    keywords: keywords.slice(0, 6).map((k) => k.text),
  };
}

module.exports = { extractKeywords, suggestTags, analyze, autoFormat, toPlain, fold, makeExcerpt, imageStats };
