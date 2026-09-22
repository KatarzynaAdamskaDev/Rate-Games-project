/**
 * Pomocnik pisania (utils/writingAssistant.js) - część bez sieci: sprawdzanie i porządkowanie
 * zadania od autora, budowa promptu, szkielet artykułu bez AI oraz czyszczenie wyniku (finalize).
 * Rozmowa z Claude (generateWithClaude/researchWithClaude/curateImages) ma osobne testy w
 * tests/integration/blog-writer.test.js (na atrapie API, bez prawdziwego klucza).
 */
const { parseTags } = require('../../utils/blogHelpers');
const w = require('../../utils/writingAssistant');

const LIMITS = { title: 120, excerpt: 200, content: 30000 };

describe('normalizeBrief', () => {
  test('odrzuca zbyt krótki temat', () => {
    const result = w.normalizeBrief({ topic: 'ab' });
    expect(result.error).toBeTruthy();
    expect(result.brief).toBeUndefined();
  });

  test('domyślne wartości dla nieznanego rodzaju/tonu/długości', () => {
    const { brief } = w.normalizeBrief({ topic: 'Poradnik do gry', type: 'nieznany', tone: 'zly', length: 'zla' });
    expect(brief.type).toBe('guide');
    expect(brief.tone).toBe('neutral');
    expect(brief.length).toBe('medium');
    expect(brief.words).toBe(w.LENGTHS.medium);
  });

  test('porządkuje punkty: usuwa wypunktowania i puste linie', () => {
    const { brief } = w.normalizeBrief({ topic: 'Temat', points: '- a\n2) b\n\n  • c ; d' });
    expect(brief.points).toEqual(['a', 'b', 'c', 'd']);
  });

  test('identyfikatory gier: bez duplikatów, bez niepoprawnych znaków, limit LIMITS.games', () => {
    const { brief } = w.normalizeBrief({ topic: 'Temat', games: ['12', ' 12 ', 'zły id!', '13', '14', '15', '16', '17'] });
    expect(brief.gameIds).toEqual(['12', '13', '14', '15', '16']);
    expect(brief.gameIds.length).toBeLessThanOrEqual(w.LIMITS.games);
  });

  test('klucze prototypu nie przechodzą jako rodzaj/ton (bezpieczeństwo)', () => {
    const { brief } = w.normalizeBrief({ topic: 'Temat', type: '__proto__', tone: 'constructor' });
    expect(brief.type).toBe('guide');
    expect(brief.tone).toBe('neutral');
  });

  test('faq domyślnie włączone, wyłączane przez "0"/"false"/false', () => {
    expect(w.normalizeBrief({ topic: 'Temat' }).brief.faq).toBe(true);
    expect(w.normalizeBrief({ topic: 'Temat', faq: '0' }).brief.faq).toBe(false);
    expect(w.normalizeBrief({ topic: 'Temat', faq: false }).brief.faq).toBe(false);
  });
});

describe('factOf', () => {
  test('wyciąga dane gry z katalogu w postaci przekazywanej modelowi', () => {
    const fact = w.factOf({ id: 119133, title: 'Elden Ring', category: 'RPG', platformsFull: ['PC', 'PlayStation 5'], releaseYear: 2022, description: 'An open-world action RPG.', averageRating: 4.6, reviewCount: 12 });
    expect(fact).toMatchObject({ id: '119133', name: 'Elden Ring', genre: 'RPG', year: 2022, rating: 4.6, reviews: 12 });
    expect(fact.platforms).toEqual(['PC', 'PlayStation 5']);
  });

  test('brak roku/opisu/gatunku daje null zamiast śmieciowych wartości', () => {
    const fact = w.factOf({ id: 'c1', title: 'Własna gra', category: 'Inne', platform: 'PC, Switch', releaseYear: 'Brak danych', description: 'Brak opisu dla tej gry.' });
    expect(fact.year).toBeNull();
    expect(fact.genre).toBeNull();
    expect(fact.summary).toBe('');
    expect(fact.platforms).toEqual(['PC', 'Switch']);
  });
});

