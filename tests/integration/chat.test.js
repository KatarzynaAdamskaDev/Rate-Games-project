const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, adminAgent } = require('../setup/factories');

async function follow(agent, username, csrfPath) {
  const token = await csrfToken(agent, csrfPath || `/${username}`);
  return agent.post(`/profile/follow/${username}`).send({ _csrf: token });
}

describe('czat', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('zwykły użytkownik nie może napisać do kogoś, kto go nie obserwuje (brak wzajemności)', async () => {
    const { agent } = await userAgent(ctx.app, { username: 'nadawca1' });
    await userAgent(ctx.app, { username: 'odbiorca1' });

    const token = await csrfToken(agent, '/chat');
    const res = await agent.post('/chat/start/odbiorca1').send({ _csrf: token }).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/chat');

    const Conversation = require('../../models/Conversation');
    const count = await Conversation.count({ where: { type: 'dm' } });
    expect(count).toBe(0);
  });

  test('wzajemna obserwacja pozwala zwykłym użytkownikom rozpocząć rozmowę', async () => {
    const { agent: a, user: userA } = await userAgent(ctx.app, { username: 'wzajemnya' });
    const { agent: b, user: userB } = await userAgent(ctx.app, { username: 'wzajemnyb' });
    await follow(a, userB.username);
    await follow(b, userA.username);

    const token = await csrfToken(a, '/chat');
    const res = await a.post(`/chat/start/${userB.username}`).send({ _csrf: token }).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/chat\?c=/);
  });

  test('administrator może rozpocząć rozmowę bez wzajemnej obserwacji', async () => {
    const { agent } = await adminAgent(ctx.app);
    const { user: target } = await userAgent(ctx.app, { username: 'celadmina' });

    const token = await csrfToken(agent, '/chat');
    const res = await agent.post(`/chat/start/${target.username}`).send({ _csrf: token }).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/chat\?c=/);
  });

  test('panel admina: wiadomość bez możliwości odpowiedzi - odbiorca nie może odpisać, admin może', async () => {
    const { agent: admin, user: adminUser } = await adminAgent(ctx.app);
    const { agent: recipient, user: target } = await userAgent(ctx.app, { username: 'jednostronny' });

    const token = await csrfToken(admin, '/admin/users');
    const send = await admin.post(`/admin/users/${target.id}/message`).send({ text: 'Wiadomość od administracji, bez odpowiedzi.', _csrf: token });
    expect(send.status).toBe(302);
    expect(send.headers.location).toMatch(/^\/chat\?c=/);
    const conversationId = send.headers.location.split('c=')[1];

    const Conversation = require('../../models/Conversation');
    const conv = await Conversation.findByPk(conversationId);
    expect(conv.canReply).toBe(false);

    // Odbiorca widzi wiadomość...
    const page = await recipient.get(`/chat?c=${conversationId}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Wiadomość od administracji');
    expect(page.text).toContain('bez możliwości odpowiedzi');

    // ...ale nie może odpisać, nawet gdyby spreparował żądanie z poprawnym tokenem CSRF.
    const recipientToken = await csrfToken(recipient, `/chat?c=${conversationId}`);
    const reply = await recipient.post(`/chat/${conversationId}/messages`).set('Accept', 'application/json').send({ text: 'Próba odpowiedzi', _csrf: recipientToken });
    expect(reply.status).toBe(403);

    // Admin może dalej pisać w tej samej rozmowie.
    const adminToken = await csrfToken(admin, `/chat?c=${conversationId}`);
    const adminReply = await admin.post(`/chat/${conversationId}/messages`).set('Accept', 'application/json').send({ text: 'Kolejna wiadomość admina', _csrf: adminToken });
    expect(adminReply.status).toBe(200);
    expect(adminReply.body.message).toBeTruthy();
  });

  test('panel admina: wiadomość z możliwością odpowiedzi pozwala normalnie odpisać', async () => {
    const { agent: admin, user: adminUser } = await adminAgent(ctx.app);
    const { agent: recipient, user: target } = await userAgent(ctx.app, { username: 'dwustronny' });

    const token = await csrfToken(admin, '/admin/users');
    const send = await admin.post(`/admin/users/${target.id}/message`).send({ text: 'Wiadomość z możliwością odpowiedzi.', allowReply: 'on', _csrf: token });
    const conversationId = send.headers.location.split('c=')[1];

    const recipientToken = await csrfToken(recipient, `/chat?c=${conversationId}`);
    const reply = await recipient.post(`/chat/${conversationId}/messages`).set('Accept', 'application/json').send({ text: 'Dziękuję, odpisuję!', _csrf: recipientToken });
    expect(reply.status).toBe(200);
    expect(reply.body.message.text).toBe('Dziękuję, odpisuję!');
  });

  test('wiadomość do samego siebie z panelu admina jest odrzucana', async () => {
    const { agent, user } = await adminAgent(ctx.app);
    const Conversation = require('../../models/Conversation');
    const before = await Conversation.count();

    const token = await csrfToken(agent, '/admin/users');
    const res = await agent.post(`/admin/users/${user.id}/message`).send({ text: 'Do siebie', _csrf: token }).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).not.toMatch(/^\/chat/);
    expect(await Conversation.count()).toBe(before); // nic nowego nie powstało
  });

  test('zwykły użytkownik nie ma dostępu do wysyłania wiadomości z panelu admina', async () => {
    const { agent } = await userAgent(ctx.app, { username: 'niedostep' });
    const { user: target } = await userAgent(ctx.app, { username: 'celniedostep' });
    const res = await agent.post(`/admin/users/${target.id}/message`).send({ text: 'x' }).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).not.toMatch(/^\/chat/);
  });

  test('wysyłanie kolejnej wiadomości z panelu admina do tej samej osoby trafia do tej samej rozmowy (bez duplikowania)', async () => {
    const { agent } = await adminAgent(ctx.app);
    const { user: target } = await userAgent(ctx.app, { username: 'powtorka' });
    const Conversation = require('../../models/Conversation');
    const before = await Conversation.count({ where: { type: 'dm' } });

    let token = await csrfToken(agent, '/admin/users');
    const first = await agent.post(`/admin/users/${target.id}/message`).send({ text: 'Pierwsza wiadomość.', _csrf: token });
    token = await csrfToken(agent, '/admin/users');
    const second = await agent.post(`/admin/users/${target.id}/message`).send({ text: 'Druga wiadomość.', allowReply: 'on', _csrf: token });

    expect(first.headers.location).toBe(second.headers.location);
    expect(await Conversation.count({ where: { type: 'dm' } })).toBe(before + 1); // tylko jedna nowa rozmowa
  });

  test('/chat/api/list zwraca canReply dla każdej rozmowy (potrzebne do mini-czatu w navbarze)', async () => {
    const { agent: admin } = await adminAgent(ctx.app);
    const { agent: recipient, user: target } = await userAgent(ctx.app, { username: 'listacanreply' });

    const token = await csrfToken(admin, '/admin/users');
    await admin.post(`/admin/users/${target.id}/message`).send({ text: 'Test listy', _csrf: token });

    const list = await recipient.get('/chat/api/list').set('Accept', 'application/json');
    expect(list.status).toBe(200);
    const conv = list.body.conversations.find((c) => c.type === 'dm');
    expect(conv).toMatchObject({ canReply: false });
  });

  test('lista "napisz do gracza" na stronie czatu zawiera wszystkich użytkowników dla admina, a nie tylko znajomych', async () => {
    await userAgent(ctx.app, { username: 'kimkolwiek' });
    const { agent } = await adminAgent(ctx.app);
    const page = await agent.get('/chat');
    expect(page.status).toBe(200);
    expect(page.text).toContain('kimkolwiek');
    expect(page.text).toContain('Jako administrator możesz napisać do każdego użytkownika.');
  });
});
