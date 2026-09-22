/**
 * Część utils/writerPipeline.js, która nie dotyka sieci ani bazy: składanie gotowego artykułu
 * (wstawianie zdjęć/filmu w miejsce znaczników {{img:N}}/{{video}}), podpis zdjęcia (autor +
 * licencja) i proste dopasowanie zdjęcia po tytule (tryb bez AI). Reszta modułu (runWriter) ma
 * testy integracyjne z atrapą API Anthropic i atrapą usług ze zdjęciami/filmami.
 */
// writerPipeline.js wymaga blogMedia.js (a przez nie config/database.js) samym swoim require - żadna
// z testowanych tu funkcji nie odpytuje bazy, ale na wszelki wypadek wskazujemy plik tymczasowy.
process.env.SQLITE_STORAGE = ':memory:';

const { placeMedia, captionFor, heuristicPick } = require('../../utils/writerPipeline');

describe('placeMedia', () => {
  test('zastępuje znaczniki {{img:N}} i {{video}} gotowymi elementami', () => {
    const images = new Map([[1, '![alt1](/a.webp "podpis")']]);
    const result = placeMedia('Wstęp.\n\n{{img:1}}\n\n{{video}}', { images, video: '@[youtube](abcdefghijk)' });
    expect(result).toContain('![alt1](/a.webp "podpis")');
    expect(result).toContain('@[youtube](abcdefghijk)');
    expect(result).not.toMatch(/\{\{/);
  });

  test('nieznany numer zdjęcia (spoza mapy images) po prostu znika, bez błędu', () => {
    const result = placeMedia('Tekst\n\n{{img:9}}\n\nDalej', { images: new Map(), video: '' });
    expect(result).toBe('Tekst\n\nDalej');
  });

  test('brak zdjęć i filmu - znaczniki znikają, nie zostaje potrójna pusta linia', () => {
    const result = placeMedia('Tekst\n\n{{video}}\n\n{{img:1}}\n\nKoniec', { images: new Map(), video: '' });
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).not.toMatch(/\{\{/);
  });

  test('film bez znacznika w tekście trafia przed drugi śródtytuł', () => {
    const result = placeMedia('Wstęp.\n\n## A\n\nTekst A\n\n## B\n\nTekst B', { images: new Map(), video: '@[youtube](abcdefghijk)' });
    const posVideo = result.indexOf('@[youtube]');
    expect(posVideo).toBeGreaterThan(result.indexOf('## A'));
    expect(posVideo).toBeLessThan(result.indexOf('## B'));
  });

  test('film bez śródtytułów w tekście trafia na koniec', () => {
    const result = placeMedia('Sam tekst bez sekcji', { images: new Map(), video: '@[youtube](abcdefghijk)' });
    expect(result.endsWith('@[youtube](abcdefghijk)')).toBe(true);
  });

  test('film wstawia się tylko raz, nawet jeśli w treści jest kilka znaczników {{video}}', () => {
    const result = placeMedia('{{video}}\n\ntekst\n\n{{video}}', { images: new Map(), video: '@[youtube](abcdefghijk)' });
    expect(result.match(/@\[youtube\]/g)).toHaveLength(1);
  });
});

describe('captionFor', () => {
  test('zdjęcie z wolnej licencji: opis + autor + licencja', () => {
    const caption = captionFor('Pad do gier', { provider: 'openverse', author: 'Jan Kowalski', license: 'CC BY-SA 4.0' });
    expect(caption).toBe('Pad do gier - fot. Jan Kowalski, CC BY-SA 4.0');
  });

  test('zdjęcie z Wikimedia Commons dostaje dopisek o źródle', () => {
    const caption = captionFor('Grafika', { provider: 'commons', author: 'Maria Nowak', license: 'CC0 1.0', origin: 'wikimedia_commons' });
    expect(caption).toContain('(Wikimedia Commons)');
  });

  test('zrzut ekranu z IGDB jest opisany jako materiały wydawcy, nie wolna licencja', () => {
    const caption = captionFor('Zrzut z gry', { provider: 'igdb', author: 'Elden Ring' });
    expect(caption).toContain('materiały wydawcy');
    expect(caption).toContain('IGDB');
  });

  test('usuwa cudzysłowy i nawiasy kwadratowe z opisu (trafi do atrybutu title="...")', () => {
    const caption = captionFor('Pad "do" gier [test]', { provider: 'openverse', author: 'Ktoś', license: 'CC0 1.0' });
    expect(caption).not.toMatch(/["[\]]/);
  });

  test('podpis jest ograniczony do rozsądnej długości', () => {
    const caption = captionFor('x'.repeat(500), { provider: 'openverse', author: 'y'.repeat(200), license: 'CC0 1.0' });
    expect(caption.length).toBeLessThanOrEqual(290);
  });
});

describe('heuristicPick (dobór zdjęcia bez AI - dopasowanie po tytule)', () => {
  test('wybiera kandydata, którego tytuł zawiera słowo z zapytania', () => {
    const candidates = [{ title: 'Coś zupełnie innego' }, { title: 'Elden Ring cosplay photo' }];
    expect(heuristicPick('Elden Ring', candidates)).toBe(1);
  });

  test('brak dopasowania zwraca -1 (żadne zdjęcie nie zostanie wybrane)', () => {
    expect(heuristicPick('Elden Ring', [{ title: 'Zupełnie coś innego' }])).toBe(-1);
  });

  test('krótkie, mało znaczące słowa (poniżej 4 znaków) nie liczą się do dopasowania', () => {
    // "to" i "a" to za krótkie tokeny - dopasowanie nie powinno zajść przez przypadek.
    expect(heuristicPick('to a x', [{ title: 'To jest a coś tam' }])).toBe(-1);
  });
});
