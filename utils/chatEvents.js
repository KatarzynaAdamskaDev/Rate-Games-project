/**
 * Czat w czasie rzeczywistym: strumień Server-Sent Events (SSE) na użytkownika.
 *
 * Przeglądarka otwiera jedno połączenie GET /chat/stream (EventSource) i dostaje przez nie zdarzenia:
 *   message  - nowa, zmieniona (edycja, usunięcie, reakcja) wiadomość: { conversationId, message }
 *   typing   - ktoś pisze: { conversationId, userId, username }
 *   sync     - zmieniła się sama rozmowa (nowa, usunięta, wyczyszczona, ustawienia...): { conversationId, reason }
 *   summary  - zmieniły się liczniki w navbarze (nowe powiadomienie, nowa wiadomość) - klient dociąga /notifications/summary
 *
 * Rejestr połączeń jest w pamięci procesu (tak jak liczniki limitów zapytań), więc działa w obrębie jednej
 * instancji serwera. Dlatego klient dodatkowo, rzadko dociąga zmiany zwykłym zapytaniem (patrz public/js/chat-core.js) -
 * przy kilku instancjach za balanserem nic nie ginie, tylko dociera z opóźnieniem.
 */

const HEARTBEAT_MS = 25 * 1000; // komentarz co 25 s - proxy (Azure ma limit ~230 s bezczynności) nie zamyka połączenia
const MAX_STREAMS_PER_USER = 20; // kilka kart i urządzeń, ale nie w nieskończoność (powyżej limitu najstarsze są zamykane)

// userId -> Set<{ res, sessionId }>
const clients = new Map();

function removeClient(userId, entry) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(entry);
  if (set.size === 0) clients.delete(userId);
}

function endClient(userId, entry, { evicted = false } = {}) {
  removeClient(userId, entry);
  try {
    // Wyrzucona nadmiarowa karta dostaje informację, żeby nie łączyła się od razu z powrotem (to wyrzucałoby
    // kolejne karty w kółko) - przechodzi na zwykłe, rzadsze odpytywanie serwera.
    if (evicted) entry.res.write('event: evicted\ndata: {}\n\n');
    entry.res.end();
  } catch (err) {
    // połączenie już zamknięte
  }
}

/** Otwiera strumień SSE dla zalogowanego użytkownika. Zwraca funkcję zamykającą. */
function openStream(req, res) {
  const userId = req.session.user.id;

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx/proxy: nie buforuj strumienia
  });
  if (req.socket) {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
  }
  res.flushHeaders();
  res.write('retry: 3000\n');
  res.write('event: ready\ndata: {}\n\n');

  const entry = { res, sessionId: req.sessionID };
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(entry);

  // Najstarsze połączenia ponad limit zamykamy - przeglądarka i tak sama je odtworzy, jeśli karta żyje.
  while (set.size > MAX_STREAMS_PER_USER) {
    endClient(userId, set.values().next().value, { evicted: true });
  }

  const cleanup = () => removeClient(userId, entry);
  req.on('close', cleanup);
  res.on('close', cleanup);
  return () => endClient(userId, entry);
}

function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Wysyła zdarzenie do wszystkich otwartych strumieni podanych użytkowników. */
function publish(userIds, event, data = {}) {
  const unique = new Set(userIds || []);
  unique.forEach((userId) => {
    const set = clients.get(userId);
    if (!set) return;
    [...set].forEach((entry) => {
      try {
        writeEvent(entry.res, event, data);
      } catch (err) {
        removeClient(userId, entry);
      }
    });
  });
}

/** Po wylogowaniu zamykamy strumienie tej sesji - wylogowana osoba nie może dalej dostawać wiadomości. */
function closeSession(sessionId) {
  if (!sessionId) return;
  [...clients.entries()].forEach(([userId, set]) => {
    [...set].forEach((entry) => {
      if (entry.sessionId === sessionId) endClient(userId, entry);
    });
  });
}

/** Zamyka wszystkie strumienie użytkownika (np. po usunięciu konta). */
function closeUser(userId) {
  const set = clients.get(userId);
  if (!set) return;
  [...set].forEach((entry) => endClient(userId, entry));
}

function connectionCount(userId) {
  if (userId) return (clients.get(userId) || new Set()).size;
  let total = 0;
  clients.forEach((set) => {
    total += set.size;
  });
  return total;
}

/** Zamyka wszystko (zamykanie serwera, testy). */
function closeAll() {
  [...clients.entries()].forEach(([userId, set]) => {
    [...set].forEach((entry) => endClient(userId, entry));
  });
}

const heartbeatTimer = setInterval(() => {
  clients.forEach((set, userId) => {
    [...set].forEach((entry) => {
      try {
        entry.res.write(': ping\n\n');
      } catch (err) {
        removeClient(userId, entry);
      }
    });
  });
}, HEARTBEAT_MS);
heartbeatTimer.unref();

module.exports = { openStream, publish, closeSession, closeUser, closeAll, connectionCount, MAX_STREAMS_PER_USER };
