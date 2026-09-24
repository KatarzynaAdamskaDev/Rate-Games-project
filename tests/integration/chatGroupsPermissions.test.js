const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent } = require('../setup/factories');

// Osobny plik (własny limiter logowania) od tests/integration/chatGroups.test.js.
describe('czat - grupy: uprawnienia nie-właściciela', () => {
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

  test('nie-właściciel nie może zapraszać do grupy ani zmieniać jej ustawień', async () => {
    const { agent: owner, user: ownerUser } = await userAgent(ctx.app, { username: 'permowner1' });
    const { agent: friend, user: friendUser } = await userAgent(ctx.app, { username: 'permfriend1' });
    const { user: stranger } = await userAgent(ctx.app, { username: 'permobcy1' });
    await follow(owner, friendUser.username);
    await follow(friend, ownerUser.username);

    let token = await csrfToken(owner, '/chat');
    const create = await owner.post('/chat/groups/new').send({ name: 'Chroniona grupa', memberIds: friendUser.id, _csrf: token });
    const conversationId = create.headers.location.split('c=')[1];
    token = await csrfToken(friend, '/chat');
    await friend.post(`/chat/invites/${conversationId}/accept`).send({ _csrf: token });

    const Conversation = require('../../models/Conversation');

    // Zapraszanie kolejnych osób - odrzucone, nic się nie zmienia.
    token = await csrfToken(friend, `/chat?c=${conversationId}`);
    const inviteRes = await friend.post(`/chat/${conversationId}/invite`).send({ memberIds: stranger.id, _csrf: token }).redirects(0);
    expect(inviteRes.status).toBe(302);
    expect(inviteRes.headers.location).not.toContain(conversationId);
    expect(JSON.parse((await Conversation.findByPk(conversationId)).pendingMemberIds)).toEqual([]);

    // Usuwanie innego członka - odrzucone.
    token = await csrfToken(friend, `/chat?c=${conversationId}`);
    await friend.post(`/chat/${conversationId}/members/${ownerUser.id}/remove`).send({ _csrf: token });
    expect(JSON.parse((await Conversation.findByPk(conversationId)).memberIds).sort()).toEqual([ownerUser.id, friendUser.id].sort());

    // Usuwanie zdjęcia grupy - odrzucone (nic nie było ustawione, ale trasa i tak musi odmówić nie-właścicielowi).
    token = await csrfToken(friend, `/chat?c=${conversationId}`);
    const photoRemoveRes = await friend.post(`/chat/${conversationId}/photo/remove`).send({ _csrf: token }).redirects(0);
    expect(photoRemoveRes.status).toBe(302);
    expect(photoRemoveRes.headers.location).not.toContain(conversationId);
  });
});
