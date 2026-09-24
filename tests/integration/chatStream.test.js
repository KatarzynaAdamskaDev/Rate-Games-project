const http = require('http');
const { createTestApp } = require('../setup/testApp');
const { csrfToken, userAgent } = require('../setup/factories');

// Prawdziwe połączenie SSE (GET /chat/stream) do prawdziwego serwera HTTP - supertest nie nadaje się do
// strumieni bez końca, więc tu aplikacja nasłuchuje na losowym porcie, a strumień czytamy przez http.get.
describe('czat - strumień zdarzeń (SSE)', () => {
  let ctx;
  let server;
  let port;
  let ala;
  let bob;
  let convId;
  const openRequests = [];

  function cookieHeader(agent) {
    return agent.jar
      .getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false })
      .map((c) => c.toValueString())
      .join('; ');
  }

  /** Otwiera strumień jako dany agent; zwraca obiekt do czekania na fragmenty tekstu. */
  function connect(agent) {
    const state = { text: '', ended: false, status: null, headers: null };
    const waiters = [];
    const req = http.get({ port, path: '/chat/stream', headers: { Cookie: cookieHeader(agent), Accept: 'text/event-stream' } }, (res) => {
      state.status = res.statusCode;
      state.headers = res.headers;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        state.text += chunk;
        waiters.slice().forEach((w) => w());
      });
      res.on('end', () => {
        state.ended = true;
        waiters.slice().forEach((w) => w());
      });
    });
    openRequests.push(req);
    req.on('error', () => {});

    state.waitFor = (predicate, ms = 4000) =>
      new Promise((resolve, reject) => {
        const check = () => {
          if (predicate(state)) {
            const i = waiters.indexOf(check);
            if (i !== -1) waiters.splice(i, 1);
            clearTimeout(timer);
            resolve(state);
          }
        };
        const timer = setTimeout(() => reject(new Error(`Timeout czekania na strumień. Dotąd: ${JSON.stringify(state.text)}`)), ms);
        waiters.push(check);
        check();
      });
    state.close = () => req.destroy();
    return state;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    server = await new Promise((resolve) => {
      const s = ctx.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    port = server.address().port;

    ala = await userAgent(ctx.app, { username: 'strumienala' });
    bob = await userAgent(ctx.app, { username: 'strumienbob' });
    let token = await csrfToken(ala.agent, `/${bob.user.username}`);
    await ala.agent.post(`/profile/follow/${bob.user.username}`).send({ _csrf: token });
    token = await csrfToken(bob.agent, `/${ala.user.username}`);
    await bob.agent.post(`/profile/follow/${ala.user.username}`).send({ _csrf: token });
    token = await csrfToken(ala.agent, '/chat');
    const start = await ala.agent.post(`/chat/start/${bob.user.username}`).send({ _csrf: token }).redirects(0);
    convId = start.headers.location.split('c=')[1];
  });

  afterAll(async () => {
    openRequests.forEach((r) => r.destroy());
    require('../../utils/chatEvents').closeAll();
    await new Promise((resolve) => server.close(resolve));
    await ctx.teardown();
  });

  test('bez logowania strumień nie jest dostępny (nie ma tekstu zdarzeń)', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get({ port, path: '/chat/stream' }, (r) => {
        r.resume();
        resolve(r);
      }).on('error', reject);
    });
    expect(res.headers['content-type'] || '').not.toMatch(/event-stream/);
  });

  test('zalogowany dostaje "ready", potem nową wiadomość wysłaną przez drugą osobę - bez odświeżania', async () => {
    const stream = connect(bob.agent);
    await stream.waitFor((s) => s.text.includes('event: ready'));
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/text\/event-stream/);

    const token = await csrfToken(ala.agent, `/chat?c=${convId}`);
    await ala.agent.post(`/chat/${convId}/messages`).set('Accept', 'application/json').send({ text: 'Cześć Bob, to na żywo', _csrf: token });

    await stream.waitFor((s) => s.text.includes('event: message') && s.text.includes('Cześć Bob, to na żywo'));
    // odbiorca dostaje też sygnał odświeżenia liczników w navbarze
    await stream.waitFor((s) => s.text.includes('event: summary'));
    stream.close();
  });

  test('"pisze..." dociera do drugiej osoby przez strumień', async () => {
    const stream = connect(bob.agent);
    await stream.waitFor((s) => s.text.includes('event: ready'));

    const token = await csrfToken(ala.agent, `/chat?c=${convId}`);
    const res = await ala.agent.post(`/chat/${convId}/typing`).send({ _csrf: token });
    expect(res.status).toBe(204);

    await stream.waitFor((s) => s.text.includes('event: typing') && s.text.includes('strumienala'));
    stream.close();
  });

  test('wylogowanie zamyka strumień tej sesji', async () => {
    const other = await userAgent(ctx.app, { username: 'strumienwylogowany' });
    const stream = connect(other.agent);
    await stream.waitFor((s) => s.text.includes('event: ready'));

    const token = await csrfToken(other.agent, '/chat');
    await other.agent.post('/auth/logout').send({ _csrf: token });

    await stream.waitFor((s) => s.ended);
    expect(stream.ended).toBe(true);
  });
});
