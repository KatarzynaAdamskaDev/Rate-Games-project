/**
 * Czyste funkcje bloga: parsowanie tagów, renderowanie treści (mini-Markdown -> HTML) i eksport
 * do Markdownu. Bez bazy danych - savePost/getPosts/findPost mają własne testy integracyjne
 * (tests/integration/blog.test.js), bo potrzebują tabel blog_posts/blog_post_tags.
 */
// utils/blogHelpers.js wymaga config/database.js (Sequelize+SQLite) samym swoim require - żadna
// z testowanych tu funkcji go nie odpytuje, ale na wszelki wypadek wskazujemy plik tymczasowy,
// żeby nic nigdy nie dotknęło prawdziwej bazy data/dev.sqlite3.
process.env.SQLITE_STORAGE = ':memory:';

const {
  parseTags,
  tagKey,
  postState,
  countTags,
  extractImages,
  collectGameEmbeds,
  renderContent,
  postToMarkdown,
  CATEGORIES,
  DEFAULT_CATEGORY,
  MAX_TAGS,
  MAX_TAG_LENGTH,
} = require('../../utils/blogHelpers');

describe('parseTags', () => {
  test('rozdziela po przecinku, średniku i nowej linii, usuwa "#"', () => {
    expect(parseTags('rpg, #akcja; przygodowe\nindie')).toEqual(['rpg', 'akcja', 'przygodowe', 'indie']);
  });

  test('usuwa duplikaty bez względu na wielkość liter (zostaje pierwszy zapis)', () => {
    expect(parseTags('RPG, rpg, Rpg')).toEqual(['RPG']);
  });

  test('ogranicza liczbę tagów do MAX_TAGS i długość każdego do MAX_TAG_LENGTH', () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag${i}`).join(',');
    expect(parseTags(many)).toHaveLength(MAX_TAGS);
    expect(parseTags('x'.repeat(MAX_TAG_LENGTH + 20))[0]).toHaveLength(MAX_TAG_LENGTH);
  });

  test('przyjmuje też gotową tablicę i ignoruje puste elementy', () => {
    expect(parseTags(['rpg', '', '  ', 'indie'])).toEqual(['rpg', 'indie']);
  });

  test('brak wejścia daje pustą tablicę', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(null)).toEqual([]);
  });
});

describe('tagKey', () => {
  test('małe litery i przycięcie białych znaków - do porównań', () => {
    expect(tagKey('  RPG  ')).toBe('rpg');
    expect(tagKey('RPG')).toBe(tagKey('rpg'));
  });
});

describe('postState', () => {
  const now = new Date('2026-01-15T12:00:00.000Z').getTime();

  test('szkic jest szkicem niezależnie od daty publikacji', () => {
    expect(postState({ status: 'draft', publishAt: '2020-01-01' }, now)).toBe('draft');
  });

  test('data publikacji w przyszłości -> zaplanowany', () => {
    expect(postState({ status: 'published', publishAt: '2026-02-01T00:00:00.000Z' }, now)).toBe('scheduled');
  });

  test('data publikacji w przeszłości albo brak daty -> opublikowany', () => {
    expect(postState({ status: 'published', publishAt: '2020-01-01T00:00:00.000Z' }, now)).toBe('published');
    expect(postState({ status: 'published', publishAt: null }, now)).toBe('published');
  });
});

describe('countTags', () => {
  test('liczy wystąpienia i sortuje malejąco, remisy alfabetycznie', () => {
    const posts = [{ tags: ['RPG', 'Indie'] }, { tags: ['rpg'] }, { tags: ['Akcja'] }];
    const result = countTags(posts);
    expect(result[0]).toMatchObject({ key: 'rpg', count: 2 });
    expect(result.slice(1).map((r) => r.key)).toEqual(['akcja', 'indie']);
  });

  test('pusta lista wpisów daje pustą listę tagów', () => {
    expect(countTags([])).toEqual([]);
  });
});

describe('extractImages', () => {
  test('wyciąga opis i adres każdego zdjęcia w treści', () => {
    const content = '![Mapa](/images/mapa.png "podpis")\n\nTekst\n\n![Zewnętrzne](https://example.com/x.png)';
    expect(extractImages(content)).toEqual([
      { alt: 'Mapa', src: '/images/mapa.png' },
      { alt: 'Zewnętrzne', src: 'https://example.com/x.png' },
    ]);
  });

  test('odrzuca niebezpieczne adresy (np. javascript:)', () => {
    expect(extractImages('![x](javascript:alert(1))')).toEqual([]);
  });

  test('brak treści nie wywraca funkcji', () => {
    expect(extractImages('')).toEqual([]);
    expect(extractImages(undefined)).toEqual([]);
  });
});

describe('collectGameEmbeds', () => {
  test('zbiera identyfikatory kart gier, bez duplikatów, w kolejności wystąpienia', () => {
    expect(collectGameEmbeds('[[game:119133]]\n\ntekst\n\n[[game:c1]]\n\n[[game:119133]]')).toEqual(['119133', 'c1']);
  });

  test('linia, która tylko przypomina osadzenie, nie jest liczona', () => {
    expect(collectGameEmbeds('to nie jest [[game:123]] w osobnej linii')).toEqual([]);
  });
});

describe('renderContent', () => {
  test('nagłówek "## " staje się <h2>', () => {
    expect(renderContent('## Śródtytuł')).toBe('<h2>Śródtytuł</h2>');
  });

  test('lista punktowana i numerowana', () => {
    expect(renderContent('- raz\n- dwa')).toBe('<ul><li>raz</li><li>dwa</li></ul>');
    expect(renderContent('1. raz\n2. dwa')).toBe('<ol><li>raz</li><li>dwa</li></ol>');
  });

  test('cytat i pogrubienie/kursywa w tekście', () => {
    expect(renderContent('> cytat')).toBe('<blockquote>cytat</blockquote>');
    expect(renderContent('**mocne** i *kursywa*')).toBe('<p><strong>mocne</strong> i <em>kursywa</em></p>');
  });

  test('ramka informacyjna "> [!TIP] ..."', () => {
    const html = renderContent('> [!TIP] Zapisuj grę przed bossem.');
    expect(html).toContain('gv-callout-tip');
    expect(html).toContain('<b>Wskazówka</b>');
    expect(html).toContain('Zapisuj grę przed bossem.');
  });

  test('linia pozioma "---"', () => {
    expect(renderContent('---')).toBe('<hr>');
  });

  test('zdjęcie z podpisem i układem staje się <figure> z możliwością powiększenia', () => {
    const html = renderContent('![Mapa Limgrave](/images/blog/media/a.webp "Zrzut ekranu"){wide}');
    expect(html).toContain('<figure class="gv-fig gv-fig-wide">');
    expect(html).toContain('src="/images/blog/media/a.webp"');
    expect(html).toContain('alt="Mapa Limgrave"');
    expect(html).toContain('<figcaption>Zrzut ekranu</figcaption>');
    expect(html).toContain('data-zoom');
  });

  test('zdjęcie z niebezpiecznym adresem (poza /... i https://) nie trafia do <img>', () => {
    const html = renderContent('![opis](javascript:evil)');
    expect(html).not.toContain('<img');
    expect(html).toBe('<p>opis</p>');
  });

  test('film z YouTube - tylko z poprawnym (11-znakowym) identyfikatorem', () => {
    const html = renderContent('@[youtube](dQw4w9WgXcQ)');
    expect(html).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(renderContent('@[youtube](" onload="alert(1))')).not.toContain('<iframe');
  });

  test('karta gry z katalogu, gdy dane gry są dostępne', () => {
    const games = new Map([['119133', { id: '119133', title: 'Elden Ring', coverImage: '/images/cover.jpg', platform: 'PC', releaseYear: 2022, averageRating: 4.5, reviewCount: 10 }]]);
    const html = renderContent('[[game:119133]]', { games });
    expect(html).toContain('gv-gamecard');
    expect(html).toContain('href="/games/119133"');
    expect(html).toContain('Elden Ring');
    expect(html).toContain('4.5/5');
  });

  test('karta gry bez danych (nie wczytano) daje sam link', () => {
    const html = renderContent('[[game:119133]]');
    expect(html).toBe('<p><a href="/games/119133">Zobacz grę w katalogu GameVerse</a></p>');
  });

  test('linki wewnętrzne otwierają się w tej samej karcie, zewnętrzne w nowej', () => {
    expect(renderContent('[Gra](/games/1)')).toBe('<p><a href="/games/1">Gra</a></p>');
    expect(renderContent('[Źródło](https://example.com)')).toBe('<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">Źródło</a></p>');
  });

  test('surowy HTML i script są escapowane (ochrona przed XSS)', () => {
    const html = renderContent('<script>alert(1)</script> <b>pogrubienie htmlem</b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('cudzysłów w opisie zdjęcia jest escapowany - nie wychodzi poza atrybut alt', () => {
    const html = renderContent('![opis" onerror="alert(1)](/images/x.png)');
    // Payload trafia do wnętrza alt="..." jako nieszkodliwy, zescapowany tekst...
    expect(html).toContain('alt="opis&quot; onerror=&quot;alert(1)"');
    // ...a nie jako osobny, żywy atrybut onerror poza cudzysłowem.
    expect(html).not.toMatch(/"\s*onerror=/);
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  test('pusta treść daje pusty akapit (nie wywraca funkcji)', () => {
    expect(renderContent('')).toBe('<p></p>');
  });
});

describe('postToMarkdown', () => {
  const post = {
    title: 'Tytuł wpisu',
    author: 'Redakcja',
    category: 'Poradniki',
    tags: ['rpg', 'poradnik'],
    readMinutes: 3,
    publishedAt: '2026-01-10T10:00:00.000Z',
    excerpt: 'Krótki opis.',
    content: 'Zobacz [inny wpis](/blog/abc) i [stronę główną](/).',
  };

  test('zawiera metadane i treść', () => {
    const md = postToMarkdown(post, 'https://example.com/blog/xyz');
    expect(md).toContain('# Tytuł wpisu');
    expect(md).toContain('- Autor: Redakcja');
    expect(md).toContain('- Kategoria: Poradniki');
    expect(md).toContain('- Tagi: rpg, poradnik');
    expect(md).toContain('> Krótki opis.');
  });

  test('linki wewnętrzne stają się bezwzględne (adres serwisu z parametru url)', () => {
    const md = postToMarkdown(post, 'https://example.com/blog/xyz');
    expect(md).toContain('(https://example.com/blog/abc)');
    expect(md).not.toContain('](/blog/abc)');
  });
});

describe('kategorie i limity', () => {
  test('CATEGORIES zawiera domyślną kategorię', () => {
    expect(CATEGORIES).toContain(DEFAULT_CATEGORY);
  });
});
