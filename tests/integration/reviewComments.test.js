const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, createCustomGame } = require('../setup/factories');

// Komentarze pod recenzjami: linki z powiadomień prowadzą do konkretnego komentarza, a polubienie, zgłoszenie
// i usunięcie są dostępne tak samo na stronie gry i na listach recenzji (wcześniej raz były, raz nie).
describe('recenzje - komentarze: linki z powiadomień i spójne akcje', () => {
  let ctx;
  let author; // autor recenzji
  let fan; // komentujący
  let game;
  let review;
  const Notification = () => require('../../models/Notification');

  async function json(who, method, path, body = {}) {
    const token = await csrfToken(who.agent, `/games/${game.id}`);
    const req = who.agent[method](path).set('Accept', 'application/json');
    return method === 'get' ? req : req.send({ ...body, _csrf: token });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    game = await createCustomGame({ title: 'Gra z komentarzami' });
    author = await userAgent(ctx.app, { username: 'recautor' });
    fan = await userAgent(ctx.app, { username: 'recfan' });
    const Review = require('../../models/Review');
    review = await Review.create({
      gameId: game.id,
      userId: author.user.id,
      username: author.user.username,
      rating: 4,
      text: 'Recenzja, pod którą się komentuje.',
    });
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('powiadomienie o komentarzu linkuje do KOMENTARZA (#comment-ID), nie do samej recenzji', async () => {
    const res = await json(fan, 'post', `/games/${game.id}/reviews/${review.id}/comments`, { text: 'Świetna recenzja' });
    expect(res.status).toBe(200);
    expect(res.body.comment.mine).toBe(true);

    const note = await Notification().findOne({ where: { userId: author.user.id, type: 'review-comment' } });
    expect(note.link).toBe(`/games/${game.id}#comment-${res.body.comment.id}`);
  });

  test('powiadomienie o polubieniu komentarza też linkuje do komentarza', async () => {
    const list = await json(author, 'get', `/games/${game.id}/reviews/${review.id}/comments`);
    const comment = list.body.comments[0];
    await json(author, 'post', `/games/${game.id}/reviews/${review.id}/comments/${comment.id}/like`);

    const note = await Notification().findOne({ where: { userId: fan.user.id, type: 'comment-like' } });
    expect(note.link).toBe(`/games/${game.id}#comment-${comment.id}`);
  });

  test('lista komentarzy (JSON) mówi, które są moje - żeby pokazać "usuń" u autora, a "zgłoś" u reszty', async () => {
    const asFan = await json(fan, 'get', `/games/${game.id}/reviews/${review.id}/comments`);
    const asAuthor = await json(author, 'get', `/games/${game.id}/reviews/${review.id}/comments`);
    expect(asFan.body.comments[0]).toMatchObject({ mine: true, userId: fan.user.id, liked: false, likeCount: 1 }); // polubił autor recenzji, nie komentujący
    expect(asAuthor.body.comments[0]).toMatchObject({ mine: false, userId: fan.user.id, liked: true });
  });

  test('strona gry ma kotwice komentarzy i skrypt rozwijający je z adresu (#comment-ID)', async () => {
    const list = await json(fan, 'get', `/games/${game.id}/reviews/${review.id}/comments`);
    const commentId = list.body.comments[0].id;

    const page = await fan.agent.get(`/games/${game.id}`);
    expect(page.text).toContain(`id="comment-${commentId}"`);
    expect(page.text).toContain('openFromHash');
    expect(page.text).toContain('gv-flash-target');
  });

  test('lista recenzji ma przyciski zgłoszenia i udostępnienia oraz okno zgłoszenia (dla zalogowanych)', async () => {
    const page = await fan.agent.get('/reviews');
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="reportModal"');
    expect(page.text).toContain(`data-report-url="/games/${game.id}/reviews/${review.id}/report"`);
    expect(page.text).toContain('data-share');
    // własnej recenzji nie da się zgłosić
    const own = await author.agent.get('/reviews');
    expect(own.text).not.toContain(`data-report-url="/games/${game.id}/reviews/${review.id}/report"`);
  });

  test('profil (własny i cudzy) też ma okno zgłoszenia, żeby przyciski w recenzjach działały', async () => {
    const ownProfile = await author.agent.get('/profile');
    expect(ownProfile.text).toContain('id="reportModal"');
    const otherProfile = await fan.agent.get(`/${author.user.username}`);
    expect(otherProfile.text).toContain('id="reportModal"');
    expect(otherProfile.text).toContain('data-type="review"');
    expect(otherProfile.text).toContain('data-type="user"');
  });

  test('skrypt komentarzy na listach obsługuje polubienie, zgłoszenie i usunięcie', async () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../public/js/review-actions.js'), 'utf8');
    expect(source).toContain('/like');
    expect(source).toContain("data-report-type', 'comment'");
    expect(source).toContain('/delete');
  });

  test('usunięcie komentarza przez autora zwraca JSON, a cudzy komentarz usunąć nie można', async () => {
    const list = await json(fan, 'get', `/games/${game.id}/reviews/${review.id}/comments`);
    const commentId = list.body.comments[0].id;

    const denied = await json(author, 'post', `/games/${game.id}/reviews/${review.id}/comments/${commentId}/delete`);
    expect(denied.status).toBe(403);
    expect(denied.body.ok).toBe(false);

    const ok = await json(fan, 'post', `/games/${game.id}/reviews/${review.id}/comments/${commentId}/delete`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });

    const after = await json(fan, 'get', `/games/${game.id}/reviews/${review.id}/comments`);
    expect(after.body.comments).toHaveLength(0);
  });
});
