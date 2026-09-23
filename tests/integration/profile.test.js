const { createTestApp } = require('../setup/testApp');
const { createCustomGame, csrfToken, userAgent } = require('../setup/factories');

describe('profil - lista recenzji', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  async function addReview(agent, gameId, overrides = {}) {
    const token = await csrfToken(agent, `/games/${gameId}`);
    return agent.post(`/games/${gameId}/reviews`).send({
      rating: overrides.rating || '4',
      text: overrides.text || 'Recenzja wystarczająco długa do zapisania w bazie.',
      _csrf: token,
    });
  }

  test('zakładka "Recenzje" pokazuje okładkę/tytuł zrecenzowanej gry (współdzielona karta z partials/review-card)', async () => {
    const game = await createCustomGame({ title: 'Gra Profilowa' });
    const { agent } = await userAgent(ctx.app, { username: 'recenzent1' });
    await addReview(agent, game.id);

    // Własny profil zawsze jest pod /profile (patrz routes/userProfile.js - /:username przekierowuje tam właściciela).
    const page = await agent.get('/profile?tab=reviews');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Gra Profilowa');
    expect(page.text).toContain('gv-rcard'); // ta sama karta co na /reviews, nie stary uproszczony markup
  });

  test('liczba polubień recenzji w nagłówku profilu jest prawdziwa (wcześniej stats.likesReceived było zahardkodowane na 0)', async () => {
    const game = await createCustomGame({ title: 'Lubiana Gra' });
    const { agent: author, user: authorUser } = await userAgent(ctx.app, { username: 'lubianyautor' });
    const { agent: fan1 } = await userAgent(ctx.app, { username: 'fan1' });
    const { agent: fan2 } = await userAgent(ctx.app, { username: 'fan2' });
    await addReview(author, game.id, { text: 'Opinia, którą polubią inni użytkownicy testowo.' });

    const Review = require('../../models/Review');
    const review = await Review.findOne({ where: { gameId: game.id, userId: authorUser.id } });

    const likeUrl = `/games/${game.id}/reviews/${review.id}/like`;
    const token1 = await csrfToken(fan1, `/games/${game.id}`);
    await fan1.post(likeUrl).set('Accept', 'application/json').send({ _csrf: token1 });
    const token2 = await csrfToken(fan2, `/games/${game.id}`);
    await fan2.post(likeUrl).set('Accept', 'application/json').send({ _csrf: token2 });

    const page = await author.get('/profile');
    expect(page.status).toBe(200);
    expect(page.text).toContain('2 polubień recenzji');
    // Zdublowana, nieaktualna linijka ze zrzutu ekranu (liczba recenzji/obserwujących w nagłówku) została usunięta.
    expect(page.text).not.toContain('obserwujących</div>');
  });

  test('przyciski Edytuj/Usuń przy recenzji widoczne tylko dla jej autora, nie dla innych ani gościa', async () => {
    const game = await createCustomGame({ title: 'Gra Do Edycji' });
    const { agent: author, user: authorUser } = await userAgent(ctx.app, { username: 'wlascicielrecenzji' });
    const { agent: stranger } = await userAgent(ctx.app, { username: 'obcyuzytkownik' });
    await addReview(author, game.id);

    const ownView = await author.get('/profile?tab=reviews');
    expect(ownView.text).toContain('gv-ract-edit-toggle');
    expect(ownView.text).toContain('gv-ract-delete');

    const strangerView = await stranger.get(`/${authorUser.username}?tab=reviews`);
    expect(strangerView.text).not.toContain('gv-ract-edit-toggle');
    expect(strangerView.text).not.toContain('gv-ract-delete');
  });

  test('edycja recenzji z poziomu profilu wraca na profil (nie na stronę gry) dzięki Referer', async () => {
    const game = await createCustomGame({ title: 'Gra Do Powrotu' });
    const { agent, user } = await userAgent(ctx.app, { username: 'wracajacy' });
    await addReview(agent, game.id, { text: 'Pierwotna treść opinii do edycji.' });

    const Review = require('../../models/Review');
    const review = await Review.findOne({ where: { gameId: game.id, userId: user.id } });

    // supertest łączy się za każdym razem z nowym efemerycznym portem, więc nagłówek Host
    // (a przez to i "ten sam host" w backTo z routes/games.js) trzeba wymusić ręcznie -
    // inaczej Referer z poprzedniego żądania nigdy by nie pasował do bieżącego req.get('host').
    const HOST = 'gv-test.local';
    const profilePage = await agent.get('/profile?tab=reviews').set('Host', HOST);
    const token = profilePage.text.match(/name="csrf-token" content="([a-f0-9]+)"/)[1];

    const res = await agent
      .post(`/games/${game.id}/reviews/${review.id}/edit`)
      .set('Host', HOST)
      .set('Referer', `http://${HOST}/profile?tab=reviews`)
      .send({ rating: '5', text: 'Zaktualizowana treść opinii po edycji z profilu.', _csrf: token })
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/profile?tab=reviews');
  });
});
