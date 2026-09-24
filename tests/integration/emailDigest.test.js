const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, createUser } = require('../setup/factories');

// Podsumowanie nieprzeczytanych na e-mail (utils/emailDigest.js): tylko za zgodą, tylko gdy jest coś nowego,
// bez powtarzania tych samych wiadomości. Wysyłka jest podstawiona (mailer) - żadnej prawdziwej poczty.
describe('e-mailowe podsumowanie nieprzeczytanych', () => {
  let ctx;
  let ala; // włączone podsumowanie
  let bob; // nadawca wiadomości, podsumowanie wyłączone
  let digest;
  let chat;
  let User;
  let convId;

  const HOUR = 60 * 60 * 1000;

  const optIn = (user, on = true) =>
    User.update({ notificationPrefs: JSON.stringify(on ? { emailDigest: true } : {}) }, { where: { id: user.id } });

  const say = (from, text, conversationId = convId) =>
    chat.addMessage({ conversationId, senderId: from.id, senderUsername: from.username, text });

  const newMailer = () => jest.fn().mockResolvedValue({});

  beforeAll(async () => {
    ctx = await createTestApp();
    User = require('../../models/User');
    digest = require('../../utils/emailDigest');
    chat = require('../../utils/chatHelpers');
    ({ user: ala } = await createUser({ username: 'digestala', email: 'digestala@example.test' }));
    ({ user: bob } = await createUser({ username: 'digestbob', email: 'digestbob@example.test' }));
    const dm = await chat.getOrCreateDM(bob, ala);
    convId = dm.id;
    // Konto ala zakłada się na czacie "od zera" - odczyt ustawiamy na teraz, żeby liczyły się tylko nowe wiadomości.
    await chat.markConversationRead(ala.id, convId);
    await chat.markConversationRead(bob.id, convId);
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('podsumowanie jest domyślnie wyłączone, a ustawienie zapisuje się z formularza powiadomień', async () => {
    const { agent, user } = await userAgent(ctx.app, { username: 'digestustawienia' });
    const { parsePrefs } = require('../../utils/notificationPrefs');
    expect(parsePrefs((await User.findByPk(user.id)).notificationPrefs).emailDigest).toBe(false);

    let token = await csrfToken(agent, '/profile/settings?tab=notifications');
    await agent.post('/profile/settings/notifications').send({ emailDigest: '1', _csrf: token });
    expect(parsePrefs((await User.findByPk(user.id)).notificationPrefs).emailDigest).toBe(true);

    const page = await agent.get('/profile/settings?tab=notifications');
    expect(page.text).toMatch(/name="emailDigest"[^>]*checked/);

    token = await csrfToken(agent, '/profile/settings?tab=notifications');
    await agent.post('/profile/settings/notifications').send({ _csrf: token });
    expect(parsePrefs((await User.findByPk(user.id)).notificationPrefs).emailDigest).toBe(false);
  });

  test('bez zgody nikt nic nie dostaje, nawet z nieprzeczytanymi wiadomościami', async () => {
    await optIn(ala, false);
    await say(bob, 'Wiadomość, której nikt nie zapowiadał');
    const mailer = newMailer();
    const result = await digest.runDigest({ mailer });
    expect(mailer).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  test('za zgodą: jeden list z liczbą nieprzeczytanych i nazwą rozmowy, z linkiem do czatu i wyłączenia', async () => {
    await optIn(ala, true);
    await say(bob, 'Druga nieprzeczytana');
    const mailer = newMailer();
    const now = new Date();
    const result = await digest.runDigest({ mailer, now });

    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(mailer).toHaveBeenCalledTimes(1);
    const mail = mailer.mock.calls[0][0];
    expect(mail.to).toBe('digestala@example.test');
    expect(mail.subject).toMatch(/2 nieprzeczytane wiadomości/);
    expect(mail.html).toContain('digestbob');
    expect(mail.html).toContain('/chat');
    expect(mail.html).toContain('/profile/settings?tab=notifications');
    expect(mail.text).toContain('digestbob: 2');
    expect((await User.findByPk(ala.id)).lastDigestEmailAt).not.toBeNull();
  });

  test('nie wysyła drugi raz w ciągu doby ani po dobie, jeśli nie ma nic nowego; wraca tylko z tym, co nowsze', async () => {
    const mailer = newMailer();
    const start = new Date();

    // zaraz po wysyłce - za wcześnie
    await say(bob, 'Trzecia, tuż po liście');
    expect((await digest.runDigest({ mailer, now: new Date(start.getTime() + HOUR) })).sent).toBe(0);

    // po dobie: nowa jest tylko "Trzecia" (dwie poprzednie były już w liście)
    const later = new Date(start.getTime() + 25 * HOUR);
    const result = await digest.runDigest({ mailer, now: later });
    expect(result.sent).toBe(1);
    expect(mailer.mock.calls[0][0].subject).toMatch(/1 nieprzeczytana wiadomość/);

    // kolejna doba bez nowych rzeczy - żadnego "pustego" listu
    const nextDay = new Date(later.getTime() + 25 * HOUR);
    expect((await digest.runDigest({ mailer, now: nextDay })).sent).toBe(0);
    expect(mailer).toHaveBeenCalledTimes(1);
  });

  test('przeczytane wiadomości nie trafiają do podsumowania', async () => {
    const { user: dora } = await createUser({ username: 'digestdora', email: 'digestdora@example.test' });
    await optIn(dora, true);
    const dm = await chat.getOrCreateDM(bob, dora);
    await say(bob, 'Dora to zobaczy', dm.id);
    await chat.markConversationRead(dora.id, dm.id);

    const mailer = newMailer();
    await digest.runDigest({ mailer, now: new Date(Date.now() + 100 * HOUR) });
    const recipients = mailer.mock.calls.map(([mail]) => mail.to);
    expect(recipients).not.toContain('digestdora@example.test');
  });

  test('nowe powiadomienia w serwisie też się liczą (i wystarczą same, bez wiadomości)', async () => {
    const { user: ewa } = await createUser({ username: 'digestewa', email: 'digestewa@example.test' });
    await optIn(ewa, true);
    const Notification = require('../../models/Notification');
    await Notification.create({ userId: ewa.id, type: 'follow', actorId: bob.id, message: 'digestbob zaczął Cię obserwować', isRead: false });

    const mailer = newMailer();
    await digest.runDigest({ mailer, now: new Date(Date.now() + 200 * HOUR) });
    const mail = mailer.mock.calls.map(([m]) => m).find((m) => m.to === 'digestewa@example.test');
    expect(mail.subject).toMatch(/1 nowe powiadomienie/);
    expect(mail.subject).not.toMatch(/wiadomo/);
  });

  test('nieudana wysyłka zwalnia "zajęcie" - kolejny przebieg próbuje jeszcze raz', async () => {
    const { user: filip } = await createUser({ username: 'digestfilip', email: 'digestfilip@example.test' });
    await optIn(filip, true);
    const dm = await chat.getOrCreateDM(bob, filip);
    await chat.markConversationRead(filip.id, dm.id);
    await say(bob, 'Do filipa', dm.id);

    const failing = jest.fn().mockRejectedValue(new Error('SMTP niedostępny'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const now = new Date(Date.now() + 300 * HOUR);
    const first = await digest.runDigest({ mailer: failing, now });
    errorSpy.mockRestore();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect((await User.findByPk(filip.id)).lastDigestEmailAt).toBeNull();

    const ok = newMailer();
    await digest.runDigest({ mailer: ok, now });
    expect(ok.mock.calls.map(([m]) => m.to)).toContain('digestfilip@example.test');
  });

  test('dwa równoległe przebiegi (dwie instancje serwera) wysyłają jeden list', async () => {
    const { user: gosia } = await createUser({ username: 'digestgosia', email: 'digestgosia@example.test' });
    await optIn(gosia, true);
    const dm = await chat.getOrCreateDM(bob, gosia);
    await chat.markConversationRead(gosia.id, dm.id);
    await say(bob, 'Do gosi', dm.id);

    const mailer = newMailer();
    const now = new Date(Date.now() + 400 * HOUR);
    await Promise.all([digest.runDigest({ mailer, now }), digest.runDigest({ mailer, now })]);
    expect(mailer.mock.calls.filter(([m]) => m.to === 'digestgosia@example.test')).toHaveLength(1);
  });

  test('konta zablokowane są pomijane', async () => {
    const { user: hela } = await createUser({ username: 'digesthela', email: 'digesthela@example.test' });
    await optIn(hela, true);
    await User.update({ isBanned: true }, { where: { id: hela.id } });
    const dm = await chat.getOrCreateDM(bob, hela);
    await chat.markConversationRead(hela.id, dm.id);
    await say(bob, 'Do zablokowanej', dm.id);

    const mailer = newMailer();
    await digest.runDigest({ mailer, now: new Date(Date.now() + 500 * HOUR) });
    expect(mailer.mock.calls.map(([m]) => m.to)).not.toContain('digesthela@example.test');
  });

  test('treść listu ucieka znaki HTML z nazw rozmów', async () => {
    const { user: igor } = await createUser({ username: 'digestigor', email: 'digestigor@example.test' });
    await optIn(igor, true);
    const group = await chat.createGroup({ name: 'Tom & <b>Jerry</b>', ownerId: bob.id, ownerUsername: bob.username });
    await chat.inviteMembersToGroup(group.id, [{ id: igor.id, username: igor.username }]);
    await chat.acceptGroupInvite(group.id, igor.id, igor.username);
    await chat.markConversationRead(igor.id, group.id);
    await say(bob, 'W grupie z nazwą HTML', group.id);

    const mailer = newMailer();
    await digest.runDigest({ mailer, now: new Date(Date.now() + 600 * HOUR) });
    const mail = mailer.mock.calls.map(([m]) => m).find((m) => m.to === 'digestigor@example.test');
    expect(mail.html).toContain('Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Jerry</b>');
  });

  test('polska odmiana liczebników w temacie', () => {
    const p = (n) => digest.plural(n, 'wiadomość', 'wiadomości', 'wiadomości (many)');
    expect([1, 2, 4, 5, 12, 14, 22, 25].map(p)).toEqual([
      'wiadomość',
      'wiadomości',
      'wiadomości',
      'wiadomości (many)',
      'wiadomości (many)',
      'wiadomości (many)',
      'wiadomości',
      'wiadomości (many)',
    ]);
  });
});
