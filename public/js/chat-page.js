/**
 * Strona /chat: lista rozmów po lewej (odświeżana zdarzeniami SSE), otwarta rozmowa (wspólny kod z mini czatem -
 * chat-core.js), przełącznik odpowiedzi dla administratora i rozwijana lista członków grupy.
 */
(function () {
  'use strict';

  function init() {
    var chat = window.GVChat;
    var col = document.getElementById('chatListCol');
    if (!chat || !col) return;

    var chatBody = document.getElementById('chatBody');
    var navRoot = document.getElementById('navChat');
    var meId = (chatBody && chatBody.dataset.me) || (navRoot && navRoot.dataset.me) || '';
    var activeId = col.dataset.active || null;
    var navigating = false; // trwa wysyłanie formularza (np. usunięcie grupy) - nie przeładowujemy strony na siłę
    var view = null;

    document.addEventListener('submit', function () { navigating = true; });

    function toast(message, ok) {
      if (window.showToast) window.showToast(message, !!ok);
    }

    /** Strona wymaga odświeżenia (np. zmieniły się uprawnienia) - robimy to tylko, gdy nikt akurat nie pisze. */
    function reloadIfIdle(message) {
      if (navigating) return;
      var input = document.getElementById('chatText');
      var modalOpen = !!document.querySelector('.modal.show');
      if ((input && input.value.trim()) || modalOpen) {
        toast(message + ' Odśwież stronę, aby zobaczyć zmiany.', true);
        return;
      }
      toast(message, true);
      setTimeout(function () { if (!navigating) window.location.reload(); }, 900);
    }

    /* ------------------------------ lista rozmów ------------------------------ */

    var dmBox = document.getElementById('dmConversationList');
    var groupBox = document.getElementById('groupConversationList');

    function timeAgo(iso) {
      var seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
      if (seconds < 60) return 'przed chwilą';
      if (seconds < 3600) return Math.floor(seconds / 60) + ' min temu';
      if (seconds < 86400) return Math.floor(seconds / 3600) + ' godz. temu';
      return new Date(iso).toLocaleDateString('pl-PL');
    }

    function renderItem(c) {
      var a = document.createElement('a');
      a.href = '/chat?c=' + encodeURIComponent(c.id);
      a.className = 'gv-chat-item text-decoration-none' + (c.id === activeId ? ' active' : '');

      var avatar;
      if (c.avatarUrl) {
        avatar = document.createElement('img');
        avatar.src = c.avatarUrl;
        avatar.alt = '';
        avatar.style.objectFit = 'cover';
      } else {
        avatar = document.createElement('div');
      }
      avatar.className = 'gv-c-avatar';

      var info = document.createElement('div');
      var name = document.createElement('b');
      name.textContent = c.name;
      var meta = document.createElement('span');
      if (c.type === 'dm') {
        meta.textContent = 'Rozmowa prywatna';
      } else if (c.lastMessage) {
        meta.textContent = (c.lastMessage.mine ? 'Ty: ' : c.lastMessage.senderUsername + ': ') + c.lastMessage.text;
      } else {
        meta.textContent = 'Brak wiadomości';
      }
      info.appendChild(name);
      info.appendChild(meta);

      a.appendChild(avatar);
      a.appendChild(info);
      // Otwarta rozmowa jest na ekranie, więc jej wiadomości są przeczytane (serwer oznacza je chwilę później).
      if (c.unread > 0 && c.id !== activeId) {
        var badge = document.createElement('span');
        badge.className = 'gv-chat-unread';
        badge.textContent = String(c.unread);
        a.appendChild(badge);
      }
      return a;
    }

    function renderList(box, items, emptyText) {
      box.innerHTML = '';
      if (items.length === 0) {
        if (!emptyText) return;
        var empty = document.createElement('p');
        empty.className = 'gv-game-card-count px-2';
        empty.style.color = 'var(--text-lo)';
        empty.style.fontSize = '11.5px';
        empty.textContent = emptyText;
        box.appendChild(empty);
        return;
      }
      items.forEach(function (c) { box.appendChild(renderItem(c)); });
    }

    var sidebarBusy = false;
    var sidebarTimer = null;
    var lastSidebar = 0;

    function refreshSidebar() {
      if (!dmBox || !groupBox || sidebarBusy) return;
      sidebarBusy = true;
      fetch('/chat/api/list', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          var items = data.conversations || [];
          renderList(dmBox, items.filter(function (c) { return c.type === 'dm'; }), 'Brak rozmów. Napisz do kogoś powyżej.');
          renderList(groupBox, items.filter(function (c) { return c.type === 'group'; }), null);
        })
        .catch(function () {})
        .then(function () {
          sidebarBusy = false;
          lastSidebar = Date.now();
        });
    }

    // Wiele zdarzeń naraz (np. seria wiadomości) to jedno odświeżenie listy.
    function refreshSidebarSoon() {
      clearTimeout(sidebarTimer);
      sidebarTimer = setTimeout(refreshSidebar, 300);
    }

    chat.Stream.on('message', refreshSidebarSoon);
    chat.Stream.on('sync', function (d) {
      refreshSidebarSoon();
      // Zaproszenia do grup są renderowane po stronie serwera - nowe pojawią się po odświeżeniu strony.
      if (d.reason === 'invite') reloadIfIdle('Masz nowe zaproszenie do grupy.');
    });
    chat.Stream.on('open', refreshSidebarSoon);

    // Siatka bezpieczeństwa: rzadko przy działającym strumieniu, często bez niego.
    setInterval(function () {
      if (document.hidden) return;
      var every = chat.Stream.isOpen() ? 30000 : 6000;
      if (Date.now() - lastSidebar >= every) refreshSidebar();
    }, 2000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshSidebar();
    });

    /* ------------------------------ otwarta rozmowa ------------------------------ */

    if (chatBody) {
      var initial = [];
      try { initial = JSON.parse(chatBody.dataset.messages || '[]'); } catch (err) { initial = []; }

      view = new chat.ChatView({
        listEl: chatBody,
        composerHost: document.getElementById('chatComposerHost'),
        variant: 'full',
        ids: true,
        meId: meId,
        isAdmin: chatBody.dataset.admin === 'true',
        disabledReason: 'Administrator wysłał tę wiadomość bez możliwości odpowiedzi.',
        onGone: function () {
          if (navigating) return;
          toast('Ta rozmowa nie jest już dostępna.', false);
          setTimeout(function () { window.location.href = '/chat'; }, 900);
        },
        onMeta: function () { reloadIfIdle('Zmieniły się ustawienia tej rozmowy.'); },
      });
      view.open(
        { id: chatBody.dataset.conversation, type: chatBody.dataset.type, canReply: chatBody.dataset.canReply !== 'false' },
        initial
      );
    }

    /* ------------------- przełącznik odpowiedzi (tylko administrator) ------------------- */

    // Jedyne miejsce, w którym ustawia się możliwość odpowiedzi w rozmowie prywatnej
    // (patrz routes/chat.js, POST toggle-reply).
    var toggleReplyBtn = document.getElementById('toggleReplyBtn');
    if (toggleReplyBtn) {
      toggleReplyBtn.addEventListener('click', function () {
        if (toggleReplyBtn.disabled) return;
        toggleReplyBtn.disabled = true;
        fetch('/chat/' + encodeURIComponent(toggleReplyBtn.dataset.conversation) + '/toggle-reply', {
          method: 'POST',
          headers: { Accept: 'application/json' },
        })
          .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error((res.data && res.data.error) || 'Błąd');
            var canReply = res.data.canReply;
            toggleReplyBtn.querySelector('i').className = 'bi ' + (canReply ? 'bi-chat-dots-fill' : 'bi-chat-slash-fill');
            toggleReplyBtn.title = canReply ? 'Wyłącz możliwość odpowiedzi' : 'Włącz możliwość odpowiedzi';
            toggleReplyBtn.dataset.canReply = String(canReply);
            var meta = document.getElementById('conversationMeta');
            var badge = document.getElementById('canReplyBadge');
            if (canReply && badge) {
              badge.remove();
            } else if (!canReply && !badge && meta) {
              badge = document.createElement('span');
              badge.className = 'gv-badge gv-badge-warn';
              badge.id = 'canReplyBadge';
              badge.title = 'Tylko administrator może pisać w tej rozmowie';
              badge.textContent = 'bez możliwości odpowiedzi';
              meta.appendChild(badge);
            }
            if (view) view.setCanReply(canReply);
          })
          .catch(function () { toast('Nie udało się zmienić ustawienia odpowiedzi. Spróbuj ponownie.', false); })
          .then(function () { toggleReplyBtn.disabled = false; });
      });
    }

    /* ------------------------- lista członków grupy ------------------------- */

    var groupToggle = document.getElementById('groupMembersToggle');
    var groupDropdown = document.getElementById('groupMembersDropdown');
    if (groupToggle && groupDropdown) {
      groupToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = groupDropdown.classList.toggle('d-none') === false;
        groupToggle.classList.toggle('open', isOpen);
      });
      document.addEventListener('click', function (e) {
        if (!groupDropdown.contains(e.target) && e.target !== groupToggle) {
          groupDropdown.classList.add('d-none');
          groupToggle.classList.remove('open');
        }
      });
    }
  }

  // chat-core.js jest ładowany z atrybutem defer w navbarze, więc na tym etapie już istnieje window.GVChat.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
