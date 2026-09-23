const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, adminAgent } = require('../setup/factories');

// Testy grup w czacie (zaproszenia, akceptacja/odrzucenie, zarządzanie przez właściciela) - osobny
// plik od tests/integration/chat.test.js, żeby nie zbliżać się do limitu prób logowania z jednego IP.
describe('czat - grupy z zaproszeniami', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  async function follow(agent, username) {
    const token = await csrfToken(agent, `/${username}`);
    return agent.post(`/profile/follow/${username}`).send({ _csrf: token });
  }

  async function mutualPair(usernameA, usernameB) {
    const { agent: a, user: userA } = await userAgent(ctx.app, { username: usernameA });
    const { agent: b, user: userB } = await userAgent(ctx.app, { username: usernameB });
    await follow(a, userB.username);
    await follow(b, userA.username);
    return { a, userA, b, userB };
  }

  test('tworzenie grupy: właściciel jest od razu członkiem, zaproszeni trafiają do "oczekujących", nie do członków', async () => {
    const { a: owner, userA: ownerUser, b: friend, userB: friendUser } = await mutualPair('grupaowner1', 'grupafriend1');

    const token = await csrfToken(owner, '/chat');
    const res = await owner
      .post('/chat/groups/new')
      .send({ name: 'Ekipa RPG', memberIds: friendUser.id, _csrf: token })
      .redirects(0);

    expect(res.status).toBe(302);
    const conversationId = res.headers.location.split('c=')[1];

    const Conversation = require('../../models/Conversation');
    const conv = await Conversation.findByPk(conversationId);
    expect(JSON.parse(conv.memberIds)).toEqual([ownerUser.id]);
    expect(JSON.parse(conv.pendingMemberIds)).toEqual([friendUser.id]);

    // Zaproszony nie ma jeszcze dostępu do rozmowy.
    const friendMessagesRes = await friend.get(`/chat/${conversationId}/messages`);
    expect(friendMessagesRes.status).toBe(403);
  });

  test('do grupy da się zaprosić tylko wzajemnych znajomych - inni są pomijani', async () => {
    const { a: owner, b: friend, userB: friendUser } = await mutualPair('grupaowner2', 'grupafriend2');
    const { user: stranger } = await userAgent(ctx.app, { username: 'grupaobcy2' });

    const token = await csrfToken(owner, '/chat');
    const res = await owner
      .post('/chat/groups/new')
      .send({ name: 'Selektywna grupa', memberIds: [friendUser.id, stranger.id], _csrf: token })
      .redirects(0);

    const conversationId = res.headers.location.split('c=')[1];
    const Conversation = require('../../models/Conversation');
    const conv = await Conversation.findByPk(conversationId);
    expect(JSON.parse(conv.pendingMemberIds)).toEqual([friendUser.id]); // stranger pominięty
  });

  test('zaproszony może zaakceptować zaproszenie - dopiero wtedy trafia do grupy i dostaje dostęp', async () => {
    const { a: owner, userA: ownerUser, b: friend, userB: friendUser } = await mutualPair('grupaowner3', 'grupafriend3');

    let token = await csrfToken(owner, '/chat');
    const create = await owner.post('/chat/groups/new').send({ name: 'Do akceptacji', memberIds: friendUser.id, _csrf: token });
    const conversationId = create.headers.location.split('c=')[1];

    // Zaproszenie widoczne na liście "Zaproszenia" na stronie czatu.
    const chatPage = await friend.get('/chat');
    expect(chatPage.text).toContain('Do akceptacji');
    expect(chatPage.text).toContain(`/chat/invites/${conversationId}/accept`);

    token = await csrfToken(friend, '/chat');
    const acceptRes = await friend.post(`/chat/invites/${conversationId}/accept`).send({ _csrf: token }).redirects(0);
    expect(acceptRes.status).toBe(302);
    expect(acceptRes.headers.location).toBe(`/chat?c=${conversationId}`);

    const Conversation = require('../../models/Conversation');
    const conv = await Conversation.findByPk(conversationId);
    expect(JSON.parse(conv.memberIds).sort()).toEqual([ownerUser.id, friendUser.id].sort());
    expect(JSON.parse(conv.pendingMemberIds)).toEqual([]);

    const messagesRes = await friend.get(`/chat/${conversationId}/messages`);
    expect(messagesRes.status).toBe(200);
  });

  test('zaproszony może odrzucić zaproszenie - nie trafia do grupy', async () => {
    const { a: owner, b: friend, userB: friendUser } = await mutualPair('grupaowner4', 'grupafriend4');

    let token = await csrfToken(owner, '/chat');
    const create = await owner.post('/chat/groups/new').send({ name: 'Do odrzucenia', memberIds: friendUser.id, _csrf: token });
    const conversationId = create.headers.location.split('c=')[1];

    token = await csrfToken(friend, '/chat');
    await friend.post(`/chat/invites/${conversationId}/decline`).send({ _csrf: token });

    const Conversation = require('../../models/Conversation');
    const conv = await Conversation.findByPk(conversationId);
    expect(JSON.parse(conv.pendingMemberIds)).toEqual([]);
    expect(JSON.parse(conv.memberIds)).not.toContain(friendUser.id);

    const messagesRes = await friend.get(`/chat/${conversationId}/messages`);
    expect(messagesRes.status).toBe(403);
  });

  test('powiadomienie o zaproszeniu do grupy trafia do zaproszonego', async () => {
    const { a: owner, b: friend, userB: friendUser } = await mutualPair('grupaowner5', 'grupafriend5');

    const token = await csrfToken(owner, '/chat');
    await owner.post('/chat/groups/new').send({ name: 'Grupa z powiadomieniem', memberIds: friendUser.id, _csrf: token });

    const Notification = require('../../models/Notification');
    const notif = await Notification.findOne({ where: { userId: friendUser.id, type: 'group-invite' } });
    expect(notif).toBeTruthy();
    expect(notif.message).toContain('Grupa z powiadomieniem');
  });

  test('tylko właściciel może zmienić nazwę grupy', async () => {
    const { a: owner, b: friend, userB: friendUser } = await mutualPair('grupaowner6', 'grupafriend6');

    let token = await csrfToken(owner, '/chat');
    const create = await owner.post('/chat/groups/new').send({ name: 'Stara nazwa', memberIds: friendUser.id, _csrf: token });
    const conversationId = create.headers.location.split('c=')[1];
    token = await csrfToken(friend, '/chat');
    await friend.post(`/chat/invites/${conversationId}/accept`).send({ _csrf: token });

    // Członek (nie właściciel) nie może zmienić nazwy.
    token = await csrfToken(friend, '/chat');
    const deniedRes = await friend.post(`/chat/${conversationId}/rename`).send({ name: 'Podmieniona przez członka', _csrf: token });
    const Conversation = require('../../models/Conversation');
    expect((await Conversation.findByPk(conversationId)).name).toBe('Stara nazwa');

    // Właściciel może.
    token = await csrfToken(owner, `/chat?c=${conversationId}`);
    await owner.post(`/chat/${conversationId}/rename`).send({ name: 'Nowa nazwa', _csrf: token });
    expect((await Conversation.findByPk(conversationId)).name).toBe('Nowa nazwa');
  });

  test('właściciel może usunąć członka z grupy - traci dostęp; sam siebie usunąć się nie da', async () => {
    const { a: owner, userA: ownerUser, b: friend, userB: friendUser } = await mutualPair('grupaowner7', 'grupafriend7');

    let token = await csrfToken(owner, '/chat');
    const create = await owner.post('/chat/groups/new').send({ name: 'Grupa do usuwania', memberIds: friendUser.id, _csrf: token });
    const conversationId = create.headers.location.split('c=')[1];
    token = await csrfToken(friend, '/chat');
    await friend.post(`/chat/invites/${conversationId}/accept`).send({ _csrf: token });

    token = await csrfToken(owner, `/chat?c=${conversationId}`);
    await owner.post(`/chat/${conversationId}/members/${friendUser.id}/remove`).send({ _csrf: token });

    const Conversation = require('../../models/Conversation');
    expect(JSON.parse((await Conversation.findByPk(conversationId)).memberIds)).toEqual([ownerUser.id]);
    expect((await friend.get(`/chat/${conversationId}/messages`)).status).toBe(403);

    // Właściciela nie da się usunąć.
    token = await csrfToken(owner, `/chat?c=${conversationId}`);
    await owner.post(`/chat/${conversationId}/members/${ownerUser.id}/remove`).send({ _csrf: token });
    expect(JSON.parse((await Conversation.findByPk(conversationId)).memberIds)).toEqual([ownerUser.id]);
  });

  test('właściciel może zaprosić kolejne osoby do istniejącej grupy (POST /invite), bez duplikowania już zaproszonych', async () => {
    const { a: owner, userA: ownerUser } = await mutualPair('grupaowner8', 'grupafriend8a');
    const { agent: friend2, user: friend2User } = await userAgent(ctx.app, { username: 'grupafriend8b' });
    await follow(owner, friend2User.username);
    await follow(friend2, ownerUser.username);

    let token = await csrfToken(owner, '/chat');
    const created = await owner.post('/chat/groups/new').send({ name: 'Rosnąca grupa', memberIds: friend2User.id, _csrf: token });
    const conversationId = created.headers.location.split('c=')[1];

    // Ponowne "zaproszenie" tej samej osoby (już oczekuje) nic nie dubluje.
    token = await csrfToken(owner, `/chat?c=${conversationId}`);
    const inviteRes = await owner.post(`/chat/${conversationId}/invite`).send({ memberIds: friend2User.id, _csrf: token }).redirects(0);
    expect(inviteRes.status).toBe(302);

    const Conversation = require('../../models/Conversation');
    const conv = await Conversation.findByPk(conversationId);
    expect(JSON.parse(conv.pendingMemberIds)).toEqual([friend2User.id]);
  });
});
