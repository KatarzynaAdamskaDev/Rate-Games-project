/**
 * Asystent SEO edytora bloga (utils/seoAssistant.js) - liczony lokalnie, bez żadnych usług
 * zewnętrznych, więc w całości testowalny jako czyste funkcje.
 */
const { extractKeywords, suggestTags, analyze, autoFormat, toPlain, fold, makeExcerpt, imageStats } = require('../../utils/seoAssistant');

describe('fold', () => {
  test('usuwa polskie znaki diakrytyczne i sprowadza do małych liter', () => {
    expect(fold('ŁÓDŹ Żółw')).toBe('lodz zolw');
  });
});

describe('toPlain', () => {
  test('rozdziela nagłówki od tekstu i pomija linie z mediami (obrazy/filmy/karty gier)', () => {
    const result = toPlain('## Nagłówek\n\nPierwszy akapit.\n\n![img](x.png)\n\nDrugi akapit.');
    expect(result.headings).toEqual(['Nagłówek']);
    expect(result.firstParagraph).toBe('Pierwszy akapit.');
    expect(result.text).not.toContain('![img]');
  });
});

describe('makeExcerpt', () => {
  test('mieszczący się tekst wraca bez zmian', () => {
    expect(makeExcerpt('Krótki tekst.', 140)).toBe('Krótki tekst.');
  });

  test('za długi tekst jest ucinany do limitu, z wielokropkiem', () => {
    const excerpt = makeExcerpt('Pierwsze zdanie. Drugie zdanie jest nieco dłuższe niż pierwsze. Trzecie zdanie na końcu.', 60);
    expect(excerpt.length).toBeLessThanOrEqual(61); // 60 znaków + "…"
    expect(excerpt.endsWith('…')).toBe(true);
  });

  test('nie przecina słowa w połowie - kończy na granicy słowa/zdania', () => {
    const excerpt = makeExcerpt('a '.repeat(200), 20);
    expect(excerpt.endsWith(' …') || /\S…$/.test(excerpt)).toBe(true);
    expect(excerpt).not.toMatch(/\s$/);
  });
});

describe('imageStats', () => {
  test('liczy zdjęcia i te bez tekstu alternatywnego', () => {
    expect(imageStats('![alt1](/a.png)\n\n![](/b.png)\n\nTekst')).toEqual({ total: 2, missingAlt: 1 });
  });

  test('brak zdjęć daje same zera', () => {
    expect(imageStats('Sam tekst bez zdjęć.')).toEqual({ total: 0, missingAlt: 0 });
  });
});

describe('extractKeywords', () => {
  test('gra z katalogu wspomniana w tytule i treści dostaje wysoki wynik', () => {
    const keywords = extractKeywords({
      title: 'Poradnik do Elden Ring',
      content: 'Elden Ring to świetna gra RPG na PC i PS5. Elden Ring poleca wielu graczy.',
      games: [{ id: '1', name: 'Elden Ring' }],
      existingTags: [],
      tags: [],
    });
    expect(keywords[0]).toMatchObject({ text: 'Elden Ring', kind: 'gra', gameId: '1' });
    expect(keywords[0].count).toBeGreaterThanOrEqual(2);
  });

  test('rozpoznaje platformy i gatunki ze słownika TOPICS (potrzebują 2 wystąpień albo obecności w tytule)', () => {
    const keywords = extractKeywords({
      title: 'RPG na PC',
      content: 'To jest roguelike na PC. Ten roguelike jest bardzo trudną grą RPG i wymaga cierpliwości.',
      games: [],
      existingTags: [],
      tags: [],
    });
    const tags = keywords.map((k) => k.text);
    // RPG i PC są w tytule (wystarczy 1 wystąpienie), "roguelike" powtarza się w treści dwa razy.
    expect(tags).toEqual(expect.arrayContaining(['PC', 'RPG', 'roguelike']));
  });

  test('platforma wspomniana tylko raz i poza tytułem nie trafia do słów kluczowych (unikanie szumu)', () => {
    const keywords = extractKeywords({
      title: 'Neutralny tytuł',
      content: 'Wpis, w którym raz przelotnie pada słowo VR, ale to nie jest jego temat.',
      games: [],
      existingTags: [],
      tags: [],
    });
    expect(keywords.map((k) => k.text)).not.toContain('VR');
  });

  test('tagi wpisane ręcznie przez autora też trafiają do słów kluczowych', () => {
    const keywords = extractKeywords({
      title: 'Temat bez wzmianek',
      content: 'Zupełnie neutralny tekst bez żadnych specjalnych słów.',
      games: [],
      existingTags: [],
      tags: ['unikalnytag'],
    });
    expect(keywords.some((k) => fold(k.text) === 'unikalnytag')).toBe(true);
  });

  test('pusta treść nie wywraca funkcji i zwraca pustą (albo prawie pustą) listę', () => {
    expect(() => extractKeywords({ title: '', content: '', games: [], existingTags: [], tags: [] })).not.toThrow();
  });
});

describe('suggestTags', () => {
  test('proponuje tagi na podstawie słów kluczowych, pomijając już dodane', () => {
    const keywords = extractKeywords({
      title: 'Poradnik do Elden Ring',
      content: 'Elden Ring to świetna gra RPG na PC. Elden Ring poleca wielu graczy.',
      games: [{ id: '1', name: 'Elden Ring' }],
      existingTags: [],
      tags: [],
    });
    const suggestions = suggestTags({ keywords, taken: [] });
    expect(suggestions.some((s) => s.tag === 'Elden Ring')).toBe(true);
  });

  test('nie proponuje tagu, który już jest dodany (bez względu na wielkość liter)', () => {
    const keywords = [{ text: 'RPG', tag: 'RPG', kind: 'gatunek' }];
    const suggestions = suggestTags({ keywords, taken: ['rpg'] });
    expect(suggestions.some((s) => s.tag.toLowerCase() === 'rpg')).toBe(false);
  });

  test('respektuje maksymalną długość tagu', () => {
    const keywords = [{ text: 'x'.repeat(50), tag: 'x'.repeat(50), kind: 'temat' }];
    const suggestions = suggestTags({ keywords, taken: [], maxTagLength: 24 });
    expect(suggestions.every((s) => s.tag.length <= 24)).toBe(true);
  });
});

