const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { createCustomGame, csrfToken, userAgent, adminAgent } = require('../setup/factories');

describe('gry i recenzje', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  // Gra "ręcznie dodana" (custom_games) nie wymaga żadnego klucza IGDB - dokładnie ten sam
  // mechanizm, którego aplikacja używa, gdy IGDB nie jest skonfigurowane (patrz utils/__mocks__/igdbService.js).
  async function game(overrides) {
    return createCustomGame(overrides);
  }

  test('strona gry bez recenzji renderuje się i zachęca do dodania pierwszej opinii', async () => {
    const g = await game({ title: 'Cicha Gra' });
    const res = await request(ctx.app).get(`/games/${g.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Cicha Gra');
  });

  test('gość nie może dodać recenzji (przekierowanie, nie zapisuje się)', async () => {
    const g = await game();
    const res = await request(ctx.app).post(`/games/${g.id}/reviews`).redirects(0);
    expect(res.status).toBe(302);
    const Review = require('../../models/Review');
    expect(await Review.count({ where: { gameId: g.id } })).toBe(0);
  });

  test('zalogowany użytkownik dodaje recenzję - widać ją na stronie gry', async () => {
    const g = await game({ title: 'Recenzowalna Gra' });
    const { agent } = await userAgent(ctx.app);
    const token = await csrfToken(agent, `/games/${g.id}`);
    const res = await agent.post(`/games/${g.id}/reviews`).send({ rating: '4.5', text: 'Naprawdę udana gra, polecam każdemu fanowi gatunku.', _csrf: token });
    expect(res.status).toBe(302);

    const page = await request(ctx.app).get(`/games/${g.id}`);
    expect(page.text).toContain('Naprawdę udana gra');
    expect(page.text).toContain('4.5') ;
  });

  test('nieprawidłowa ocena (poza 0.5-5 albo nie co pół gwiazdki) jest odrzucana', async () => {
    const g = await game();
    const { agent } = await userAgent(ctx.app);
    const token = await csrfToken(agent, `/games/${g.id}`);
    await agent.post(`/games/${g.id}/reviews`).send({ rating: '5.3', text: 'Tekst opinii wystarczająco długi.', _csrf: token });
    const Review = require('../../models/Review');
    expect(await Review.count({ where: { gameId: g.id } })).toBe(0);
  });

  test('pusta treść recenzji jest odrzucana', async () => {
    const g = await game();
    const { agent } = await userAgent(ctx.app);
    const token = await csrfToken(agent, `/games/${g.id}`);
    await agent.post(`/games/${g.id}/reviews`).send({ rating: '3', text: '', _csrf: token });
    const Review = require('../../models/Review');
    expect(await Review.count({ where: { gameId: g.id } })).toBe(0);
  });

  test('nie można dodać drugiej recenzji do tej samej gry (trzeba edytować pierwszą)', async () => {
    const g = await game();
    const { agent } = await userAgent(ctx.app);
    const token = await csrfToken(agent, `/games/${g.id}`);
    await agent.post(`/games/${g.id}/reviews`).send({ rating: '4', text: 'Pierwsza opinia, wystarczająco długa treść.', _csrf: token });
    await agent.post(`/games/${g.id}/reviews`).send({ rating: '2', text: 'Druga próba, też długi tekst opinii.', _csrf: token });

    const Review = require('../../models/Review');
    const reviews = await Review.findAll({ where: { gameId: g.id } });
    expect(reviews).toHaveLength(1);
    expect(Number(reviews[0].rating)).toBe(4);
  });

  test('autor może edytować własną recenzję', async () => {
    const g = await game();
    const { agent } = await userAgent(ctx.app);
    let token = await csrfToken(agent, `/games/${g.id}`);
    await agent.post(`/games/${g.id}/reviews`).send({ rating: '3', text: 'Opinia do edycji, wystarczająco długa.', _csrf: token });

    const Review = require('../../models/Review');
    const review = await Review.findOne({ where: { gameId: g.id } });
    token = await csrfToken(agent, `/games/${g.id}`);
    const res = await agent.post(`/games/${g.id}/reviews/${review.id}/edit`).send({ rating: '5', text: 'Zmieniona opinia po edycji, dłuższy tekst.', _csrf: token });
    expect(res.status).toBe(302);

    await review.reload();
    expect(Number(review.rating)).toBe(5);
    expect(review.text).toContain('Zmieniona opinia');
    expect(review.editedAt).not.toBeNull();
  });

  test('inny użytkownik nie może edytować ani usunąć cudzej recenzji', async () => {
    const g = await game();
    const { agent: author } = await userAgent(ctx.app);
    let token = await csrfToken(author, `/games/${g.id}`);
    await author.post(`/games/${g.id}/reviews`).send({ rating: '3', text: 'Opinia autora, wystarczająco długa treść.', _csrf: token });

    const Review = require('../../models/Review');
    const review = await Review.findOne({ where: { gameId: g.id } });

    const { agent: intruder } = await userAgent(ctx.app);
    token = await csrfToken(intruder, `/games/${g.id}`);
    await intruder.post(`/games/${g.id}/reviews/${review.id}/edit`).send({ rating: '1', text: 'Próba podmiany cudzej opinii.', _csrf: token });
    await intruder.post(`/games/${g.id}/reviews/${review.id}/delete`).send({ _csrf: token });

    await review.reload();
    expect(Number(review.rating)).toBe(3);
    expect(review.text).toContain('Opinia autora');
  });

  test('autor może usunąć własną recenzję', async () => {
    const g = await game();
    const { agent } = await userAgent(ctx.app);
    let token = await csrfToken(agent, `/games/${g.id}`);
    await agent.post(`/games/${g.id}/reviews`).send({ rating: '3', text: 'Opinia do usunięcia, wystarczająco długa.', _csrf: token });

    const Review = require('../../models/Review');
    const review = await Review.findOne({ where: { gameId: g.id } });
    token = await csrfToken(agent, `/games/${g.id}`);
    await agent.post(`/games/${g.id}/reviews/${review.id}/delete`).send({ _csrf: token });

    expect(await Review.findByPk(review.id)).toBeNull();
  });

  test('administrator może usunąć cudzą recenzję (moderacja)', async () => {
    const g = await game();
    const { agent: author } = await userAgent(ctx.app);
    let token = await csrfToken(author, `/games/${g.id}`);
    await author.post(`/games/${g.id}/reviews`).send({ rating: '2', text: 'Opinia do usunięcia przez admina.', _csrf: token });

    const Review = require('../../models/Review');
    const review = await Review.findOne({ where: { gameId: g.id } });

    const { agent: admin } = await adminAgent(ctx.app);
    token = await csrfToken(admin, `/games/${g.id}`);
    const res = await admin.post(`/games/${g.id}/reviews/${review.id}/delete`).send({ _csrf: token });
    expect(res.status).toBe(302);
    expect(await Review.findByPk(review.id)).toBeNull();
  });
});
