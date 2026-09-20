/**
 * Asystent SEO dla edytora bloga: propozycje tagów z treści, analiza pod kątem SEO oraz automatyczne
 * formatowanie wpisu (pogrubienie słów kluczowych, linki do gier z katalogu, porządkowanie list i nagłówków).
 *
 * Wszystko liczy się lokalnie, bez zewnętrznych usług. Polski jest fleksyjny, więc zamiast pełnego stemmera
 * używamy prostego obcinania końcówek do grupowania form tego samego słowa oraz - co ważniejsze dla bloga
 * o grach - rozpoznajemy nazwy własne (tytuły gier, platformy, gatunki), które najlepiej sprawdzają się
 * jako tagi i słowa kluczowe.
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
  gra gry gier grze gre gra graczy gracz gracze graczom graczami grac gral grali gramy grasz graj grajac gramy
  rok roku lata lat czas czasu wpis wpisu artykul tekst serwis temat rzecz rzeczy sposob przyklad czesc czesci
  tytul tytuly tytulow tytulem nowy nowa nowe nowych najlepszy najlepsza najlepsze wiele wielu duzo malo
  swiat swiata opinia opinie recenzja recenzje ocena oceny poziom poziomy mozliwosc mozliwosci wersja wersji
  element elementy rodzaj rodzaje kwestia kwestie miejsce miejsca chwila moment ludzie osoba osoby strona strony
  informacje informacja dzien dni tydzien miesiac godzina minuta minuty
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

/** Treść wpisu bez znaczników Markdown: zwykły tekst, nagłówki i pierwszy akapit. */
function toPlain(content) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const headings = [];
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  let firstParagraph = '';

  const plainBlocks = blocks.map((block) => {
    const clean = block
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
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

/* ------------------------------ słowa kluczowe ------------------------------ */

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wyrażenie znajdujące frazę jako całe słowa (z prostą końcówką fleksyjną: "Elden Ringu"). */
function phraseRegex(phrase, { ignoreCase = true, inflection = true } = {}) {
  const body = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
  const ending = inflection ? '\\p{Ll}{0,3}' : '';
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${ending}(?![\\p{L}\\p{N}])`, ignoreCase ? 'iu' : 'u');
}

function countMatches(text, regex) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return (text.match(new RegExp(regex.source, flags)) || []).length;
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
      if (!folded.includes(key)) return;
      const multiword = /\s/.test(variant);
      // Jednowyrazowe tytuły ("Portal", "Control", "Rust") to często zwykłe słowa - dopasowujemy tylko wielką literą.
      const regex = phraseRegex(variant, { ignoreCase: multiword });
      const count = countMatches(text, regex);
      if (count === 0) return;
      seen.add(key);
      found.push({ name: variant, id: game.id, count, multiword, regex });
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
 * @returns {Array<{ text, tag, score, count, kind, why, gameId? }>} od najważniejszych
 */
function extractKeywords({ title = '', content = '', games = [], existingTags = [] }) {
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
    .filter((item) => item.tag.length <= maxTagLength && item.tag.length >= 2 && !used.has(fold(item.tag)))
    .slice(0, MAX_SUGGESTED)
    .map((item) => ({ tag: item.tag, kind: item.kind, why: item.why, score: Math.round(item.score * 10) / 10 }));
}

/* ------------------------------ analiza SEO ------------------------------ */

const wordsIn = (text) => (String(text).match(/[\p{L}\p{N}]+/gu) || []).length;

/** Początek tekstu do `max` znaków, ucięty na granicy słowa (tak jak automatyczny opis wpisu). */
function cutText(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!-]+$/, '')}…`;
}

function containsKeyword(text, keyword) {
  if (!keyword) return false;
  const folded = fold(text);
  const key = fold(keyword.text);
  return folded.includes(key) || folded.split(/\s+/).some((w) => key.length >= 5 && stem(w) === stem(key));
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
  const hasLink = /\]\((?:https?:\/\/|\/)[^)]+\)/.test(content);
  const sentences = plain.text.split(/[.!?…]+\s/).filter((s) => wordsIn(s) > 0);
  const avgSentence = sentences.length ? wordCount / sentences.length : 0;
  const firstWords = plain.firstParagraph.split(/\s+/).slice(0, 100).join(' ');
  const titleLength = title.trim().length;
  // Pusty opis serwer uzupełni początkiem treści przy zapisie - oceniamy więc ten automatyczny opis.
  const autoExcerpt = !excerpt.trim();
  const effectiveExcerpt = autoExcerpt ? cutText(plain.text, 160) : excerpt.trim();
  const excerptLength = effectiveExcerpt.length;

  const checks = [
    {
      id: 'title-length', weight: 12, ok: titleLength >= 30 && titleLength <= 65,
      label: `Długość tytułu: ${titleLength} znaków`,
      hint: titleLength < 30 ? 'Za krótki - rozwiń tytuł do 30-65 znaków, żeby lepiej opisywał wpis.' : 'Za długi - wyszukiwarki utną tytuł po ok. 65 znakach.',
    },
    {
      id: 'title-keyword', weight: 14, ok: !!primary && containsKeyword(title, primary),
      label: 'Słowo kluczowe w tytule',
      hint: primary ? `Wpisz w tytule główne słowo kluczowe: „${primary.text}”.` : 'Napisz więcej treści, a wskażemy główne słowo kluczowe.',
    },
    {
      id: 'excerpt-length', weight: 10, ok: excerptLength >= 100 && excerptLength <= 160,
      label: `Krótki opis: ${excerptLength} znaków${autoExcerpt ? ' (z treści)' : ''}`,
      hint: excerptLength < 100 ? 'Rozwiń opis do 100-160 znaków - tyle wyświetla wyszukiwarka i podgląd linku.' : 'Skróć opis do 160 znaków, bo dalsza część zostanie ucięta.',
    },
    {
      id: 'excerpt-keyword', weight: 8, ok: !!primary && containsKeyword(effectiveExcerpt, primary),
      label: 'Słowo kluczowe w opisie',
      hint: primary ? `Użyj w opisie frazy „${primary.text}”.` : 'Dodaj do opisu główne słowo kluczowe.',
    },
    {
      id: 'length', weight: 12, ok: wordCount >= 300,
      label: `Długość tekstu: ${wordCount} słów`,
      hint: 'Dłuższe, rzeczowe wpisy (300+ słów) częściej trafiają do wyników; rozwiń temat.',
    },
    {
      id: 'intro-keyword', weight: 10, ok: !!primary && containsKeyword(firstWords, primary),
      label: 'Słowo kluczowe w pierwszym akapicie',
      hint: primary ? `Wspomnij „${primary.text}” w pierwszych zdaniach.` : 'Wspomnij główny temat w pierwszym akapicie.',
    },
    {
      id: 'headings', weight: 10, ok: wordCount < 250 || headingCount >= 2,
      label: `Śródtytuły: ${headingCount}`,
      hint: 'Podziel tekst śródtytułami (## Tytuł) co 150-250 słów - łatwiej się czyta i skanuje.',
    },
    {
      id: 'links', weight: 8, ok: hasLink,
      label: 'Linki w treści',
      hint: 'Dodaj linki do gier z katalogu albo do źródeł - przycisk „Formatuj pod SEO” zrobi to za Ciebie.',
    },
    {
      id: 'tags', weight: 8, ok: tags.length >= 3 && tags.length <= 8,
      label: `Tagi: ${tags.length}`,
      hint: 'Dodaj 3-8 tagów - skorzystaj z podpowiedzi obok pola tagów.',
    },
    {
      id: 'readability', weight: 6, ok: avgSentence === 0 || avgSentence <= 22,
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

const blockKind = (block) => {
  if (/^##\s+/.test(block)) return 'heading';
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
    return ` ${saved.length - 1} `;
  });
  return { masked, restore: (value) => value.replace(/ (\d+) /g, (_, i) => saved[Number(i)]) };
}

/** Czy sama linia wygląda jak śródtytuł: krótka, od wielkiej litery, bez kropki na końcu ("Zalety i wady", "Gdzie kupić?"). */
function isHeadingLine(line) {
  const text = line.trim();
  const words = text.split(/\s+/).length;
  if (words > 9 || text.length > 70 || !/^[\p{Lu}\d]/u.test(text)) return false;
  if (/[.!,;…]$/.test(text) || /[*#>\[\]`|]/.test(text)) return false;
  if (/^[-*]/.test(text) || (/^\d/.test(text) && !/^\d+\s+\p{L}/u.test(text))) return false;
  return true;
}

/** Nagłówek z samotnej linii: "Zalety i wady" -> "## Zalety i wady". */
function looksLikeHeading(block, next) {
  if (block.includes('\n') || !next) return false;
  return isHeadingLine(block) && blockKind(next) !== 'heading' && wordsIn(next) >= 8;
}

/**
 * Formatuje wpis pod SEO i zwraca nową treść wraz z listą zmian. Niczego nie wymyśla: porządkuje zapis,
 * wyróżnia najważniejsze frazy i linkuje gry z katalogu.
 */
function autoFormat({ title = '', content = '', games = [], existingTags = [] }) {
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

  // 2. Bloki: listy oddzielone od akapitów pustą linią (tego wymaga renderer wpisu).
  let lines = text.split('\n');
  const spaced = [];
  lines.forEach((line, index) => {
    const prev = lines[index - 1];
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

  // 4. Gołe adresy URL -> linki z nazwą serwisu.
  let urls = 0;
  blocks = blocks.map((block) => {
    if (blockKind(block) === 'heading') return block;
    const { masked, restore } = (() => {
      const saved = [];
      const m = block.replace(/\[[^\]]*\]\([^)]*\)/g, (part) => { saved.push(part); return ` ${saved.length - 1} `; });
      return { masked: m, restore: (value) => value.replace(/ (\d+) /g, (_, i) => saved[Number(i)]) };
    })();
    const replaced = masked.replace(/(?<![("'<])https?:\/\/[^\s<>()\]]+/g, (url) => {
      const trailing = (url.match(/[.,;:!?]+$/) || [''])[0];
      const clean = trailing ? url.slice(0, -trailing.length) : url;
      let host;
      try { host = new URL(clean).hostname.replace(/^www\./, ''); } catch (err) { return url; }
      urls += 1;
      return `[${host}](${clean})${trailing}`;
    });
    return restore(replaced);
  });
  if (urls) changes.push({ id: 'urls', label: `Zamieniono adresy URL na linki z nazwą serwisu (${urls})` });

  // 5. Słowa kluczowe: linki do gier z katalogu i pogrubienie pierwszego wystąpienia.
  const keywords = extractKeywords({ title, content: blocks.join('\n\n'), games, existingTags });
  const eligible = (block) => ['paragraph', 'list'].includes(blockKind(block));
  const linked = [];
  const bolded = [];
  const boldSegments = () => [...blocks.join('\n\n').matchAll(/\*\*([^*\n]+)\*\*/g)].map((m) => fold(m[1]));
  const alreadyBold = (phrase) => boldSegments().some((segment) => segment.includes(fold(phrase)));
  const alreadyLinked = (id) => blocks.join('\n\n').includes(`](/games/${id})`);

  const apply = (item, wrap) => {
    const regex = item.regex || phraseRegex(item.text, { ignoreCase: item.kind !== 'gra' || item.multiword !== false });
    for (let i = 0; i < blocks.length; i += 1) {
      if (!eligible(blocks[i])) continue;
      const { masked, restore } = mask(blocks[i]);
      const match = regex.exec(masked);
      if (!match) continue;
      blocks[i] = restore(masked.slice(0, match.index) + wrap(match[0]) + masked.slice(match.index + match[0].length));
      return true;
    }
    return false;
  };

  keywords
    .filter((item) => item.kind === 'gra' && item.gameId !== undefined)
    .slice(0, MAX_LINKS)
    .forEach((item) => {
      if (alreadyLinked(item.gameId)) return;
      if (apply(item, (found) => `[**${found}**](/games/${item.gameId})`)) linked.push(item.text);
    });

  keywords
    .filter((item) => !linked.includes(item.text) && !(item.gameId !== undefined && alreadyLinked(item.gameId)) && ['nazwa', 'gra', 'gatunek', 'platforma', 'temat'].includes(item.kind) && item.text.length >= 3)
    .slice(0, MAX_BOLD + 3)
    .forEach((item) => {
      if (bolded.length >= MAX_BOLD || alreadyBold(item.text)) return;
      if (apply(item, (found) => `**${found}**`)) bolded.push(item.text);
    });

  if (linked.length) changes.push({ id: 'links', label: `Dodano linki do gier z katalogu: ${linked.join(', ')}` });
  if (bolded.length) changes.push({ id: 'bold', label: `Pogrubiono słowa kluczowe: ${bolded.join(', ')}` });

  const result = blocks.join('\n\n');
  return { content: result, changed: result !== original.trim() && changes.length > 0, changes, keywords: keywords.slice(0, 6).map((k) => k.text) };
}

module.exports = { extractKeywords, suggestTags, analyze, autoFormat, toPlain, fold };
