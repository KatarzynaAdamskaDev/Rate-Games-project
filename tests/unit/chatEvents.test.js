const fs = require('fs');
const path = require('path');
const chatEvents = require('../../utils/chatEvents');

function fakeReq(userId, sessionId = 'sid-' + userId) {
  const handlers = {};
  return {
    session: { user: { id: userId } },
    sessionID: sessionId,
    socket: { setTimeout() {}, setNoDelay() {}, setKeepAlive() {} },
    on(event, fn) { handlers[event] = fn; },
    emit(event) { if (handlers[event]) handlers[event](); },
  };
}

function fakeRes() {
  const handlers = {};
  return {
    written: [],
    ended: false,
    headers: null,
    status() { return this; },
    set(headers) { this.headers = headers; return this; },
    flushHeaders() {},
    write(chunk) { this.written.push(chunk); return true; },
    end() { this.ended = true; },
    on(event, fn) { handlers[event] = fn; },
    emit(event) { if (handlers[event]) handlers[event](); },
    text() { return this.written.join(''); },
  };
}

function open(userId, sessionId) {
  const req = fakeReq(userId, sessionId);
  const res = fakeRes();
  chatEvents.openStream(req, res);
  return { req, res };
}

afterEach(() => chatEvents.closeAll());

describe('czat w czasie rzeczywistym - rejestr strumieni SSE', () => {
  test('otwarcie strumienia ustawia nagłówki SSE i od razu wysyła zdarzenie "ready"', () => {
    const { res } = open('u1');
    expect(res.headers['Content-Type']).toMatch(/text\/event-stream/);
    expect(res.headers['Cache-Control']).toMatch(/no-cache/);
    expect(res.text()).toContain('event: ready');
    expect(chatEvents.connectionCount('u1')).toBe(1);
  });

  test('zdarzenie trafia do podanych użytkowników, do pozostałych nie', () => {
    const a = open('ua');
    const b = open('ub');
    chatEvents.publish(['ua'], 'message', { text: 'cześć' });

    expect(a.res.text()).toContain('event: message\ndata: {"text":"cześć"}\n\n');
    expect(b.res.text()).not.toContain('event: message');
  });

  test('użytkownik z kilkoma kartami dostaje zdarzenie na każdej, a powtórzone id w liście nie dubluje go', () => {
    const tab1 = open('multi');
    const tab2 = open('multi');
    chatEvents.publish(['multi', 'multi'], 'summary', {});
    expect(tab1.res.text().match(/event: summary/g)).toHaveLength(1);
    expect(tab2.res.text().match(/event: summary/g)).toHaveLength(1);
  });

  test('zamknięcie połączenia przez przeglądarkę usuwa je z rejestru', () => {
    const { req, res } = open('gone');
    expect(chatEvents.connectionCount('gone')).toBe(1);
    req.emit('close');
    expect(chatEvents.connectionCount('gone')).toBe(0);
    chatEvents.publish(['gone'], 'message', {});
    expect(res.text()).not.toContain('event: message');
  });

  test('zerwany zapis (wyjątek przy write) nie psuje rozsyłania do reszty', () => {
    const broken = open('broken');
    broken.res.write = () => { throw new Error('EPIPE'); };
    const healthy = open('healthy');
    expect(() => chatEvents.publish(['broken', 'healthy'], 'message', { ok: true })).not.toThrow();
    expect(healthy.res.text()).toContain('"ok":true');
    expect(chatEvents.connectionCount('broken')).toBe(0);
  });

  test('wylogowanie zamyka strumienie tylko tej sesji', () => {
    const laptop = open('same-user', 'sesja-laptop');
    const phone = open('same-user', 'sesja-telefon');
    chatEvents.closeSession('sesja-laptop');

    expect(laptop.res.ended).toBe(true);
    expect(phone.res.ended).toBe(false);
    expect(chatEvents.connectionCount('same-user')).toBe(1);
  });

  test('usunięcie konta zamyka wszystkie strumienie użytkownika', () => {
    const one = open('deleted');
    const two = open('deleted');
    chatEvents.closeUser('deleted');
    expect(one.res.ended && two.res.ended).toBe(true);
    expect(chatEvents.connectionCount('deleted')).toBe(0);
  });

  test('limit połączeń na użytkownika: najstarsze są zamykane', () => {
    const streams = [];
    for (let i = 0; i < chatEvents.MAX_STREAMS_PER_USER + 2; i += 1) streams.push(open('many'));
    expect(chatEvents.connectionCount('many')).toBe(chatEvents.MAX_STREAMS_PER_USER);
    expect(streams[0].res.ended).toBe(true);
    expect(streams[streams.length - 1].res.ended).toBe(false);
    // wyrzucona karta dostaje sygnał, żeby nie łączyć się z powrotem od razu i nie wyrzucać kolejnych w kółko
    expect(streams[0].res.text()).toContain('event: evicted');
    expect(streams[1].res.text()).toContain('event: evicted');
    expect(streams[streams.length - 1].res.text()).not.toContain('event: evicted');
  });
});

describe('czat - spis reakcji', () => {
  test('klucze reakcji na serwerze zgadzają się z ikonami w public/js/chat-core.js', () => {
    // utils/chatHelpers.js ładuje modele - czytamy tylko stałą, bez uruchamiania bazy (plik źródłowy jako tekst).
    const helpers = fs.readFileSync(path.join(__dirname, '../../utils/chatHelpers.js'), 'utf8');
    const serverKeys = helpers.match(/const REACTION_KEYS = \[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map((k) => k.replace(/'/g, ''));

    const client = fs.readFileSync(path.join(__dirname, '../../public/js/chat-core.js'), 'utf8');
    const block = client.match(/var REACTIONS = \[([\s\S]*?)\];/)[1];
    const clientKeys = [...block.matchAll(/key: '([a-z]+)', icon: '(bi-[a-z-]+)'/g)].map((m) => m[1]);

    expect(serverKeys.length).toBeGreaterThan(0);
    expect(clientKeys).toEqual(serverKeys);
  });
});
