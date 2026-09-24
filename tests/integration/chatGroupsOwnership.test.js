const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent } = require('../setup/factories');

// Uprawnienia w grupach i pokojach: kto może usunąć/wyczyścić rozmowę, opuszczenie grupy, przekazanie własności.
describe('czat - własność i opuszczanie grup', () => {
  let ctx;
  let owner;
  let m1;
  let m2;
  const Conversation = () => require('../../models/Conversation');

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await userAgent(ctx.app, { username: 'wlasc1' });
    m1 = await userAgent(ctx.app, { username: 'czlonek1' });
    m2 = await userAgent(ctx.app, { username: 'czlonek2' });
    for (const other of [m1, m2]) {
      let token = await csrfToken(owner.agent, `/${other.user.username}`);
      await owner.agent.post(`/profile/follow/${other.user.username}`).send({ _csrf: token });
      token = await csrfToken(other.agent, `/${owner.user.username}`);
      await other.agent.post(`/profile/follow/${owner.user.username}`).send({ _csrf: token });
    }
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  async function post(who, path, body = {}) {
    const token = await csrfToken(who.agent, '/chat');
    return who.agent.post(path).send({ ...body, _csrf: token }).redirects(0);
  }

  // Grupa właściciela z podanymi członkami, którzy od razu akceptują zaproszenie.
  async function newGroup(name, members) {
    const res = await post(owner, '/chat/groups/new', { name, memberIds: members.map((m) => m.user.id) });
    const id = res.headers.location.split('c=')[1];
    for (const m of members) await post(m, `/chat/invites/${id}/accept`);
    return id;
  }

  test('zwykły członek nie może usunąć ani wyczyścić grupy - robi to tylko właściciel', async () => {
    const id = await newGroup('Chroniona przed usunięciem', [m1]);

    await post(m1, `/chat/${id}/delete`);
    expect(await Conversation().findByPk(id)).not.toBeNull();

    // Wiadomość właściciela nie znika po "wyczyść" wykonanym przez zwykłego członka.
    let token = await csrfToken(owner.agent, `/chat?c=${id}`);
    await owner.agent.post(`/chat/${id}/messages`).set('Accept', 'application/json').send({ text: 'Zostaje', _csrf: token });
    await post(m1, `/chat/${id}/clear`);
    const Message = require('../../models/Message');
    expect(await Message.count({ where: { conversationId: id } })).toBe(1);

    await post(owner, `/chat/${id}/clear`);
    expect(await Message.count({ where: { conversationId: id } })).toBe(0);

    await post(owner, `/chat/${id}/delete`);
    expect(await Conversation().findByPk(id)).toBeNull();
  });

  test('rozmowa prywatna: każda ze stron może ją usunąć (bez zmian)', async () => {
    const start = await post(owner, `/chat/start/${m1.user.username}`);
    const id = start.headers.location.split('c=')[1];
    await post(m1, `/chat/${id}/delete`);
    expect(await Conversation().findByPk(id)).toBeNull();
  });

  test('widok czatu pokazuje tylko dozwolone przyciski: członek - opuszczenie, właściciel - usuwanie i przekazanie własności', async () => {
    const id = await newGroup('Widok uprawnień', [m1]);

    const asMember = (await m1.agent.get(`/chat?c=${id}`)).text;
    expect(asMember).toContain(`/chat/${id}/leave`);
    expect(asMember).not.toContain(`/chat/${id}/delete`);
    expect(asMember).not.toContain(`/chat/${id}/clear`);
    expect(asMember).not.toContain('/transfer/');

    const asOwner = (await owner.agent.get(`/chat?c=${id}`)).text;
    expect(asOwner).toContain(`/chat/${id}/leave`);
    expect(asOwner).toContain(`/chat/${id}/delete`);
    expect(asOwner).toContain(`/chat/${id}/clear`);
    expect(asOwner).toContain(`/chat/${id}/transfer/${m1.user.id}`);
  });

  test('członek może opuścić grupę - grupa zostaje, on traci dostęp', async () => {
    const id = await newGroup('Do opuszczenia', [m1, m2]);
    await post(m1, `/chat/${id}/leave`);

    const conv = await Conversation().findByPk(id);
    expect(JSON.parse(conv.memberIds)).not.toContain(m1.user.id);
    expect(JSON.parse(conv.memberIds)).toContain(m2.user.id);
    expect(conv.ownerId).toBe(owner.user.id);
    expect((await m1.agent.get(`/chat/${id}/messages`)).status).toBe(403);
  });

  test('właściciel wychodząc z grupy przekazuje własność najdłużej będącemu członkowi', async () => {
    const id = await newGroup('Właściciel wychodzi', [m1, m2]);
    await post(owner, `/chat/${id}/leave`);

    const conv = await Conversation().findByPk(id);
    expect(JSON.parse(conv.memberIds)).not.toContain(owner.user.id);
    expect(conv.ownerId).toBe(m1.user.id);
  });

  test('ostatnia osoba wychodząca z grupy usuwa ją', async () => {
    const id = await newGroup('Ostatni gasi światło', [m1]);
    await post(m1, `/chat/${id}/leave`);
    await post(owner, `/chat/${id}/leave`);
    expect(await Conversation().findByPk(id)).toBeNull();
  });

  test('przekazanie własności: tylko właściciel, tylko członkowi; nowy właściciel dostaje uprawnienia', async () => {
    const id = await newGroup('Zmiana warty', [m1, m2]);

    // Zwykły członek nie może nikomu przekazać własności.
    await post(m1, `/chat/${id}/transfer/${m2.user.id}`);
    expect((await Conversation().findByPk(id)).ownerId).toBe(owner.user.id);

    // Osobie spoza grupy też nie.
    const outsider = await userAgent(ctx.app, { username: 'spozagrupy' });
    await post(owner, `/chat/${id}/transfer/${outsider.user.id}`);
    expect((await Conversation().findByPk(id)).ownerId).toBe(owner.user.id);

    await post(owner, `/chat/${id}/transfer/${m1.user.id}`);
    expect((await Conversation().findByPk(id)).ownerId).toBe(m1.user.id);

    // Dawny właściciel nie zmieni już nazwy, nowy - tak.
    await post(owner, `/chat/${id}/rename`, { name: 'Próba dawnego właściciela' });
    expect((await Conversation().findByPk(id)).name).toBe('Zmiana warty');
    await post(m1, `/chat/${id}/rename`, { name: 'Nowy szef' });
    expect((await Conversation().findByPk(id)).name).toBe('Nowy szef');
  });
});
