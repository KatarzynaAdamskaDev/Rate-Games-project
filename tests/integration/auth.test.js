const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { createUser, csrfToken } = require('../setup/factories');

describe('rejestracja i logowanie', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  const validSignup = (overrides = {}) => ({
    email: 'nowy@example.test',
    username: 'nowyuser',
    password: 'BardzoDobreHaslo1',
    acceptTerms: 'on',
    acceptPrivacy: 'on',
    ...overrides,
  });

  test('rejestracja z poprawnymi danymi tworzy konto i pozwala się zalogować', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent, '/auth/signup');

    const res = await agent.post('/auth/signup').set('Accept', 'application/json').send({ ...validSignup(), _csrf: token });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const User = require('../../models/User');
    const saved = await User.findOne({ where: { username: 'nowyuser' } });
    expect(saved).not.toBeNull();
    expect(saved.role).toBe('user');
    // Hasło nigdy nie jest zapisane jawnie.
    expect(saved.passwordHash).not.toBe('BardzoDobreHaslo1');

    const loginToken = await csrfToken(agent, '/auth/signin');
    const login = await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: 'nowyuser', password: 'BardzoDobreHaslo1', _csrf: loginToken });
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);
  });

  test('rejestracja bez akceptacji regulaminu/polityki jest odrzucana', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent, '/auth/signup');
    const res = await agent.post('/auth/signup').set('Accept', 'application/json').send({ ...validSignup({ username: 'inny1', email: 'inny1@example.test' }), acceptTerms: '', _csrf: token });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('zbyt krótkie hasło (poniżej 8 znaków) jest odrzucane', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent, '/auth/signup');
    const res = await agent.post('/auth/signup').set('Accept', 'application/json').send({ ...validSignup({ username: 'inny2', email: 'inny2@example.test', password: 'krotkie' }), _csrf: token });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/co najmniej 8 znaków/);
  });

  test('nie da się zarejestrować dwa razy tym samym adresem e-mail ani nazwą', async () => {
    await createUser({ username: 'zajety', email: 'zajety@example.test' });
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent, '/auth/signup');

    const sameEmail = await agent.post('/auth/signup').set('Accept', 'application/json').send({ ...validSignup({ username: 'inny3', email: 'zajety@example.test' }), _csrf: token });
    expect(sameEmail.status).toBe(400);
    expect(sameEmail.body.message).toMatch(/e-mail/);

    const sameUsername = await agent.post('/auth/signup').set('Accept', 'application/json').send({ ...validSignup({ username: 'zajety', email: 'inny4@example.test' }), _csrf: token });
    expect(sameUsername.status).toBe(400);
    expect(sameUsername.body.message).toMatch(/nazwa użytkownika/);
  });

  test('zarezerwowanej nazwy użytkownika (np. "admin") nie da się zarejestrować', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent, '/auth/signup');
    const res = await agent.post('/auth/signup').set('Accept', 'application/json').send({ ...validSignup({ username: 'admin', email: 'admin-test@example.test' }), _csrf: token });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/zarezerwowana/);
  });

  test('logowanie z błędnym hasłem jest odrzucane, a poprawnym - udane', async () => {
    const { user, password } = await createUser({ username: 'logtest' });
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent);

    const wrong = await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.username, password: 'zleHaslo123', _csrf: token });
    expect(wrong.status).toBe(400);
    expect(wrong.body.success).toBe(false);

    const right = await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.username, password, _csrf: token });
    expect(right.status).toBe(200);
    expect(right.body.success).toBe(true);
  });

  test('logowanie działa też po adresie e-mail, nie tylko nazwie użytkownika', async () => {
    const { user, password } = await createUser({ username: 'przezmail', email: 'przezmail@example.test' });
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent);
    const res = await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.email, password, _csrf: token });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('zalogowana sesja utrzymuje się między żądaniami (widać w panelu profilu)', async () => {
    const { user, password } = await createUser({ username: 'sesjatest' });
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent);
    await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.username, password, _csrf: token });

    const profile = await agent.get('/');
    expect(profile.text).toContain('sesjatest');
  });

  test('wylogowanie kończy sesję - kolejne żądanie już nie zna użytkownika', async () => {
    const { user, password } = await createUser({ username: 'wylogtest' });
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent);
    await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.username, password, _csrf: token });
    expect((await agent.get('/')).text).toContain('wylogtest');

    const logoutToken = await csrfToken(agent);
    await agent.post('/auth/logout').send({ _csrf: logoutToken });
    expect((await agent.get('/')).text).not.toContain('wylogtest');
  });

  test('POST /auth/signin bez tokenu CSRF jest odrzucany (403)', async () => {
    const agent = request.agent(ctx.app);
    await agent.get('/');
    const res = await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: 'ktos', password: 'cokolwiek' });
    expect(res.status).toBe(403);
  });

  test('zalogowany użytkownik nie może ponownie wejść na /auth/signin (ensureGuest)', async () => {
    const { user, password } = await createUser({ username: 'juz_zalogowany' });
    const agent = request.agent(ctx.app);
    const token = await csrfToken(agent);
    await agent.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.username, password, _csrf: token });

    const res = await agent.get('/auth/signin').redirects(0);
    expect(res.status).toBe(302);
  });
});
