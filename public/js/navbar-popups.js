/**
 * Okienka w navbarze: mini czat i powiadomienia (otwierane z animacją),
 * plus plakietki z liczbą nieprzeczytanych wiadomości i powiadomień.
 * Endpointy: /notifications/*, /chat/api/list, /chat/:id/messages. Wiadomości w mini czacie renderuje i obsługuje
 * wspólny kod z chat-core.js (odpowiedzi, edycja, reakcje, emoji, GIF-y); nowe zdarzenia przychodzą strumieniem SSE.
 */
(function () {
  var chatRoot = document.getElementById('navChat');
  if (!chatRoot || !window.GVChat) return;

  var GV = window.GVChat;
  var JSON_HEADERS = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  var meId = chatRoot.dataset.me;
  var isAdmin = chatRoot.dataset.admin === 'true';

  var chat = {
    btn: document.getElementById('navChatBtn'),
    panel: document.getElementById('navChatPanel'),
    badge: document.getElementById('navChatBadge'),
    list: document.getElementById('navChatList'),
    view: document.getElementById('navChatView'),
    messages: document.getElementById('navChatMessages'),
    composer: document.getElementById('navChatComposer'),
    title: document.getElementById('navChatTitle'),
    back: document.getElementById('navChatBack'),
    full: document.getElementById('navChatFull'),
  };
  var bell = {
    btn: document.getElementById('navBellBtn'),
    panel: document.getElementById('navNotifPanel'),
    badge: document.getElementById('navBellBadge'),
    list: document.getElementById('navNotifList'),
    readAll: document.getElementById('navNotifReadAll'),
  };

  /* ------------------------------ wspólne ------------------------------ */

  function timeAgo(iso) {
    var seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return 'przed chwilą';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min temu';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' godz. temu';
    return new Date(iso).toLocaleDateString('pl-PL');
  }

  function setBadge(el, count) {
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.classList.remove('d-none');
    } else {
      el.classList.add('d-none');
    }
  }

  // Zabezpieczenie przed nakładaniem się zapytań: jeśli serwer akurat odpowiada wolniej
  // (np. baza jest chwilowo zajęta zapisem wiadomości), kolejne wywołanie NIE odpala nowego
  // fetcha na stos - czeka, aż poprzedni się zakończy.
  var summaryInFlight = false;
  var lastSummary = 0;

  function refreshSummary() {
    if (summaryInFlight) return;
    summaryInFlight = true;
    fetch('/notifications/summary', { headers: JSON_HEADERS })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        setBadge(chat.badge, data.messages);
        setBadge(bell.badge, data.notifications);
      })
      .catch(function () {})
      .then(function () {
        summaryInFlight = false;
        lastSummary = Date.now();
      });
  }

  function isOpen(p) { return p.panel.classList.contains('open'); }

  function closePanel(p) {
    p.panel.classList.remove('open');
    p.btn.setAttribute('aria-expanded', 'false');
    if (p === chat && chatView) chatView.close();
  }

  function openPanel(p) {
    [chat, bell].forEach(function (other) { if (other !== p && isOpen(other)) closePanel(other); });
    p.panel.classList.add('open');
    p.btn.setAttribute('aria-expanded', 'true');
  }

  /* ------------------------------ powiadomienia ------------------------------ */

  function renderNotifications(items) {
    bell.list.innerHTML = '';
    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'nav-panel-empty';
      empty.textContent = 'Nie masz jeszcze żadnych powiadomień.';
      bell.list.appendChild(empty);
      return;
    }
    items.forEach(function (n) {
      var link = document.createElement('a');
      link.href = '/notifications/' + encodeURIComponent(n.id) + '/open';
      link.className = 'nav-notif-item' + (n.isRead ? '' : ' unread');
      var text = document.createElement('span');
      text.textContent = n.message;
      var time = document.createElement('small');
      time.textContent = timeAgo(n.createdAt);
      link.appendChild(text);
      link.appendChild(time);
      bell.list.appendChild(link);
    });
  }

  function loadNotifications() {
    fetch('/notifications/list', { headers: JSON_HEADERS })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (data) { renderNotifications(data.items || []); })
      .catch(function () {});
  }

  bell.btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (isOpen(bell)) {
      closePanel(bell);
    } else {
      openPanel(bell);
      loadNotifications();
    }
  });

  bell.readAll.addEventListener('click', function () {
    fetch('/notifications/read-all', { method: 'POST', headers: JSON_HEADERS })
      .then(function () { loadNotifications(); refreshSummary(); });
  });

  /* ------------------------------ mini czat ------------------------------ */

  var chatView = null; // widok otwartej rozmowy (wspólny kod z pełnym czatem) - tworzony przy pierwszym otwarciu

  function ensureView() {
    if (chatView) return chatView;
    chatView = new GV.ChatView({
      listEl: chat.messages,
      composerHost: chat.composer,
      variant: 'mini',
      ids: false,
      meId: meId,
      isAdmin: isAdmin,
      onGone: showList, // rozmowa usunięta albo już nas w niej nie ma
      onMeta: loadConversations,
      onIncoming: refreshSummary, // otwarcie/odczyt rozmowy zmienia licznik nieprzeczytanych
    });
    return chatView;
  }

  function showList() {
    if (chatView) chatView.close();
    chat.view.classList.add('d-none');
    chat.list.classList.remove('d-none');
    chat.back.classList.add('d-none');
    chat.title.textContent = 'Czat';
    chat.full.href = '/chat';
    loadConversations();
  }

  function renderConversations(items) {
    chat.list.innerHTML = '';
    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'nav-panel-empty';
      empty.textContent = 'Nie masz jeszcze żadnych rozmów. Rozpocznij je w pełnym czacie.';
      chat.list.appendChild(empty);
      return;
    }
    items.forEach(function (c) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'nav-chat-item';

      var avatar;
      if (c.avatarUrl) {
        avatar = document.createElement('img');
        avatar.src = c.avatarUrl;
        avatar.alt = '';
        avatar.style.objectFit = 'cover';
      } else {
        avatar = document.createElement('span');
      }
      avatar.className = 'nav-chat-avatar';

      var info = document.createElement('span');
      info.className = 'nav-chat-info';
      var name = document.createElement('b');
      name.textContent = c.name;
      var preview = document.createElement('small');
      if (c.lastMessage) {
        preview.textContent = (c.lastMessage.mine ? 'Ty: ' : c.type === 'dm' ? '' : c.lastMessage.senderUsername + ': ') + c.lastMessage.text;
      } else {
        preview.textContent = 'Brak wiadomości';
      }
      info.appendChild(name);
      info.appendChild(preview);

      var meta = document.createElement('span');
      meta.className = 'nav-chat-meta';
      if (c.lastMessage) {
        var time = document.createElement('small');
        time.textContent = timeAgo(c.lastMessage.createdAt);
        meta.appendChild(time);
      }
      if (c.unread > 0) {
        var unread = document.createElement('span');
        unread.className = 'nav-chat-unread';
        unread.textContent = String(c.unread);
        meta.appendChild(unread);
      }

      item.appendChild(avatar);
      item.appendChild(info);
      item.appendChild(meta);
      item.addEventListener('click', function () { openConversation(c); });
      chat.list.appendChild(item);
    });
  }

  var listInFlight = false;

  function loadConversations() {
    if (listInFlight) return;
    listInFlight = true;
    fetch('/chat/api/list', { headers: JSON_HEADERS })
      .then(function (r) { return r.ok ? r.json() : { conversations: [] }; })
      .then(function (data) {
        // Lista jest widoczna tylko gdy nie ma otwartej rozmowy - inaczej nie ma czego przerysowywać.
        if (!chat.list.classList.contains('d-none')) renderConversations(data.conversations || []);
      })
      .catch(function () {})
      .then(function () { listInFlight = false; });
  }

  function openConversation(conv) {
    chat.list.classList.add('d-none');
    chat.view.classList.remove('d-none');
    chat.back.classList.remove('d-none');
    chat.title.textContent = conv.name;
    chat.full.href = '/chat?c=' + encodeURIComponent(conv.id);
    ensureView().open({ id: conv.id, type: conv.type, canReply: conv.canReply });
    chatView.composer.focus();
  }

  chat.back.addEventListener('click', showList);

  chat.btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (isOpen(chat)) {
      closePanel(chat);
    } else {
      openPanel(chat);
      showList();
    }
  });

  /* ------------------------------ zamykanie i odświeżanie ------------------------------ */

  document.addEventListener('click', function (e) {
    // Panel reakcji i menu wiadomości są doklejane do <body> poza panelem - to nie jest "klik obok".
    if (e.target.closest('.gv-react-pop')) return;
    [chat, bell].forEach(function (p) {
      if (isOpen(p) && !p.panel.contains(e.target)) closePanel(p);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') [chat, bell].forEach(function (p) { if (isOpen(p)) closePanel(p); });
  });

  // Plakietki odświeżają się od razu po zdarzeniu ze strumienia (nowa wiadomość, nowe powiadomienie).
  // Zwykłe odpytywanie zostaje jako siatka bezpieczeństwa: rzadko przy działającym strumieniu (zdarzenia
  // mogły pójść do innej instancji serwera), co kilka sekund bez niego. Karta w tle w ogóle nie pyta.
  GV.Stream.on('summary', refreshSummary);
  GV.Stream.on('open', refreshSummary);
  GV.Stream.on('message', function () { if (isOpen(chat)) loadConversations(); });
  GV.Stream.on('sync', function () { if (isOpen(chat)) loadConversations(); });

  refreshSummary();
  setInterval(function () {
    if (document.hidden) return;
    var every = GV.Stream.isOpen() ? 30000 : 4000;
    if (Date.now() - lastSummary >= every) refreshSummary();
  }, 2000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshSummary();
  });
})();
