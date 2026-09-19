/**
 * Okienka w navbarze: mini czat i powiadomienia (otwierane z animacją),
 * plus plakietki z liczbą nieprzeczytanych wiadomości i powiadomień.
 * Endpointy: /notifications/*, /chat/api/list, /chat/:id/messages.
 */
(function () {
  var chatRoot = document.getElementById('navChat');
  if (!chatRoot) return;

  var JSON_HEADERS = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  var meId = chatRoot.dataset.me;

  var chat = {
    btn: document.getElementById('navChatBtn'),
    panel: document.getElementById('navChatPanel'),
    badge: document.getElementById('navChatBadge'),
    list: document.getElementById('navChatList'),
    view: document.getElementById('navChatView'),
    messages: document.getElementById('navChatMessages'),
    form: document.getElementById('navChatForm'),
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

  function clock(iso) {
    return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }

  function setBadge(el, count) {
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.classList.remove('d-none');
    } else {
      el.classList.add('d-none');
    }
  }

  function refreshSummary() {
    fetch('/notifications/summary', { headers: JSON_HEADERS })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        setBadge(chat.badge, data.messages);
        setBadge(bell.badge, data.notifications);
      })
      .catch(function () {});
  }

  function isOpen(p) { return p.panel.classList.contains('open'); }

  function closePanel(p) {
    p.panel.classList.remove('open');
    p.btn.setAttribute('aria-expanded', 'false');
    if (p === chat) stopPolling();
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

  var current = null; // { id, name }
  var lastTimestamp = null;
  var pollTimer = null;
  var seen = {};

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function showList() {
    stopPolling();
    current = null;
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

      var avatar = document.createElement('span');
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

  function loadConversations() {
    fetch('/chat/api/list', { headers: JSON_HEADERS })
      .then(function (r) { return r.ok ? r.json() : { conversations: [] }; })
      .then(function (data) { renderConversations(data.conversations || []); })
      .catch(function () {});
  }

  function appendMessage(m, type) {
    if (seen[m.id]) return;
    seen[m.id] = true;

    var bubble = document.createElement('div');
    bubble.className = 'nav-msg' + (m.senderId === meId ? ' me' : '');

    if (m.senderId !== meId && type !== 'dm') {
      var author = document.createElement('b');
      author.textContent = m.senderUsername;
      bubble.appendChild(author);
    }
    bubble.appendChild(document.createTextNode(m.text));
    var time = document.createElement('small');
    time.textContent = clock(m.createdAt);
    bubble.appendChild(time);

    chat.messages.appendChild(bubble);
    chat.messages.scrollTop = chat.messages.scrollHeight;
    lastTimestamp = m.createdAt;
  }

  function pollMessages() {
    if (!current) return;
    var id = current.id;
    var url = '/chat/' + encodeURIComponent(id) + '/messages' + (lastTimestamp ? '?after=' + encodeURIComponent(lastTimestamp) : '');
    fetch(url, { headers: JSON_HEADERS })
      .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
      .then(function (data) {
        if (!current || current.id !== id) return;
        (data.messages || []).forEach(function (m) { appendMessage(m, current.type); });
      })
      .catch(function () {});
  }

  function openConversation(conv) {
    current = conv;
    seen = {};
    lastTimestamp = null;
    chat.messages.innerHTML = '';
    chat.list.classList.add('d-none');
    chat.view.classList.remove('d-none');
    chat.back.classList.remove('d-none');
    chat.title.textContent = conv.name;
    chat.full.href = '/chat?c=' + encodeURIComponent(conv.id);

    fetch('/chat/' + encodeURIComponent(conv.id) + '/messages', { headers: JSON_HEADERS })
      .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
      .then(function (data) {
        if (!current || current.id !== conv.id) return;
        (data.messages || []).forEach(function (m) { appendMessage(m, conv.type); });
        refreshSummary();
      })
      .catch(function () {});

    stopPolling();
    pollTimer = setInterval(pollMessages, 4000);
    chat.form.querySelector('input').focus();
  }

  chat.back.addEventListener('click', showList);

  chat.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!current) return;
    var input = chat.form.querySelector('input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';

    var conv = current;
    fetch('/chat/' + encodeURIComponent(conv.id) + '/messages', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, JSON_HEADERS),
      body: 'text=' + encodeURIComponent(text),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.message && current && current.id === conv.id) {
          appendMessage(data.message, conv.type);
        } else if (data.error) {
          // Odrzucona wiadomość (antyspam, filtr, limit) - pokazujemy powód i oddajemy tekst do poprawy.
          if (window.showToast) window.showToast(data.error, false);
          input.value = text;
        }
      })
      .catch(function () {});
  });

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
    [chat, bell].forEach(function (p) {
      if (isOpen(p) && !p.panel.contains(e.target)) closePanel(p);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') [chat, bell].forEach(function (p) { if (isOpen(p)) closePanel(p); });
  });

  refreshSummary();
  setInterval(refreshSummary, 30000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshSummary();
  });
})();
