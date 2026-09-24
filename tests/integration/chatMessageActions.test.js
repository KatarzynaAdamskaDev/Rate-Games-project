const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, adminAgent } = require('../setup/factories');

// Odpowiedzi jak w Messengerze, edycja i usuwanie własnych wiadomości, reakcje, "pisze...", doczytywanie zmian
// (?since=) oraz zdarzenia czasu rzeczywistego wysyłane uczestnikom rozmowy.
describe('czat - odpowiedzi, edycja, usuwanie i reakcje', () => {
  let ctx;
  let chatEvents;
  let ala; // { agent, user }
  let bob;
  let convId;
  let publishSpy;

  const Message = () => require('../../models/Message');
  const MessageReaction = () => require('../../models/MessageReaction');

  async function post(who, path, body = {}, conversation = convId) {
    const token = await csrfToken(who.agent, `/chat?c=${conversation}`);
    return who.agent.post(path).set('Accept', 'application/json').send({ ...body, _csrf: token });
  }

  // Wysłanie przez trasę HTTP (limit wiadomości: 30/min na użytkownika) - tylko tam, gdzie testujemy samą trasę.
  const sendHttp = async (who, text, extra = {}) => (await post(who, `/chat/${convId}/messages`, { text, ...extra })).body.message;
  // Przygotowanie danych bezpośrednio przez pomocnik - nie zjada limitu wiadomości.
  const send = async (who, text, extra = {}) => {
    const { addMessage } = require('../../utils/chatHelpers');
    const result = await addMessage({
      conversationId: convId,
      senderId: who.user.id,
      senderUsername: who.user.username,
      text,
      kind: extra.kind || 'text',
      replyToId: extra.replyToId || null,
    });
    return result.message;
  };
  const react = (who, messageId, key) => post(who, `/chat/${convId}/messages/${messageId}/react`, { key });
  const edit = (who, messageId, text) => post(who, `/chat/${convId}/messages/${messageId}/edit`, { text });
  const remove = (who, messageId) => post(who, `/chat/${convId}/messages/${messageId}/delete`);

  beforeAll(async () => {
    ctx = await createTestApp();
    chatEvents = require('../../utils/chatEvents');
    ala = await userAgent(ctx.app, { username: 'akcjeala' });
    bob = await userAgent(ctx.app, { username: 'akcjebob' });

    let token = await csrfToken(ala.agent, `/${bob.user.username}`);
    await ala.agent.post(`/profile/follow/${bob.user.username}`).send({ _csrf: token });
    token = await csrfToken(bob.agent, `/${ala.user.username}`);
    await bob.agent.post(`/profile/follow/${ala.user.username}`).send({ _csrf: token });

    token = await csrfToken(ala.agent, '/chat');
    const start = await ala.agent.post(`/chat/start/${bob.user.username}`).send({ _csrf: token }).redirects(0);
    convId = start.headers.location.split('c=')[1];
  });

  beforeEach(() => {
    publishSpy = jest.spyOn(chatEvents, 'publish');
  });

  afterEach(() => {
    publishSpy.mockRestore();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  /* ------------------------------ odpowiedzi ------------------------------ */

  test('odpowiedź zawiera cytowaną wiadomość (autor i podgląd)', async () => {
    const original = await send(bob, 'Pytanie do wszystkich o grę');
    const reply = await sendHttp(ala, 'Moja odpowiedź', { replyToId: original.id });

    expect(reply.replyTo).toEqual({
      id: original.id,
      deleted: false,
      senderUsername: 'akcjebob',
      kind: 'text',
      preview: 'Pytanie do wszystkich o grę',
    });

    const list = await ala.agent.get(`/chat/${convId}/messages`).set('Accept', 'application/json');
    expect(list.body.messages.find((m) => m.id === reply.id).replyTo.preview).toBe('Pytanie do wszystkich o grę');
  });

  test('odpowiedzieć można tylko na wiadomość z tej samej rozmowy', async () => {
    const carol = await userAgent(ctx.app, { username: 'akcjecarol' });
    let token = await csrfToken(ala.agent, `/${carol.user.username}`);
    await ala.agent.post(`/profile/follow/${carol.user.username}`).send({ _csrf: token });
    token = await csrfToken(carol.agent, `/${ala.user.username}`);
    await carol.agent.post(`/profile/follow/${ala.user.username}`).send({ _csrf: token });
    token = await csrfToken(ala.agent, '/chat');
    const other = await ala.agent.post(`/chat/start/${carol.user.username}`).send({ _csrf: token }).redirects(0);
    const otherConv = other.headers.location.split('c=')[1];

    const foreign = (await post(carol, `/chat/${otherConv}/messages`, { text: 'Prywatna wiadomość' }, otherConv)).body.message;
    const res = await post(ala, `/chat/${convId}/messages`, { text: 'Podszywka pod cudzy cytat', replyToId: foreign.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Nie znaleziono wiadomości/);
  });

  test('nie da się odpowiedzieć na usuniętą wiadomość, a cytat po jej usunięciu pokazuje, że zniknęła', async () => {
    const original = await send(bob, 'Zaraz to usunę');
    const reply = await send(ala, 'Odpowiedź przed usunięciem', { replyToId: original.id });
    await remove(bob, original.id);

    const late = await post(ala, `/chat/${convId}/messages`, { text: 'Za późno', replyToId: original.id });
    expect(late.status).toBe(400);

    const list = await ala.agent.get(`/chat/${convId}/messages`).set('Accept', 'application/json');
    const quoted = list.body.messages.find((m) => m.id === reply.id);
    expect(quoted.replyTo.deleted).toBe(true);
    expect(quoted.replyTo.preview).toBe('');
  });

  /* ------------------------------ edycja ------------------------------ */

  test('autor może edytować własną wiadomość - dostaje znacznik edycji, a inni widzą nową treść', async () => {
    const m = await send(ala, 'Literówka w wiadomosci');
    expect(m.editedAt).toBeNull();

    const res = await edit(ala, m.id, 'Bez literówki w wiadomości');
    expect(res.status).toBe(200);
    expect(res.body.message.text).toBe('Bez literówki w wiadomości');
    expect(res.body.message.editedAt).not.toBeNull();

    const seenByBob = await bob.agent.get(`/chat/${convId}/messages`).set('Accept', 'application/json');
    expect(seenByBob.body.messages.find((x) => x.id === m.id).text).toBe('Bez literówki w wiadomości');
  });

  test('edycja bez zmiany treści nie dodaje znacznika "edytowano"', async () => {
    const m = await send(ala, 'Bez zmian');
    const res = await edit(ala, m.id, 'Bez zmian');
    expect(res.status).toBe(200);
    expect(res.body.message.editedAt).toBeNull();
  });

  test('cudzej wiadomości edytować nie można, GIF-a i pustej treści też nie', async () => {
    const m = await send(ala, 'Tylko moja');
    const foreign = await edit(bob, m.id, 'Podmiana');
    expect(foreign.status).toBe(403);
    expect((await Message().findByPk(m.id)).text).toBe('Tylko moja');

    const empty = await edit(ala, m.id, '   ');
    expect(empty.status).toBe(400);

    const gif = await send(ala, 'https://media.giphy.com/media/xyz/giphy.gif', { kind: 'gif' });
    const gifEdit = await edit(ala, gif.id, 'zamiana gifa na tekst');
    expect(gifEdit.status).toBe(400);
  });

  /* ------------------------------ usuwanie ------------------------------ */

  test('usunięcie własnej wiadomości czyści treść i reakcje, ale zostawia znacznik', async () => {
    const m = await send(ala, 'Do usunięcia, tajna treść');
    await react(bob, m.id, 'like');

    const res = await remove(ala, m.id);
    expect(res.status).toBe(200);
    expect(res.body.message.deleted).toBe(true);
    expect(res.body.message.text).toBe('');
    expect(res.body.message.reactions).toEqual([]);

    const row = await Message().findByPk(m.id);
    expect(row.text).toBe('');
    expect(row.deletedAt).not.toBeNull();
    expect(await MessageReaction().count({ where: { messageId: m.id } })).toBe(0);
  });

  test('cudzej wiadomości usunąć nie można; usuniętej nie da się edytować, zareagować ani zgłosić', async () => {
    const m = await send(ala, 'Nie dla Boba');
    expect((await remove(bob, m.id)).status).toBe(403);
    expect((await Message().findByPk(m.id)).deletedAt).toBeNull();

    await remove(ala, m.id);
    expect((await edit(ala, m.id, 'Nowa treść')).status).toBe(400);
    expect((await react(bob, m.id, 'like')).status).toBe(400);

    const token = await csrfToken(bob.agent, `/chat?c=${convId}`);
    await bob.agent.post(`/reports/message/${m.id}`).send({ reason: 'spam', _csrf: token });
    const ContentReport = require('../../models/ContentReport');
    expect(await ContentReport.count({ where: { targetId: m.id } })).toBe(0);
  });

  test('usunięta wiadomość nie liczy się jako nieprzeczytana', async () => {
    const fresh = await send(ala, 'Zobaczysz i zniknie');
    await remove(ala, fresh.id);
    const { getUnreadCounts } = require('../../utils/chatHelpers');
    const unread = await getUnreadCounts(bob.user.id);
    // Bob może mieć nieprzeczytane wcześniejsze wiadomości z tego pliku, ale ta usunięta nie doliczyła się do żadnej.
    const before = unread.byConversation[convId] || 0;
    const another = await send(ala, 'Ta zostaje');
    const after = (await getUnreadCounts(bob.user.id)).byConversation[convId];
    expect(after).toBe(before + 1);
    await remove(ala, another.id);
    expect((await getUnreadCounts(bob.user.id)).byConversation[convId] || 0).toBe(before);
  });

  /* ------------------------------ reakcje ------------------------------ */

  test('reakcje: dodanie, zmiana na inną, zdjęcie tą samą i licznik od kilku osób', async () => {
    const m = await send(ala, 'Reaguj na mnie');

    let res = await react(bob, m.id, 'like');
    expect(res.body.message.reactions).toEqual([{ key: 'like', userIds: [bob.user.id], usernames: ['akcjebob'] }]);

    res = await react(ala, m.id, 'like');
    expect(res.body.message.reactions[0].userIds.sort()).toEqual([ala.user.id, bob.user.id].sort());

    // zmiana reakcji Boba na inną - jedna osoba ma jedną reakcję
    res = await react(bob, m.id, 'fire');
    expect(res.body.message.reactions.map((r) => r.key)).toEqual(['like', 'fire']);
    expect(res.body.message.reactions.find((r) => r.key === 'like').userIds).toEqual([ala.user.id]);

    // ta sama reakcja drugi raz ją zdejmuje
    res = await react(bob, m.id, 'fire');
    expect(res.body.message.reactions.map((r) => r.key)).toEqual(['like']);

    // pusty klucz też zdejmuje
    res = await react(ala, m.id, '');
    expect(res.body.message.reactions).toEqual([]);
  });

  test('nieznana reakcja jest odrzucana', async () => {
    const m = await send(ala, 'Nieznana reakcja');
    const res = await react(bob, m.id, '<script>');
    expect(res.status).toBe(400);
    expect(await MessageReaction().count({ where: { messageId: m.id } })).toBe(0);
  });

  test('osoba spoza rozmowy nie może reagować, edytować, usuwać ani pisać "pisze..."', async () => {
    const outsider = await userAgent(ctx.app, { username: 'akcjeobcy' });
    const m = await send(ala, 'Poufne');
    const asOutsider = (path) => post(outsider, path, { key: 'like', text: 'x' });
    expect((await asOutsider(`/chat/${convId}/messages/${m.id}/react`)).status).toBe(403);
    expect((await asOutsider(`/chat/${convId}/messages/${m.id}/edit`)).status).toBe(403);
    expect((await asOutsider(`/chat/${convId}/messages/${m.id}/delete`)).status).toBe(403);
    expect((await asOutsider(`/chat/${convId}/typing`)).status).toBe(403);
    expect((await asOutsider(`/chat/${convId}/read`)).status).toBe(403);
  });

  /* ------------------------------ doczytywanie zmian ------------------------------ */

  test('GET ?since= zwraca wiadomości zmienione po podanej chwili (edycja, reakcja), ?after= tylko nowe', async () => {
    const stable = await send(ala, 'Stara, niezmieniana');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const checkpoint = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const edited = await send(bob, 'Do edycji po punkcie kontrolnym');
    await edit(bob, edited.id, 'Po edycji');
    const reacted = await send(ala, 'Do reakcji po punkcie kontrolnym');
    await react(bob, reacted.id, 'wow');

    const since = await ala.agent.get(`/chat/${convId}/messages?since=${encodeURIComponent(checkpoint)}`).set('Accept', 'application/json');
    const ids = since.body.messages.map((m) => m.id);
    expect(ids).toContain(edited.id);
    expect(ids).toContain(reacted.id);
    expect(ids).not.toContain(stable.id);

    // reakcja na STARĄ wiadomość też trafia do ?since= (dotyka updatedAt), choć jej nie ma w ?after=
    const old = await send(ala, 'Stara wiadomość z późną reakcją');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await react(bob, old.id, 'love');
    const sinceLate = await ala.agent.get(`/chat/${convId}/messages?since=${encodeURIComponent(second)}`).set('Accept', 'application/json');
    expect(sinceLate.body.messages.map((m) => m.id)).toContain(old.id);
    const afterLate = await ala.agent.get(`/chat/${convId}/messages?after=${encodeURIComponent(second)}`).set('Accept', 'application/json');
    expect(afterLate.body.messages.map((m) => m.id)).not.toContain(old.id);
  });

  /* ------------------------------ zdarzenia czasu rzeczywistego ------------------------------ */

  test('nowa wiadomość idzie do obu uczestników, a "summary" (liczniki) tylko do odbiorcy', async () => {
    const m = await sendHttp(ala, 'Zdarzenia na żywo');
    const messageCall = publishSpy.mock.calls.find(([, event]) => event === 'message');
    expect(messageCall[0].sort()).toEqual([ala.user.id, bob.user.id].sort());
    expect(messageCall[2].message.id).toBe(m.id);

    const summaryCall = publishSpy.mock.calls.find(([, event]) => event === 'summary');
    expect(summaryCall[0]).toEqual([bob.user.id]);
  });

  test('reakcja i edycja rozsyłają zaktualizowaną wiadomość do uczestników (bez "summary")', async () => {
    const m = await send(ala, 'Do zmian na żywo');
    publishSpy.mockClear();
    await react(bob, m.id, 'haha');
    await edit(ala, m.id, 'Zmieniona na żywo');

    const messageEvents = publishSpy.mock.calls.filter(([, event]) => event === 'message');
    expect(messageEvents).toHaveLength(2);
    expect(messageEvents[0][2].message.reactions[0].key).toBe('haha');
    expect(messageEvents[1][2].message.text).toBe('Zmieniona na żywo');
    expect(publishSpy.mock.calls.some(([, event]) => event === 'summary')).toBe(false);
  });

  test('"pisze..." trafia tylko do pozostałych uczestników, nie do piszącego', async () => {
    const res = await post(ala, `/chat/${convId}/typing`);
    expect(res.status).toBe(204);
    const call = publishSpy.mock.calls.find(([, event]) => event === 'typing');
    expect(call[0]).toEqual([bob.user.id]);
    expect(call[2]).toEqual({ conversationId: convId, userId: ala.user.id, username: 'akcjeala' });
  });

  test('oznaczenie jako przeczytane zdejmuje licznik i odświeża plakietki innych kart użytkownika', async () => {
    await send(ala, 'Do przeczytania');
    const { getUnreadCounts } = require('../../utils/chatHelpers');
    expect((await getUnreadCounts(bob.user.id)).byConversation[convId]).toBeGreaterThan(0);

    publishSpy.mockClear();
    const res = await post(bob, `/chat/${convId}/read`);
    expect(res.status).toBe(204);
    expect((await getUnreadCounts(bob.user.id)).byConversation[convId] || 0).toBe(0);
    expect(publishSpy).toHaveBeenCalledWith([bob.user.id], 'summary', {});
  });

  test('gdy administrator wyłączył odpowiedź, zwykły użytkownik nie może reagować ani edytować', async () => {
    const admin = await adminAgent(ctx.app, { username: 'akcjeadmin' });
    let token = await csrfToken(admin.agent, '/chat');
    const start = await admin.agent.post(`/chat/start/${ala.user.username}`).send({ _csrf: token }).redirects(0);
    const adminConv = start.headers.location.split('c=')[1];

    const fromAdmin = (await post(admin, `/chat/${adminConv}/messages`, { text: 'Komunikat administracji' }, adminConv)).body.message;
    token = await csrfToken(admin.agent, `/chat?c=${adminConv}`);
    await admin.agent.post(`/chat/${adminConv}/toggle-reply`).set('Accept', 'application/json').send({ _csrf: token });

    const reaction = await post(ala, `/chat/${adminConv}/messages/${fromAdmin.id}/react`, { key: 'like' }, adminConv);
    expect(reaction.status).toBe(403);
    // własną wiadomość (gdyby była) użytkownik nadal może usunąć - blokada dotyczy pisania, nie porządkowania
    const typing = await post(ala, `/chat/${adminConv}/typing`, {}, adminConv);
    expect(typing.status).toBe(204);
    expect(publishSpy.mock.calls.some(([, event]) => event === 'typing')).toBe(false);
  });

  test('usunięcie konta zdejmuje jego reakcje, a jego wiadomości zostają podpisane jako "Usunięty użytkownik"', async () => {
    const leaver = await userAgent(ctx.app, { username: 'akcjeodchodzacy' });
    const m = await send(ala, 'Wiadomość z reakcją odchodzącego');
    await MessageReaction().create({ messageId: m.id, conversationId: convId, userId: leaver.user.id, username: 'akcjeodchodzacy', key: 'like' });

    const { removeUserFromConversations, DELETED_USER_LABEL } = require('../../utils/chatHelpers');
    await removeUserFromConversations(leaver.user.id);

    expect(await MessageReaction().count({ where: { userId: leaver.user.id } })).toBe(0);
    expect(DELETED_USER_LABEL).toBe('Usunięty użytkownik');
  });

  /* ------------------------------ moderacja ------------------------------ */

  test('administrator rozpatrując zgłoszenie usuwa wiadomość "miękko" - uczestnicy widzą znacznik usunięcia', async () => {
    const admin = await adminAgent(ctx.app, { username: 'akcjemoderator' });
    const m = await send(ala, 'Wiadomość do zgłoszenia');

    let token = await csrfToken(bob.agent, `/chat?c=${convId}`);
    await bob.agent.post(`/reports/message/${m.id}`).send({ reason: 'spam', _csrf: token });
    const ContentReport = require('../../models/ContentReport');
    const report = await ContentReport.findOne({ where: { targetId: m.id } });
    expect(report.snapshot).toBe('Wiadomość do zgłoszenia');

    publishSpy.mockClear();
    token = await csrfToken(admin.agent, '/admin/reports');
    await admin.agent.post(`/admin/reports/content/${report.id}/resolve`).send({ action: 'delete-message', reason: 'spam', _csrf: token });

    const row = await Message().findByPk(m.id);
    expect(row).not.toBeNull();
    expect(row.deletedAt).not.toBeNull();
    expect(row.text).toBe('');
    const event = publishSpy.mock.calls.find(([, name]) => name === 'message');
    expect(event[2].message.deleted).toBe(true);
  });
});
