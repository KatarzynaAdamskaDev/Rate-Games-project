const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent } = require('../setup/factories');

// Zaproszenia do grup (link z powiadomienia, karta zaproszenia, widok listy/rozmowy na wąskich ekranach),
// powiadomienia o usunięciu rozmowy/grupy i likwidacja pokojów gier.
describe('czat - zaproszenia, powiadomienia o usunięciu, brak pokojów gier', () => {
  let ctx;
  let owner;
  let friend;
  let stranger;
  const Notification = () => require('../../models/Notification');
  const Conversation = () => require('../../models/Conversation');

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await userAgent(ctx.app, { username: 'zapwlasciciel' });
    friend = await userAgent(ctx.app, { username: 'zapznajomy' });
    stranger = await userAgent(ctx.app, { username: 'zapobcy' });

    let token = await csrfToken(owner.agent, `/${friend.user.username}`);
    await owner.agent.post(`/profile/follow/${friend.user.username}`).send({ _csrf: token });
    token = await csrfToken(friend.agent, `/${owner.user.username}`);
    await friend.agent.post(`/profile/follow/${owner.user.username}`).send({ _csrf: token });
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  async function post(who, path, body = {}) {
    const token = await csrfToken(who.agent, '/chat');
    return who.agent.post(path).send({ ...body, _csrf: token }).redirects(0);
  }

  async function newInvitedGroup(name) {
    const res = await post(owner, '/chat/groups/new', { name, memberIds: [friend.user.id] });
    return res.headers.location.split('c=')[1];
  }

  test('powiadomienie o zaproszeniu prowadzi do tego zaproszenia (?invite=), a nie do ostatniej rozmowy', async () => {
    const groupId = await newInvitedGroup('Ekipa od zaproszeń');
    const notification = await Notification().findOne({ where: { userId: friend.user.id, type: 'group-invite' } });
    expect(notification.link).toBe(`/chat?invite=${groupId}`);
  });

  test('link z powiadomienia pokazuje kartę zaproszenia: kto zaprasza, do jakiej grupy, z przyciskami dołączenia i odrzucenia', async () => {
    const groupId = await newInvitedGroup('Karta zaproszenia');
    // Zwykle /chat otwiera ostatnią rozmowę - zaproszona osoba ma jedną, żeby to sprawdzić.
    await post(friend, `/chat/start/${owner.user.username}`);

    const page = await friend.agent.get(`/chat?invite=${groupId}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('gv-invite-card');
    expect(page.text).toContain('Karta zaproszenia');
    expect(page.text).toContain('zapwlasciciel</b> zaprasza Cię do tej grupy');
    expect(page.text).toContain(`/chat/invites/${groupId}/accept`);
    expect(page.text).toContain(`/chat/invites/${groupId}/decline`);
    // zamiast rozmowy jest karta: nie ma okna wiadomości
    expect(page.text).not.toContain('id="chatBody"');
    expect(page.text).toContain('data-view="chat"');
  });

  test('cudze zaproszenie (albo nieistniejące) nie pokazuje karty - zwykły widok czatu', async () => {
    const groupId = await newInvitedGroup('Nie dla obcego');
    const page = await stranger.agent.get(`/chat?invite=${groupId}`);
    expect(page.text).not.toContain('gv-invite-card');
    expect(page.text).not.toContain('Nie dla obcego');
  });

  test('bez wybranej rozmowy widok to lista (wąskie ekrany), z rozmową - czat; przycisk powrotu jest w obu', async () => {
    const dm = await post(owner, `/chat/start/${friend.user.username}`);
    const id = dm.headers.location.split('c=')[1];

    const list = await owner.agent.get('/chat');
    expect(list.text).toContain('data-view="list"');
    expect(list.text).toContain('id="dmUsername"'); // wyszukiwarka graczy jest w liście

    const chat = await owner.agent.get(`/chat?c=${id}`);
    expect(chat.text).toContain('data-view="chat"');
    expect(chat.text).toContain('gv-chat-back');
  });

  test('zaproszenia na liście są klikalne, a przyciski mają kolory (dołącz / odrzuć)', async () => {
    const groupId = await newInvitedGroup('Kolorowe przyciski');
    const page = await friend.agent.get('/chat');
    expect(page.text).toContain(`href="/chat?invite=${groupId}"`);
    expect(page.text).toContain('gv-invite-btn gv-invite-accept');
    expect(page.text).toContain('gv-invite-btn gv-invite-decline');
  });

  test('usunięcie rozmowy prywatnej powiadamia drugą stronę, ale nie usuwającego', async () => {
    const start = await post(owner, `/chat/start/${friend.user.username}`);
    const id = start.headers.location.split('c=')[1];
    await post(friend, `/chat/${id}/delete`);

    const forOwner = await Notification().findOne({ where: { userId: owner.user.id, type: 'chat-deleted' } });
    expect(forOwner.message).toBe('zapznajomy usunął(-ęła) Waszą prywatną rozmowę');
    expect(forOwner.link).toBe('/chat');
    expect(await Notification().count({ where: { userId: friend.user.id, type: 'chat-deleted' } })).toBe(0);
    expect(await Conversation().findByPk(id)).toBeNull();
  });

  test('usunięcie grupy przez właściciela powiadamia członków (kolejne usunięcia nie są zlewane w jedno)', async () => {
    const first = await newInvitedGroup('Grupa do usunięcia A');
    await post(friend, `/chat/invites/${first}/accept`);
    await post(owner, `/chat/${first}/delete`);

    const second = await newInvitedGroup('Grupa do usunięcia B');
    await post(friend, `/chat/invites/${second}/accept`);
    await post(owner, `/chat/${second}/delete`);

    const rows = await Notification().findAll({ where: { userId: friend.user.id, type: 'chat-deleted' } });
    const messages = rows.map((r) => r.message).sort();
    expect(messages).toContain('zapwlasciciel usunął(-ęła) grupę „Grupa do usunięcia A”');
    expect(messages).toContain('zapwlasciciel usunął(-ęła) grupę „Grupa do usunięcia B”');
  });

  test('członek, który nie jest właścicielem, nie usuwa grupy i nikt nie dostaje powiadomienia', async () => {
    const id = await newInvitedGroup('Chroniona grupa');
    await post(friend, `/chat/invites/${id}/accept`);
    const before = await Notification().count({ where: { type: 'chat-deleted' } });

    await post(friend, `/chat/${id}/delete`);
    expect(await Conversation().findByPk(id)).not.toBeNull();
    expect(await Notification().count({ where: { type: 'chat-deleted' } })).toBe(before);
  });

  test('usunięty z grupy dostaje powiadomienie z nazwą grupy', async () => {
    const id = await newInvitedGroup('Grupa z wyrzuceniem');
    await post(friend, `/chat/invites/${id}/accept`);
    await post(owner, `/chat/${id}/members/${friend.user.id}/remove`);

    const note = await Notification().findOne({
      where: { userId: friend.user.id, type: 'chat-deleted', message: 'zapwlasciciel usunął(-ęła) Cię z grupy „Grupa z wyrzuceniem”' },
    });
    expect(note).not.toBeNull();
  });

  test('można wyłączyć to powiadomienie w ustawieniach (jest na liście rodzajów powiadomień)', async () => {
    const { NOTIFICATION_TYPES } = require('../../utils/notificationPrefs');
    expect(NOTIFICATION_TYPES.map((t) => t.id)).toContain('chat-deleted');
  });

  test('pokoje gier nie istnieją: adres /chat/rooms/... nie tworzy niczego, a strona czatu ich nie oferuje', async () => {
    const res = await owner.agent.get('/chat/rooms/cokolwiek').redirects(0);
    expect(res.status).toBe(404);

    const page = await owner.agent.get('/chat');
    expect(page.text).not.toContain('Pokoje gier');
    expect(page.text).not.toContain('/chat/rooms/');
  });

  test('pokoje gier pozostałe w bazie po starej wersji są usuwane przy starcie razem z wiadomościami', async () => {
    const Message = require('../../models/Message');
    const { removeGameRooms } = require('../../utils/chatHelpers');
    const room = await Conversation().create({
      type: 'game-room', name: '#stara-gra', gameId: 'stara-gra',
      memberIds: JSON.stringify([owner.user.id]), memberNames: JSON.stringify({ [owner.user.id]: 'zapwlasciciel' }),
    });
    await Message.create({ conversationId: room.id, senderId: owner.user.id, senderUsername: 'zapwlasciciel', text: 'Ślad po pokoju' });

    expect(await removeGameRooms()).toBe(1);
    expect(await Conversation().findByPk(room.id)).toBeNull();
    expect(await Message.count({ where: { conversationId: room.id } })).toBe(0);
    expect(await removeGameRooms()).toBe(0);
  });
});