describe('buildPrompt', () => {
  test('zawiera temat, punkty, dane gier i zasady bez znaczników do uzupełnienia', () => {
    const { brief } = w.normalizeBrief({ topic: 'Poradnik do Elden Ring', points: 'buildy\nbossowie', games: ['119133'] });
    const facts = [w.factOf({ id: 119133, title: 'Elden Ring', category: 'RPG', platformsFull: ['PC'], releaseYear: 2022 })];
    const prompt = w.buildPrompt({ brief, facts, keywords: ['elden ring'], existingTags: ['rpg'] });
    expect(prompt.user).toContain('Temat: Poradnik do Elden Ring');
    expect(prompt.user).toContain('1. buildy');
    expect(prompt.user).toContain('"id": "119133"');
    expect(prompt.system).toContain('Napisz kompletny artykuł');
    expect(prompt.system).not.toMatch(/wstaw znacznik/i);
    expect(prompt.system).toContain('Nie zmyślaj faktów');
  });

  test('bez gier i punktów jasno o tym informuje model', () => {
    const { brief } = w.normalizeBrief({ topic: 'Temat', faq: false });
    const prompt = w.buildPrompt({ brief, facts: [], keywords: [], existingTags: [] });
    expect(prompt.user).toContain('brak - autor nie wskazał gier');
    expect(prompt.user).toContain('FAQ: nie');
  });
});

describe('takeQuota / resetQuota (limit kosztów AI)', () => {
  beforeEach(() => {
    w.resetQuota();
  });

  test('godzinny limit: kolejne wywołania po przekroczeniu limitu są odrzucane', () => {
    process.env.WRITER_MAX_PER_HOUR = '3';
    const t0 = Date.now();
    const results = [1, 2, 3, 4].map((i) => w.takeQuota('user-a', t0 + i * 1000).ok);
    expect(results).toEqual([true, true, true, false]);
    delete process.env.WRITER_MAX_PER_HOUR;
  });

  test('każdy użytkownik ma własny licznik godzinny', () => {
    process.env.WRITER_MAX_PER_HOUR = '1';
    const t0 = Date.now();
    expect(w.takeQuota('user-a', t0).ok).toBe(true);
    expect(w.takeQuota('user-a', t0 + 1).ok).toBe(false);
    expect(w.takeQuota('user-b', t0 + 2).ok).toBe(true);
    delete process.env.WRITER_MAX_PER_HOUR;
  });

  test('dzienny limit dotyczy całego serwisu (sumuje wszystkich użytkowników)', () => {
    process.env.WRITER_MAX_PER_HOUR = '10';
    process.env.WRITER_MAX_PER_DAY = '2';
    const t0 = Date.now();
    expect(w.takeQuota('u1', t0).ok).toBe(true);
    expect(w.takeQuota('u2', t0 + 1).ok).toBe(true);
    const third = w.takeQuota('u3', t0 + 2);
    expect(third.ok).toBe(false);
    expect(third.message).toMatch(/Dzienny limit/);
    delete process.env.WRITER_MAX_PER_HOUR;
    delete process.env.WRITER_MAX_PER_DAY;
  });
});

describe('generateSkeleton (bez AI)', () => {
  const facts = [w.factOf({ id: 119133, title: 'Elden Ring', category: 'RPG', platformsFull: ['PC', 'PlayStation 5'], releaseYear: 2022, averageRating: 4.6, reviewCount: 12 })];

  test('zawiera prawdziwe dane gry, kartę gry i śródtytuły z punktów zadania', () => {
    const { brief } = w.normalizeBrief({ topic: 'Poradnik do Elden Ring', points: 'wymagania sprzętowe\nnajlepsze klasy', games: ['119133'] });
    const raw = w.generateSkeleton({ brief, facts, keywords: ['elden ring'] });
    expect(raw.content).toContain('Elden Ring');
    expect(raw.content).toContain('[[game:119133]]');
    expect(raw.content).toContain('## Wymagania sprzętowe');
    expect(raw.content).toContain('## Najlepsze klasy');
    expect(raw.content).toContain('## Najczęściej zadawane pytania');
  });

  test('bez FAQ nie dokłada sekcji pytań', () => {
    const { brief } = w.normalizeBrief({ topic: 'Temat bez FAQ', faq: false });
    const raw = w.generateSkeleton({ brief, facts: [], keywords: [] });
    expect(raw.content).not.toContain('Najczęściej zadawane pytania');
  });

  test('zestawienie (ranking) z gier z katalogu daje numerowaną listę z linkami', () => {
    const { brief } = w.normalizeBrief({ topic: 'Ranking gier', type: 'top', games: ['119133'] });
    const raw = w.generateSkeleton({ brief, facts, keywords: [] });
    expect(raw.content).toMatch(/^1\. \[Elden Ring\]\(\/games\/119133\)/m);
  });

  test('szkielet zawsze zostawia znaczniki [UZUPEŁNIJ: ...] do ręcznego uzupełnienia', () => {
    const { brief } = w.normalizeBrief({ topic: 'Dowolny temat' });
    const raw = w.generateSkeleton({ brief, facts: [], keywords: [] });
    expect(raw.content).toMatch(w.PLACEHOLDER);
  });
});

