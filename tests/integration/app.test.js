const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { userAgent } = require('../setup/factories');

describe('aplikacja - podstawy', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('strona główna odpowiada 200 na świeżej, pustej bazie (bez kluczy IGDB)', async () => {
    const res = await request(ctx.app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('GameVerse');
  });

  test('gość widzi CTA logowania, a zalogowany - modal "Napisz recenzję" z wyszukiwarką gry', async () => {
    const guest = await request(ctx.app).get('/');
    expect(guest.text).toContain('Napisz swoją pierwszą recenzję');
    expect(guest.text).not.toContain('id="writeReviewModal"');

    const { agent } = await userAgent(ctx.app, { username: 'chcerecenzowac' });
    const loggedIn = await agent.get('/');
    expect(loggedIn.text).toContain('>Napisz recenzję<');
    expect(loggedIn.text).toContain('id="writeReviewModal"');
    expect(loggedIn.text).toContain('data-mode="select"');
  });

  test('nieznany adres zwraca własną stronę 404 (nie domyślną Expressa)', async () => {
    const res = await request(ctx.app).get('/nie-ma-takiej-strony-xyz');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Nie znaleziono strony');
  });

  test('ciasteczko sesji ma flagi HttpOnly i SameSite=Lax (ochrona przed XSS/CSRF)', async () => {
    const res = await request(ctx.app).get('/');
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('gv.sid='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  test('każda wyrenderowana strona ma token CSRF w <head> (do formularzy i żądań fetch)', async () => {
    const res = await request(ctx.app).get('/');
    expect(res.text).toMatch(/<meta name="csrf-token" content="[a-f0-9]+"\s*\/?>/);
  });

  test('robots.txt i sitemap.xml działają na pustej bazie', async () => {
    const robots = await request(ctx.app).get('/robots.txt');
    expect(robots.status).toBe(200);
    const sitemap = await request(ctx.app).get('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.text).toContain('<urlset');
  });
});
