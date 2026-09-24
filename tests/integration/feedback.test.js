const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, adminAgent } = require('../setup/factories');

describe('ankieta "Oceń GameVerse" i panel admina - Opinie', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('strona główna: gość widzi CTA logowania, zalogowany - przycisk "Oceń GameVerse" i modal ankiety', async () => {
    const guest = await request(ctx.app).get('/');
    expect(guest.text).toContain('Załóż darmowe konto');
    expect(guest.text).not.toContain('id="feedbackModal"');

    const { agent } = await userAgent(ctx.app, { username: 'ankieter1' });
    const loggedIn = await agent.get('/');
    expect(loggedIn.text).toContain('>Oceń GameVerse<');
    expect(loggedIn.text).toContain('id="feedbackModal"');
  });

  test('gość nie może wysłać ankiety (przekierowanie, nic się nie zapisuje)', async () => {
    const res = await request(ctx.app).post('/feedback').send({ rating: '5' }).redirects(0);
    expect(res.status).toBe(302);

    const Feedback = require('../../models/Feedback');
    expect(await Feedback.count()).toBe(0);
  });

  test('poprawne wysłanie ankiety (ocena + komentarz) zapisuje się w bazie', async () => {
    const { agent, user } = await userAgent(ctx.app, { username: 'ankieter2' });
    const token = await csrfToken(agent, '/');
    const res = await agent
      .post('/feedback')
      .send({ rating: '4', comment: 'Fajna strona, przydałyby się grupy w czacie.', _csrf: token })
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');

    const Feedback = require('../../models/Feedback');
    const saved = await Feedback.findOne({ where: { userId: user.id } });
    expect(saved.rating).toBe(4);
    expect(saved.comment).toBe('Fajna strona, przydałyby się grupy w czacie.');
    expect(saved.username).toBe('ankieter2');
  });

  test('ankieta bez komentarza (opcjonalny) też się zapisuje', async () => {
    const { agent, user } = await userAgent(ctx.app, { username: 'ankieter3' });
    const token = await csrfToken(agent, '/');
    await agent.post('/feedback').send({ rating: '5', _csrf: token });

    const Feedback = require('../../models/Feedback');
    const saved = await Feedback.findOne({ where: { userId: user.id } });
    expect(saved.rating).toBe(5);
    expect(saved.comment).toBeFalsy();
  });

  test('nieprawidłowa ocena (poza 1-5, albo nie liczba) jest odrzucana', async () => {
    const { agent, user } = await userAgent(ctx.app, { username: 'ankieter4' });
    const Feedback = require('../../models/Feedback');

    for (const bad of ['0', '6', 'abc', '']) {
      const token = await csrfToken(agent, '/');
      const res = await agent.post('/feedback').send({ rating: bad, _csrf: token }).redirects(0);
      expect(res.status).toBe(302);
    }
    expect(await Feedback.count({ where: { userId: user.id } })).toBe(0);
  });

  test('panel admina - zakładka Opinie liczy średnią, rozkład ocen i pokazuje komentarze', async () => {
    const { agent: admin } = await adminAgent(ctx.app);
    const { agent: fanA } = await userAgent(ctx.app, { username: 'ankietasumapoprawna1' });
    const { agent: fanB } = await userAgent(ctx.app, { username: 'ankietasumapoprawna2' });

    let token = await csrfToken(fanA, '/');
    await fanA.post('/feedback').send({ rating: '5', comment: 'Super czat z GIF-ami!', _csrf: token });
    token = await csrfToken(fanB, '/');
    await fanB.post('/feedback').send({ rating: '3', _csrf: token });

    const page = await admin.get('/admin/survey');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Super czat z GIF-ami!');
    expect(page.text).toContain('ankietasumapoprawna1');
  });

  test('zwykły użytkownik nie ma dostępu do /admin/survey', async () => {
    const { agent } = await userAgent(ctx.app, { username: 'niedostepankieta' });
    const res = await agent.get('/admin/survey').redirects(0);
    expect(res.status).toBe(302);
  });
});