describe('finalize (czyszczenie wyniku - z AI albo ze szkieletu)', () => {
  test('tytuł bez znaczników Markdown/HTML i w limicie długości', () => {
    const result = w.finalize({ title: '# **Tytuł** `z kodem` ' + 'bardzo '.repeat(30), excerpt: 'opis', tags: [], content: 'treść' }, { allowedIds: [], limits: LIMITS, parseTags });
    expect(result.title).not.toMatch(/[#*`]/);
    expect(result.title.length).toBeLessThanOrEqual(LIMITS.title);
  });

  test('tagi przechodzą przez parseTags (bez #, bez duplikatów, limity)', () => {
    const result = w.finalize({ title: 't', excerpt: 'e', tags: ['#a', 'A', 'b'], content: 'treść' }, { allowedIds: [], limits: LIMITS, parseTags });
    expect(result.tags).toEqual(['a', 'b']);
  });

  test('usuwa HTML, skrypty, obrazy i filmy z treści (te dokłada osobno writerPipeline)', () => {
    const dirty = '<script>alert(1)</script>Tekst <b>pogrubiony htmlem</b>.\n\n![img](https://x/y.png)\n\n@[youtube](dQw4w9WgXcQ)';
    const result = w.finalize({ title: 't', excerpt: 'e', tags: [], content: dirty }, { allowedIds: [], limits: LIMITS, parseTags });
    expect(result.content).not.toMatch(/<script|<b>|!\[|@\[youtube/);
  });

  test('zamienia H1/H3 na H2 i gwiazdki/kropki list na "-"', () => {
    const result = w.finalize({ title: 't', excerpt: 'e', tags: [], content: '# H1\n\n### H3\n\n* punkt a\n\n• punkt b' }, { allowedIds: [], limits: LIMITS, parseTags });
    expect(result.content).toMatch(/^## H1$/m);
    expect(result.content).toMatch(/^## H3$/m);
    expect(result.content).toMatch(/^- punkt a$/m);
    expect(result.content).toMatch(/^- punkt b$/m);
  });

  test('linki i karty gier tylko do wskazanych (allowedIds) identyfikatorów', () => {
    const content = 'Zobacz [dobra](/games/5) oraz [zła](/games/999) gra, i [obcy](https://evil.example).\n\n[[game:5]]\n\n[[game:999]]';
    const result = w.finalize({ title: 't', excerpt: 'e', tags: [], content }, { allowedIds: ['5'], limits: LIMITS, parseTags });
    expect(result.content).toContain('[dobra](/games/5)');
    expect(result.content).toContain('[[game:5]]');
    expect(result.content).not.toContain('/games/999');
    expect(result.content).not.toContain('[[game:999]]');
    expect(result.content).not.toContain('evil.example');
  });

  test('liczy znaczniki [UZUPEŁNIJ: ...] pozostałe w treści', () => {
    const result = w.finalize({ title: 't', excerpt: 'e', tags: [], content: 'a [UZUPEŁNIJ: x] b [uzupelnij: y] c' }, { allowedIds: [], limits: LIMITS, parseTags });
    expect(result.placeholders).toBe(2);
  });

  test('stripPlaceholders: true usuwa znaczniki [UZUPEŁNIJ: ...] i puste po nich akapity', () => {
    const content = 'Dobry akapit z treścią.\n\n[UZUPEŁNIJ: cały akapit do wypełnienia]\n\n## Śródtytuł\n\nZdanie z [UZUPEŁNIJ: drobnym uzupełnieniem] w środku.';
    const result = w.finalize({ title: 't', excerpt: 'e', tags: [], content }, { allowedIds: [], limits: LIMITS, parseTags, stripPlaceholders: true });
    expect(result.placeholders).toBe(0);
    expect(result.content).not.toMatch(/UZUPE[ŁL]NIJ/i);
    expect(result.content).toContain('## Śródtytuł');
  });

  test('treść dłuższa niż limit jest ucinana na granicy akapitu', () => {
    const huge = ('Akapit testowy z treścią. '.repeat(20) + '\n\n').repeat(50);
    const result = w.finalize({ title: 't', excerpt: 'e', tags: [], content: huge }, { allowedIds: [], limits: { ...LIMITS, content: 500 }, parseTags });
    expect(result.content.length).toBeLessThanOrEqual(500);
  });

  test('pusta treść po czyszczeniu nie wywraca funkcji', () => {
    const result = w.finalize({ title: 't', excerpt: 'e', tags: [], content: '' }, { allowedIds: [], limits: LIMITS, parseTags });
    expect(result.content).toBe('');
  });
});
