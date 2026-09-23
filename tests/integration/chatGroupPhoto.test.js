const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent } = require('../setup/factories');

// Osobny plik (własny limiter logowania) od pozostałych testów grup w czacie.
describe('czat - zdjęcie grupy (upload)', () => {
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

  // Najmniejszy poprawny PNG (1x1, przezroczysty piksel) - tyle wystarczy sharp/imageSafety.js do przetworzenia.
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  let groupCounter = 0;
  async function createGroupWithFriend() {
    groupCounter += 1;
    const { agent: owner, user: ownerUser } = await userAgent(ctx.app, { username: `fotoowner${groupCounter}` });
    const { agent: friend, user: friendUser } = await userAgent(ctx.app, { username: `fotofriend${groupCounter}` });
    await follow(owner, friendUser.username);
    await follow(friend, ownerUser.username);

    const token = await csrfToken(owner, '/chat');
    const create = await owner.post('/chat/groups/new').send({ name: 'Grupa ze zdjęciem', memberIds: friendUser.id, _csrf: token });
    const conversationId = create.headers.location.split('c=')[1];
    return { owner, ownerUser, friend, friendUser, conversationId };
  }

  test('właściciel może wgrać prawdziwe zdjęcie grupy - zapisuje się i widać je na liście', async () => {
    const { owner, conversationId } = await createGroupWithFriend();

    const token = await csrfToken(owner, `/chat?c=${conversationId}`);
    const res = await owner
      .post(`/chat/${conversationId}/photo`)
      .field('_csrf', token)
      .attach('photo', TINY_PNG, 'photo.png')
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/chat?c=${conversationId}`);

    const Conversation = require('../../models/Conversation');
    const conv = await Conversation.findByPk(conversationId);
    expect(conv.photoUrl).toMatch(/^\/images\/chat\/groups\/.+\.webp$/);

    const page = await owner.get(`/chat?c=${conversationId}`);
    expect(page.text).toContain(conv.photoUrl);
  });

  test('plik, który nie jest obrazem, jest odrzucany - zdjęcie się nie zmienia', async () => {
    const { owner, conversationId } = await createGroupWithFriend();

    const token = await csrfToken(owner, `/chat?c=${conversationId}`);
    const res = await owner
      .post(`/chat/${conversationId}/photo`)
      .field('_csrf', token)
      .attach('photo', Buffer.from('to na pewno nie jest obrazem'), 'notimage.png')
      .redirects(0);

    expect(res.status).toBe(302);

    const Conversation = require('../../models/Conversation');
    expect((await Conversation.findByPk(conversationId)).photoUrl).toBeNull();
  });

  test('usunięcie zdjęcia grupy przez właściciela czyści photoUrl', async () => {
    const { owner, conversationId } = await createGroupWithFriend();

    let token = await csrfToken(owner, `/chat?c=${conversationId}`);
    await owner.post(`/chat/${conversationId}/photo`).field('_csrf', token).attach('photo', TINY_PNG, 'photo.png');

    const Conversation = require('../../models/Conversation');
    expect((await Conversation.findByPk(conversationId)).photoUrl).toBeTruthy();

    token = await csrfToken(owner, `/chat?c=${conversationId}`);
    await owner.post(`/chat/${conversationId}/photo/remove`).send({ _csrf: token });
    expect((await Conversation.findByPk(conversationId)).photoUrl).toBeNull();
  });
});
