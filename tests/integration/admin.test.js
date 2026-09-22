const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent, adminAgent, createBlogPost } = require('../setup/factories');

describe('panel administratora - uprawnienia i podstawowe działania', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  test('gość jest przekierowany z /admin (bez dostępu)', async () => {
    const res = await request(ctx.app).get('/admin').redirects(0);
    expect(res.status).toBe(302);
  });

  test('zwykły zalogowany użytkownik też nie ma dostępu do /admin', async () => {
    const { agent } = await userAgent(ctx.app);
    const res = await agent.get('/admin').redirects(0);
    expect(res.status).toBe(302);
  });

  test('administrator widzi pulpit z liczbami (statystyki działają na pustej/testowej bazie)', async () => {
    const { agent } = await adminAgent(ctx.app);
    const res = await agent.get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Panel');
  });

  test('zmiana roli na admina wymaga ponownego potwierdzenia hasłem administratora', async () => {
    const { user } = await userAgent(ctx.app, { username: 'awansowany' });
    const { agent, password } = await adminAgent(ctx.app);
    const token = await csrfToken(agent, '/admin/users');

    // Bez potwierdzenia (nazwa konta + hasło administratora) nadanie uprawnień się nie udaje.
    await agent.post(`/admin/users/${user.id}/role`).send({ role: 'admin', _csrf: token });
    await user.reload();
    expect(user.role).toBe('user');

    const res = await agent.post(`/admin/users/${user.id}/role`).send({ role: 'admin', confirmName: user.username, password, _csrf: token });
    expect(res.status).toBe(302);
    await user.reload();
    expect(user.role).toBe('admin');
  });

  test('administrator blokuje konto na czas określony - zablokowany nie może się zalogować', async () => {
    const { user, password } = await userAgent(ctx.app, { username: 'doblokady' });
    const { agent } = await adminAgent(ctx.app);
    const token = await csrfToken(agent, '/admin/users');
    const ban = await agent.post(`/admin/users/${user.id}/ban`).send({ duration: '7d', reason: 'Test blokady', _csrf: token });
    expect(ban.status).toBe(302);

    await user.reload();
    expect(user.isBanned).toBe(true);
    expect(user.bannedUntil).not.toBeNull();

    const guest = request.agent(ctx.app);
    const loginToken = await csrfToken(guest);
    const login = await guest.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.username, password, _csrf: loginToken });
    expect(login.status).toBe(403);
  });

  test('odblokowanie konta pozwala się ponownie zalogować', async () => {
    const { user, password } = await userAgent(ctx.app, { username: 'odblokowany' });
    const { agent } = await adminAgent(ctx.app);
    let token = await csrfToken(agent, '/admin/users');
    await agent.post(`/admin/users/${user.id}/ban`).send({ duration: '1d', _csrf: token });

    token = await csrfToken(agent, '/admin/users');
    await agent.post(`/admin/users/${user.id}/unban`).send({ _csrf: token });
    await user.reload();
    expect(user.isBanned).toBe(false);

    const guest = request.agent(ctx.app);
    const loginToken = await csrfToken(guest);
    const login = await guest.post('/auth/signin').set('Accept', 'application/json').send({ identifier: user.username, password, _csrf: loginToken });
    expect(login.status).toBe(200);
  });

  test('administrator może usunąć wpis bloga z poziomu panelu', async () => {
    const post = await createBlogPost({ title: 'Wpis do usunięcia z panelu admina' });
    const { agent } = await adminAgent(ctx.app);
    const token = await csrfToken(agent, '/admin/blog');
    const res = await agent.post(`/admin/blog/${post.id}/delete`).send({ _csrf: token });
    expect(res.status).toBe(302);

    const { findPost } = require('../../utils/blogHelpers');
    expect(await findPost(post.id)).toBeNull();
  });

  test('każde działanie administratora zapisuje się w dzienniku', async () => {
    const { user } = await userAgent(ctx.app, { username: 'wdzienniku' });
    const { agent } = await adminAgent(ctx.app);
    const token = await csrfToken(agent, '/admin/users');
    await agent.post(`/admin/users/${user.id}/mute`).send({ duration: '1d', _csrf: token });

    const AdminLog = require('../../models/AdminLog');
    const entry = await AdminLog.findOne({ where: { targetLabel: 'wdzienniku' }, order: [['createdAt', 'DESC']] });
    expect(entry).not.toBeNull();
    expect(entry.action).toMatch(/mute/);
  });
});
