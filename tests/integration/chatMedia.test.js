const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, adminAgent } = require('../setup/factories');

// Testy dla GIF-ów na czacie (Giphy) - osobny plik, bo tests/integration/chat.test.js jest
// już blisko limitu prób logowania z jednego IP (middleware/rateLimit.js, 20/15min) i każdy
// plik testowy dostaje własną, świeżą aplikację/limiter (patrz tests/setup/testApp.js).
describe('czat - GIF-y (Giphy)', () => {
  let ctx;
  let a; // agent userA
  let b; // agent userB
  let conversationId;

  beforeAll(async () => {
    ctx = await createTestApp();

    const userA = await userAgent(ctx.app, { username: 'gifnadawca' });
    const userB = await userAgent(ctx.app, { username: 'gifodbiorca' });
    a = userA.agent;
    b = userB.agent;

    let token = await csrfToken(a, `/${userB.user.username}`);
    await a.post(`/profile/follow/${userB.user.username}`).send({ _csrf: token });
    token = await csrfToken(b, `/${userA.user.username}`);
    await b.post(`/profile/follow/${userA.user.username}`).send({ _csrf: token });

    token = await csrfToken(a, '/chat');
    const start = await a.post(`/chat/start/${userB.user.username}`).send({ _csrf: token }).redirects(0);
    conversationId = start.headers.location.split('c=')[1];
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('wiadomość z poprawnym adresem GIF-a z CDN Giphy zapisuje się jako kind=gif', async () => {
    const token = await csrfToken(a, `/chat?c=${conversationId}`);
    const res = await a
      .post(`/chat/${conversationId}/messages`)
      .set('Accept', 'application/json')
      .send({ text: 'https://media.giphy.com/media/abc123/giphy.gif', kind: 'gif', _csrf: token });

    expect(res.status).toBe(200);
    expect(res.body.message.kind).toBe('gif');
    expect(res.body.message.text).toBe('https://media.giphy.com/media/abc123/giphy.gif');

    const Message = require('../../models/Message');
    const saved = await Message.findByPk(res.body.message.id);
    expect(saved.kind).toBe('gif');
  });

  test('adres spoza CDN Giphy jest odrzucany (ktoś mógłby próbować podesłać dowolny obrazek)', async () => {
    const Message = require('../../models/Message');
    const before = await Message.count({ where: { conversationId } });

    const token = await csrfToken(a, `/chat?c=${conversationId}`);
    const res = await a
      .post(`/chat/${conversationId}/messages`)
      .set('Accept', 'application/json')
      .send({ text: 'https://evil.example.com/tracker.gif', kind: 'gif', _csrf: token });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(await Message.count({ where: { conversationId } })).toBe(before);
  });

  test('/chat/api/list pokazuje w podglądzie ostatniej wiadomości "GIF", nie surowy adres URL', async () => {
    const list = await b.get('/chat/api/list').set('Accept', 'application/json');
    const conv = list.body.conversations.find((c) => c.id === conversationId);
    expect(conv.lastMessage.text).toBe('GIF');
  });

  test('GET /chat/gifs wymaga zalogowania', async () => {
    const res = await request(ctx.app).get('/chat/gifs?q=cat').redirects(0);
    expect(res.status).toBe(302);
  });

  test('GET /chat/gifs bez skonfigurowanego klucza API zwraca pustą listę zamiast błędu (scratch/CI bez GIPHY_API_KEY)', async () => {
    const res = await a.get('/chat/gifs?q=cat').set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body.gifs).toEqual([]);
  });
});
