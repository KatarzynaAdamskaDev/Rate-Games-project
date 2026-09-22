const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, adminAgent } = require('../setup/factories');

async function follow(agent, username, csrfPath) {
  const token = await csrfToken(agent, csrfPath || `/${username}`);
  return agent.post(`/profile/follow/${username}`).send({ _csrf: token });
}

describe('czat', () => {
  let ctx;
  let admin; // jeden wspólny agent administratora dla całego pliku - logowanie jest limitowane (rate limit /auth/signin)
  let adminUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    const created = await adminAgent(ctx.app);
    admin = created.agent;
    adminUser = created.user;
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
    const { user: target } = await userAgent(ctx.app, { username: 'celadmina' });

    const token = await csrfToken(admin, '/chat');
    const res = await admin.post(`/chat/start/${target.username}`).send({ _csrf: token }).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/chat\?c=/);
  });

  test('panel admina: nowa wiadomość zawsze pozwala odpisać, dopóki admin nie wyłączy tego w rozmowie', async () => {
    const { agent: recipient, user: target } = await userAgent(ctx.app, { username: 'jednostronny' });

    const token = await csrfToken(admin, '/admin/users');
    const send = await admin.post(`/admin/users/${target.id}/message`).send({ text: 'Wiadomość od administracji.', _csrf: token });
    expect(send.status).toBe(302);
    expect(send.headers.location).toMatch(/^\/chat\?c=/);
    const conversationId = send.headers.location.split('c=')[1];

    const Conversation = require('../../models/Conversation');
    expect((await Conversation.findByPk(conversationId)).canReply).toBe(true);

    // Admin wyłącza możliwość odpowiedzi bezpośrednio w rozmowie (jedyne miejsce, w którym da się to zrobić).
    const toggleToken = await csrfToken(admin, `/chat?c=${conversationId}`);
    const toggleOff = await admin.post(`/chat/${conversationId}/toggle-reply`).set('Accept', 'application/json').send({ _csrf: toggleToken });
    expect(toggleOff.status).toBe(200);
    expect(toggleOff.body.canReply).toBe(false);
    expect((await Conversation.findByPk(conversationId)).canReply).toBe(false);

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

    // Admin włącza z powrotem możliwość odpowiedzi - odbiorca znów może pisać.
    const toggleToken2 = await csrfToken(admin, `/chat?c=${conversationId}`);
    const toggleOn = await admin.post(`/chat/${conversationId}/toggle-reply`).set('Accept', 'application/json').send({ _csrf: toggleToken2 });
    expect(toggleOn.body.canReply).toBe(true);

    const recipientToken2 = await csrfToken(recipient, `/chat?c=${conversationId}`);
    const reply2 = await recipient.post(`/chat/${conversationId}/messages`).set('Accept', 'application/json').send({ text: 'Teraz mogę odpisać!', _csrf: recipientToken2 });
    expect(reply2.status).toBe(200);
    expect(reply2.body.message.text).toBe('Teraz mogę odpisać!');
  });

  test('toggle-reply: zwykły użytkownik nie może przełączać możliwości odpowiedzi', async () => {
    const { agent: outsider } = await userAgent(ctx.app, { username: 'niedostepdoprzelacznika' });
    const { user: target } = await userAgent(ctx.app, { username: 'celprzelacznika' });

    const token = await csrfToken(admin, '/admin/users');
    const send = await admin.post(`/admin/users/${target.id}/message`).send({ text: 'Wiadomość testowa.', _csrf: token });
    const conversationId = send.headers.location.split('c=')[1];

    const outsiderToken = await csrfToken(outsider, '/chat');
    const res = await outsider.post(`/chat/${conversationId}/toggle-reply`).set('Accept', 'application/json').send({ _csrf: outsiderToken });
    expect(res.status).toBe(403);

    const Conversation = require('../../models/Conversation');
    expect((await Conversation.findByPk(conversationId)).canReply).toBe(true); // bez zmian
  });

  test('toggle-reply: nie działa na rozmowach grupowych ani gdy admin nie jest członkiem rozmowy', async () => {
    const { agent: a, user: userA } = await userAgent(ctx.app, { username: 'grupowya' });
    const { agent: b, user: userB } = await userAgent(ctx.app, { username: 'grupowyb' });
    await follow(a, userB.username);
    await follow(b, userA.username);

    // Grupa dwuosobowa (właściciel + jeden znajomy) - toggle-reply nie działa na grupach.
    const groupToken = await csrfToken(a, '/chat');
    const groupRes = await a.post('/chat/groups/new').send({ name: 'Grupa testowa', memberIds: userB.id, _csrf: groupToken }).redirects(0);
    const groupId = groupRes.headers.location.split('c=')[1];

    const adminToken = await csrfToken(admin, '/chat');
    const onGroup = await admin.post(`/chat/${groupId}/toggle-reply`).set('Accept', 'application/json').send({ _csrf: adminToken });
    expect(onGroup.status).toBe(404); // to nie jest DM

    // Rozmowa DM, w której admin nie bierze udziału - też 404 (musi być stroną rozmowy).
    const dmToken = await csrfToken(a, '/chat');
    const dmRes = await a.post(`/chat/start/${userB.username}`).send({ _csrf: dmToken }).redirects(0);
    const dmId = dmRes.headers.location.split('c=')[1];

    const adminToken2 = await csrfToken(admin, '/chat');
    const onForeignDm = await admin.post(`/chat/${dmId}/toggle-reply`).set('Accept', 'application/json').send({ _csrf: adminToken2 });
    expect(onForeignDm.status).toBe(404);
  });

  test('wiadomość do samego siebie z panelu admina jest odrzucana', async () => {
    const Conversation = require('../../models/Conversation');
    const before = await Conversation.count();

    const token = await csrfToken(admin, '/admin/users');
    const res = await admin.post(`/admin/users/${adminUser.id}/message`).send({ text: 'Do siebie', _csrf: token }).redirects(0);
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
    const { user: target } = await userAgent(ctx.app, { username: 'powtorka' });
    const Conversation = require('../../models/Conversation');
    const before = await Conversation.count({ where: { type: 'dm' } });

    let token = await csrfToken(admin, '/admin/users');
    const first = await admin.post(`/admin/users/${target.id}/message`).send({ text: 'Pierwsza wiadomość.', _csrf: token });
    token = await csrfToken(admin, '/admin/users');
    const second = await admin.post(`/admin/users/${target.id}/message`).send({ text: 'Druga wiadomość.', _csrf: token });

    expect(first.headers.location).toBe(second.headers.location);
    expect(await Conversation.count({ where: { type: 'dm' } })).toBe(before + 1); // tylko jedna nowa rozmowa
  });

  test('/chat/api/list zwraca canReply dla każdej rozmowy (potrzebne do mini-czatu w navbarze)', async () => {
    const { agent: recipient, user: target } = await userAgent(ctx.app, { username: 'listacanreply' });

    const token = await csrfToken(admin, '/admin/users');
    const send = await admin.post(`/admin/users/${target.id}/message`).send({ text: 'Test listy', _csrf: token });
    const conversationId = send.headers.location.split('c=')[1];
    const toggleToken = await csrfToken(admin, `/chat?c=${conversationId}`);
    await admin.post(`/chat/${conversationId}/toggle-reply`).send({ _csrf: toggleToken });

    const list = await recipient.get('/chat/api/list').set('Accept', 'application/json');
    expect(list.status).toBe(200);
    const conv = list.body.conversations.find((c) => c.type === 'dm');
    expect(conv).toMatchObject({ canReply: false });
  });

  test('lista "napisz do gracza" na stronie czatu zawiera wszystkich użytkowników dla admina, a nie tylko znajomych', async () => {
    await userAgent(ctx.app, { username: 'kimkolwiek' });
    const page = await admin.get('/chat');
    expect(page.status).toBe(200);
    expect(page.text).toContain('kimkolwiek');
    expect(page.text).toContain('Jako administrator możesz napisać do każdego użytkownika.');
  });

  test('/notifications/summary liczy nieprzeczytane wiadomości poprawnie z kilku rozmów naraz (getUnreadCounts - jedno zapytanie z GROUP BY)', async () => {
    const { agent: nina, user: ninaUser } = await userAgent(ctx.app, { username: 'ninaliczniki' });
    const { agent: kuba, user: kubaUser } = await userAgent(ctx.app, { username: 'kubaliczniki' });
    await follow(nina, kubaUser.username);
    await follow(kuba, ninaUser.username);

    // Rozmowa 1: kuba -> nina (2 wiadomości).
    let token = await csrfToken(kuba, '/chat');
    const start = await kuba.post(`/chat/start/${ninaUser.username}`).send({ _csrf: token }).redirects(0);
    const conv1 = start.headers.location.split('c=')[1];
    token = await csrfToken(kuba, `/chat?c=${conv1}`);
    await kuba.post(`/chat/${conv1}/messages`).set('Accept', 'application/json').send({ text: 'Pierwsza', _csrf: token });
    token = await csrfToken(kuba, `/chat?c=${conv1}`);
    await kuba.post(`/chat/${conv1}/messages`).set('Accept', 'application/json').send({ text: 'Druga', _csrf: token });

    // Rozmowa 2: admin -> nina (1 wiadomość), niezależna od pierwszej, z innym progiem "od kiedy nieprzeczytane".
    token = await csrfToken(admin, '/admin/users');
    const send2 = await admin.post(`/admin/users/${ninaUser.id}/message`).send({ text: 'Wiadomość od admina', _csrf: token });
    const conv2 = send2.headers.location.split('c=')[1];

    // Własne wiadomości nie liczą się jako nieprzeczytane u nadawcy.
    const kubaSummary = await kuba.get('/notifications/summary').set('Accept', 'application/json');
    expect(kubaSummary.body.messages).toBe(0);

    // Nina ma łącznie 3 nieprzeczytane (2 + 1) z dwóch różnych rozmów.
    const ninaSummary = await nina.get('/notifications/summary').set('Accept', 'application/json');
    expect(ninaSummary.status).toBe(200);
    expect(ninaSummary.body.messages).toBe(3);

    // Otwarcie tylko pierwszej rozmowy oznacza ją jako przeczytaną, druga zostaje nieprzeczytana.
    const opened = await nina.get(`/chat?c=${conv1}`);
    expect(opened.status).toBe(200);

    const ninaSummaryAfter = await nina.get('/notifications/summary').set('Accept', 'application/json');
    expect(ninaSummaryAfter.body.messages).toBe(1);
  });
});
