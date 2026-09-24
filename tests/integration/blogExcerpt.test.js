const { createTestApp } = require('../setup/testApp');

// Zajawka wpisu na liście bloga: bez znaczników wstawek ([[game:ID]] itd.), także dla wpisów zapisanych
// wcześniej ze znacznikiem w zajawce.
describe('blog - zajawki bez znaczników wstawek', () => {
  let ctx;
  let blog;

  const post = (overrides) => ({
    id: require('crypto').randomUUID(),
    title: 'Wpis do zajawki',
    author: 'Redakcja GameVerse',
    category: 'Aktualności',
    tags: [],
    excerpt: '',
    content: 'Treść.',
    coverImage: '/images/game-placeholder.svg',
    status: 'published',
    publishAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    blog = require('../../utils/blogHelpers');
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('bez własnej zajawki jej początek pochodzi z treści - bez karty gry w środku akapitu', async () => {
    const p = post({ content: 'czy gracze CS2 w ogóle wiedzą w co grają? [[game:242408]] odpowiadamy że tak! Ale nie zawsze potrafią wykorzystać swój mózg w grze.' });
    await blog.savePost(p);
    const saved = await blog.findPost(p.id);
    expect(saved.excerpt).not.toContain('[[game');
    expect(saved.excerpt).toContain('odpowiadamy że tak');
  });

  test('własna zajawka ze znacznikiem jest czyszczona przy zapisie', async () => {
    const p = post({ excerpt: 'Zajawka [[game:1]] ze znacznikiem' });
    await blog.savePost(p);
    expect((await blog.findPost(p.id)).excerpt).toBe('Zajawka ze znacznikiem');
  });

  test('wpis zapisany dawniej z surowym znacznikiem w bazie też wyświetla się czysto (czyszczenie przy odczycie)', async () => {
    const p = post({ excerpt: 'Zwykła zajawka' });
    await blog.savePost(p);
    const BlogPost = require('../../models/BlogPost');
    await BlogPost.update({ excerpt: 'stary tekst [[game:242408]] dalszy ciąg' }, { where: { id: p.id } });

    const fromDb = await blog.findPost(p.id);
    expect(fromDb.excerpt).toBe('stary tekst dalszy ciąg');
    const listed = (await blog.getPosts()).find((x) => x.id === p.id);
    expect(listed.excerpt).toBe('stary tekst dalszy ciąg');
  });
});
