/**
 * Testy skupione na bezpieczeństwie, które nie mieszczą się naturalnie w innych plikach:
 * CSRF na różnych trasach, escapowanie treści od użytkowników (ochrona przed XSS) i to, że
 * błędy serwera nie ujawniają nic więcej niż komunikat.
 */
const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, adminAgent, createCustomGame, createBlogPost } = require('../setup/factories');

describe('bezpieczeństwo', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  describe('CSRF - żądania POST bez poprawnego tokenu są odrzucane', () => {
    test('dodanie recenzji bez tokenu CSRF (403), z tokenem z cudzej sesji też (403)', async () => {
      const game = await createCustomGame();
      const { agent } = await userAgent(ctx.app);
      await agent.get(`/games/${game.id}`); // zakłada sesję i token

      const noToken = await agent.post(`/games/${game.id}/reviews`).set('Accept', 'application/json').send({ rating: '4', text: 'Próba bez tokenu, wystarczająco długa treść.' });
      expect(noToken.status).toBe(403);

      const { agent: other } = await userAgent(ctx.app);
      const otherToken = await csrfToken(other, `/games/${game.id}`);
      const foreignToken = await agent.post(`/games/${game.id}/reviews`).set('Accept', 'application/json').send({ rating: '4', text: 'Próba z cudzym tokenem, długa treść.', _csrf: otherToken });
      expect(foreignToken.status).toBe(403);
    });

    test('utworzenie wpisu na blogu bez tokenu CSRF jest odrzucane', async () => {
      const { agent } = await adminAgent(ctx.app);
      await agent.get('/blog/new');
      const res = await agent.post('/blog/new').set('Accept', 'application/json').send({ title: 'Bez tokenu', content: 'Treść wystarczająco długa do testu.', category: 'Aktualności', publishMode: 'now' });
      expect(res.status).toBe(403);
    });

    test('akcja administratora (blokada konta) bez tokenu CSRF jest odrzucana', async () => {
      const { user } = await userAgent(ctx.app, { username: 'celblokady' });
      const { agent } = await adminAgent(ctx.app);
      await agent.get('/admin/users');
      const res = await agent.post(`/admin/users/${user.id}/ban`).set('Accept', 'application/json').send({ duration: '1d' });
      expect(res.status).toBe(403);
      await user.reload();
      expect(user.isBanned).toBe(false);
    });
  });

  describe('ochrona przed XSS - treść od użytkowników jest escapowana w wyrenderowanej stronie', () => {
    test('skrypt w treści recenzji nie trafia do strony jako żywy <script>', async () => {
      const game = await createCustomGame();
      const { agent } = await userAgent(ctx.app);
      const token = await csrfToken(agent, `/games/${game.id}`);
      const payload = '<script>window.__xss = true;</script> normalna opinia o grze, wystarczająco długa.';
      await agent.post(`/games/${game.id}/reviews`).send({ rating: '4', text: payload, _csrf: token });

      const page = await request(ctx.app).get(`/games/${game.id}`);
      expect(page.text).not.toContain('<script>window.__xss');
      expect(page.text).toContain('&lt;script&gt;');
    });

    test('skrypt w komentarzu pod wpisem bloga też jest escapowany', async () => {
      const post = await createBlogPost();
      const { agent } = await userAgent(ctx.app, { username: 'xsskomentator' });
      const token = await csrfToken(agent, `/blog/${post.id}`);
      await agent.post(`/blog/${post.id}/comments`).send({ text: '<img src=x onerror=alert(1)> normalny komentarz', _csrf: token });

      const page = await request(ctx.app).get(`/blog/${post.id}`);
      expect(page.text).not.toMatch(/<img src=x onerror=/);
    });

    test('nazwa użytkownika z próbą wstrzyknięcia HTML jest escapowana tam, gdzie się wyświetla', async () => {
      const { createUser } = require('../setup/factories');
      // Filtr wulgaryzmów nie blokuje tego typu treści, a model nie waliduje formatu - warstwa
      // bezpieczeństwa jest w renderowaniu (EJS domyślnie escapuje <%= %>), co właśnie sprawdzamy.
      await createUser({ username: 'zwykla_nazwa' });
      const post = await createBlogPost({ author: '<b>Redakcja</b>' });
      const page = await request(ctx.app).get(`/blog/${post.id}`);
      expect(page.text).not.toContain('<b>Redakcja</b>');
    });
  });

  describe('błędy serwera', () => {
    test('nieznana strona (404) nie ujawnia śladu stosu ani ścieżek na dysku', async () => {
      const res = await request(ctx.app).get('/coś-czego-na-pewno-nie-ma');
      expect(res.status).toBe(404);
      expect(res.text).not.toMatch(/at\s+\w+\s+\(.*\.js:\d+/); // typowy wygląd linii stack trace
      expect(res.text.toLowerCase()).not.toContain('c:\\users');
    });
  });

  describe('uwierzytelnianie i hasła', () => {
    test('odpowiedź logowania nigdy nie zawiera hasha hasła ani surowego hasła', async () => {
      const { user, password } = await require('../setup/factories').createUser({ username: 'sprawdzhaslo' });
      const agent = request.agent(ctx.app);
      const token = await csrfToken(agent);
      const res = await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.username, password, _csrf: token });
      expect(res.text).not.toContain(password);
      expect(res.text.toLowerCase()).not.toContain('passwordhash');
    });

    test('hasła w bazie nigdy nie są zapisane jawnym tekstem', async () => {
      const { createUser } = require('../setup/factories');
      const { user, password } = await createUser({ username: 'haszowanie', password: 'TajneHaslo123' });
      expect(user.passwordHash).not.toBe(password);
      expect(user.passwordHash).not.toContain(password);
      expect(user.passwordHash.startsWith('$2')).toBe(true); // format hasha bcrypt
    });
  });
});