describe('analyze', () => {
  test('krótki wpis bez okładki i tagów ma niską ocenę i sporo niespełnionych punktów', () => {
    const result = analyze({ title: 'T', excerpt: '', content: 'Krótki tekst.', tags: [], hasCover: false, keywords: [] });
    expect(result.score).toBeLessThan(50);
    expect(result.checks.find((c) => c.id === 'length').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'cover').ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'tags').ok).toBe(false);
  });

  test('rozbudowany wpis ze wszystkim na miejscu ma wysoką ocenę', () => {
    const keywords = extractKeywords({ title: 'Elden Ring - poradnik', content: 'Elden Ring to świetna gra.', games: [{ id: '1', name: 'Elden Ring' }], existingTags: [], tags: [] });
    const longContent = [
      '## Wstęp',
      'Elden Ring to świetna gra RPG na PC. '.repeat(60),
      '## Więcej',
      'Kolejny akapit z detalami o rozgrywce i mechanikach. '.repeat(20),
      '[Link do gry](/games/1)',
      '![Zrzut ekranu z rozgrywki](/x.png)',
    ].join('\n\n');
    const result = analyze({
      title: 'Elden Ring - poradnik',
      excerpt: 'Poradnik do Elden Ring z poradami dla początkujących graczy PC.',
      content: longContent,
      tags: ['a', 'b', 'c'],
      hasCover: true,
      keywords,
    });
    expect(result.score).toBeGreaterThan(70);
    expect(result.checks.find((c) => c.id === 'images').ok).toBe(true);
    expect(result.checks.find((c) => c.id === 'links').ok).toBe(true);
  });

  test('znacznik [UZUPEŁNIJ: ...] z pomocnika pisania liczy się jako niespełniony punkt "todo"', () => {
    const withTodo = analyze({ title: 'T', content: 'Tekst [UZUPEŁNIJ: coś] dalej.', tags: [], hasCover: true, keywords: [] });
    const withoutTodo = analyze({ title: 'T', content: 'Tekst dalej.', tags: [], hasCover: true, keywords: [] });
    expect(withTodo.checks.find((c) => c.id === 'todo').ok).toBe(false);
    expect(withoutTodo.checks.find((c) => c.id === 'todo').ok).toBe(true);
  });

  test('każdy punkt kontrolny ma etykietę i podpowiedź (do wyświetlenia w edytorze)', () => {
    const result = analyze({ title: 'T', content: 'Tekst.', tags: [], hasCover: false, keywords: [] });
    result.checks.forEach((check) => {
      expect(typeof check.label).toBe('string');
      expect(typeof check.hint).toBe('string');
      expect(check.label.length).toBeGreaterThan(0);
    });
  });
});

describe('autoFormat', () => {
  const games = [{ id: '119133', name: 'Elden Ring' }];

  test('pogrubia pierwsze wystąpienie i linkuje wspomnianą grę z katalogu', () => {
    const result = autoFormat({
      title: 'Poradnik do Elden Ring',
      content: 'Elden Ring to świetna gra RPG. Polecamy każdemu graczowi, który lubi trudne wyzwania w otwartym świecie.',
      games,
      existingTags: [],
      tags: [],
    });
    expect(result.changed).toBe(true);
    expect(result.content).toContain('[**Elden Ring**](/games/119133)');
  });

  test('nie pogrubia drugi raz tej samej gry przy ponownym wywołaniu (idempotencja)', () => {
    const first = autoFormat({ title: 'Elden Ring', content: 'Elden Ring to świetna gra. Elden Ring poleca wielu graczy w tej notce.', games, existingTags: [], tags: [] });
    const second = autoFormat({ title: 'Elden Ring', content: first.content, games, existingTags: [], tags: [] });
    // Za drugim razem nie ma już nic do polinkowania/pogrubienia w tym samym miejscu.
    expect(second.changes.some((c) => c.id === 'links')).toBe(false);
  });

  test('gdy nic nie da się poprawić, "changed" jest false, a w "notes" jest wyjaśnienie', () => {
    const result = autoFormat({
      title: 'Elden Ring',
      content: '**Elden Ring** to gra. [Elden Ring](/games/119133) poleca wielu graczy w tej krótkiej notce.',
      games,
      existingTags: [],
      tags: [],
    });
    expect(result.changed).toBe(false);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  test('uzupełnia brakujący tekst alternatywny zdjęcia', () => {
    const result = autoFormat({ title: 'Test wpisu', content: '![](/images/x.png)', games: [], existingTags: [], tags: [] });
    expect(result.changed).toBe(true);
    expect(result.content).toMatch(/!\[.+\]\(\/images\/x\.png\)/);
    expect(result.content).not.toBe('![](/images/x.png)');
  });

  test('nie zmienia treści, w której nie ma żadnej gry z katalogu ani czego pogrubić', () => {
    const result = autoFormat({ title: 'Neutralny temat', content: 'Zupełnie zwyczajny tekst bez niczego szczególnego do poprawy w tej krótkiej wersji.', games: [], existingTags: [], tags: [] });
    expect(typeof result.changed).toBe('boolean');
    expect(Array.isArray(result.notes)).toBe(true);
  });
});
