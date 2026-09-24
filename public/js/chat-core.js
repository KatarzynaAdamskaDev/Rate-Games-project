/**
 * Wspólny kod czatu - używają go pełna strona /chat (chat-page.js) i mini czat w navbarze (navbar-popups.js).
 * Dzięki temu wiadomość wygląda i działa tak samo w obu miejscach: odpowiedzi jak w Messengerze (cytat),
 * edycja i usuwanie własnych wiadomości, reakcje, "pisze...", emoji i GIF-y.
 *
 * Aktualizacje idą strumieniem SSE (GET /chat/stream, zob. utils/chatEvents.js). Gdy strumień nie działa
 * (stary proxy, zerwane połączenie) albo zdarzenie poszło do innej instancji serwera, widok dociąga zmiany
 * zwykłym zapytaniem (/chat/:id/messages?since=...) - rzadziej przy działającym strumieniu, częściej bez niego.
 *
 * Udostępnia window.GVChat: { Stream, ChatView, REACTIONS }.
 */
(function () {
  'use strict';

  var JSON_HEADERS = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
  var FORM_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };

  var FAST_CATCHUP_MS = 4000; // bez strumienia
  var SLOW_CATCHUP_MS = 20000; // przy działającym strumieniu (siatka bezpieczeństwa)
  var TYPING_SEND_EVERY_MS = 2500;
  var TYPING_SHOWN_FOR_MS = 4500;
  var REPLY_PREVIEW_LENGTH = 120;

  // Klucze muszą się zgadzać z REACTION_KEYS w utils/chatHelpers.js (pilnuje tego test jednostkowy).
  var REACTIONS = [
    { key: 'like', icon: 'bi-hand-thumbs-up-fill', label: 'Super' },
    { key: 'love', icon: 'bi-heart-fill', label: 'Kocham' },
    { key: 'haha', icon: 'bi-emoji-laughing-fill', label: 'Haha' },
    { key: 'wow', icon: 'bi-emoji-surprise-fill', label: 'Wow' },
    { key: 'sad', icon: 'bi-emoji-frown-fill', label: 'Smutne' },
    { key: 'fire', icon: 'bi-fire', label: 'Ogień' },
  ];
  var REACTION_BY_KEY = {};
  REACTIONS.forEach(function (r) { REACTION_BY_KEY[r.key] = r; });

  // Emoji do wstawiania w wiadomość, zapisane jako punkty kodowe Unicode (kilka po myślniku = jeden znak złożony).
  var EMOJI_CODES = (
    '1F600 1F602 1F605 1F60A 1F60D 1F60E 1F914 1F634 1F62D 1F621 1F973 1F631 1F92F 1F644 1F609 1F643 ' +
    '1F44D 1F44E 1F44F 1F64C 1F64F 1F4AA 1F440 1F525 1F4AF 1F389 2764-FE0F 1F494 2B50 2705 1F3AE ' +
    '1F579-FE0F 1F3C6 2694-FE0F 1F6E1-FE0F 1F480 1F47E 1F680'
  ).split(' ');

  function emojiFromCodes(codes) {
    return String.fromCodePoint.apply(null, codes.split('-').map(function (hex) { return parseInt(hex, 16); }));
  }

  /* ------------------------------ narzędzia ------------------------------ */

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(name) {
    var i = document.createElement('i');
    i.className = 'bi ' + name;
    return i;
  }

  function clock(iso) {
    return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }

  function toast(message, ok) {
    if (window.showToast) window.showToast(message, !!ok);
  }

  function encodeForm(data) {
    return Object.keys(data || {})
      .filter(function (k) { return data[k] !== undefined && data[k] !== null; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]); })
      .join('&');
  }

  /** fetch z JSON-em: zawsze rozwiązuje się do { ok, status, data } (data to {} przy pustej/błędnej odpowiedzi). */
  function request(url, method, data) {
    var options = { method: method || 'GET', credentials: 'same-origin', headers: JSON_HEADERS };
    if (options.method === 'POST') {
      options.headers = FORM_HEADERS;
      options.body = encodeForm(data);
    }
    return fetch(url, options).then(function (r) {
      return r.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        return { ok: r.ok, status: r.status, data: body || {} };
      });
    });
  }

  function convUrl(conv, suffix) {
    return '/chat/' + encodeURIComponent(conv.id) + suffix;
  }

  /* ------------------------------ strumień SSE ------------------------------ */

  var Stream = (function () {
    var listeners = {};
    var source = null;
    var connected = false;
    var retryTimer = null;

    function on(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    }

    function emit(type, data) {
      (listeners[type] || []).slice().forEach(function (fn) {
        try { fn(data); } catch (err) { console.error(err); }
      });
    }

    function connect() {
      if (source || !window.EventSource) return;
      source = new EventSource('/chat/stream');
      source.addEventListener('ready', function () {
        connected = true;
        emit('open', {});
      });
      ['message', 'typing', 'sync', 'summary'].forEach(function (type) {
        source.addEventListener(type, function (e) {
          var data = {};
          try { data = JSON.parse(e.data); } catch (err) { data = {}; }
          emit(type, data);
        });
      });
      // Serwer wyrzucił tę kartę (za dużo otwartych kart tego użytkownika) - nie łączymy się od razu z powrotem,
      // bo wyrzucałoby to kolejne karty w kółko. Czat działa dalej na zwykłym odpytywaniu, a po minucie próbujemy znowu.
      source.addEventListener('evicted', function () {
        if (source) source.close();
        source = null;
        if (connected) {
          connected = false;
          emit('close', {});
        }
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 60000);
      });
      source.onerror = function () {
        if (connected) {
          connected = false;
          emit('close', {});
        }
        // Przeglądarka sama ponawia próbę; jeśli połączenie odrzucono na stałe (CLOSED), próbujemy później ręcznie.
        if (source && source.readyState === 2) {
          source.close();
          source = null;
          clearTimeout(retryTimer);
          retryTimer = setTimeout(connect, 10000);
        }
      };
    }

    window.addEventListener('pagehide', function () {
      if (source) source.close();
    });

    return { on: on, connect: connect, isOpen: function () { return connected; } };
  })();

  /* ------------------------------ wybór reakcji ------------------------------ */

  var reactionPop = null;

  function closeReactionPicker() {
    if (reactionPop) {
      reactionPop.remove();
      reactionPop = null;
    }
  }

  function openReactionPicker(anchor, message, meId, onPick) {
    closeReactionPicker();
    var mine = null;
    (message.reactions || []).forEach(function (r) {
      if (r.userIds.indexOf(meId) !== -1) mine = r.key;
    });

    var pop = make('div', 'gv-react-pop');
    pop.setAttribute('role', 'menu');
    REACTIONS.forEach(function (r) {
      var btn = make('button', 'gv-react-pop-btn gv-rx-' + r.key + (mine === r.key ? ' active' : ''));
      btn.type = 'button';
      btn.title = r.label;
      btn.setAttribute('aria-label', r.label);
      btn.appendChild(icon(r.icon));
      btn.addEventListener('click', function () {
        closeReactionPicker();
        onPick(r.key);
      });
      pop.appendChild(btn);
    });
    document.body.appendChild(pop);

    var rect = anchor.getBoundingClientRect();
    var left = Math.min(Math.max(8, rect.left + rect.width / 2 - pop.offsetWidth / 2), window.innerWidth - pop.offsetWidth - 8);
    var top = rect.top - pop.offsetHeight - 6;
    if (top < 8) top = rect.bottom + 6;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    reactionPop = pop;
  }

  document.addEventListener('click', function (e) {
    if (reactionPop && !reactionPop.contains(e.target) && !e.target.closest('.gv-mc-action-react')) closeReactionPicker();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeReactionPicker();
  });
  window.addEventListener('scroll', closeReactionPicker, true);
  window.addEventListener('resize', closeReactionPicker);

  /* ------------------------------ wiadomość ------------------------------ */

  function previewOf(m) {
    if (m.deleted) return '';
    return m.kind === 'gif' ? '' : String(m.text || '').slice(0, REPLY_PREVIEW_LENGTH);
  }

  function renderQuote(ref, list) {
    var quote = make('button', 'gv-mc-quote' + (ref.deleted ? ' gone' : ''));
    quote.type = 'button';
    quote.title = ref.deleted ? 'Wiadomość została usunięta' : 'Pokaż oryginalną wiadomość';
    quote.appendChild(make('b', null, ref.deleted && !ref.senderUsername ? 'Wiadomość' : ref.senderUsername));
    var body = make('span');
    if (ref.deleted) {
      body.appendChild(icon('bi-slash-circle'));
      body.appendChild(document.createTextNode(' Wiadomość została usunięta'));
    } else if (ref.kind === 'gif') {
      body.appendChild(icon('bi-filetype-gif'));
      body.appendChild(document.createTextNode(' GIF'));
    } else {
      body.textContent = ref.preview;
    }
    quote.appendChild(body);
    quote.addEventListener('click', function (e) {
      e.stopPropagation();
      list.scrollToMessage(ref.id);
    });
    return quote;
  }

  function renderMessage(m, list) {
    var o = list.opts;
    var mine = m.senderId === o.meId;
    var node = make('div', o.baseClass + (mine ? ' me' : '') + (m.deleted ? ' gv-mc-gone' : ''));
    node.dataset.id = m.id;

    // Autor: w pełnym czacie przy każdej cudzej wiadomości, w mini czacie tylko poza rozmowami prywatnymi.
    if (!mine && (o.variant === 'full' || o.getType() !== 'dm')) {
      var name = make('b', null, m.senderUsername);
      if (m.senderDeleted) {
        name.className = 'gv-msg-deleted';
        node.appendChild(name);
      } else {
        var link = make('a', 'gv-chat-name-link');
        link.href = '/' + encodeURIComponent(m.senderUsername);
        link.appendChild(name);
        node.appendChild(link);
      }
    }

    if (m.replyTo) node.appendChild(renderQuote(m.replyTo, list));

    if (m.deleted) {
      var gone = make('span', 'gv-mc-deleted-text');
      gone.appendChild(icon('bi-slash-circle'));
      gone.appendChild(document.createTextNode(' Wiadomość została usunięta'));
      node.appendChild(gone);
    } else if (m.kind === 'gif') {
      var img = make('img', 'gv-msg-gif');
      img.src = m.text;
      img.alt = 'GIF';
      img.loading = 'lazy';
      img.addEventListener('load', function () { list.onMediaLoad(); });
      node.appendChild(img);
    } else {
      node.appendChild(make('span', 'gv-mc-text', m.text));
    }

    var meta = make('small', 'gv-mc-meta', clock(m.createdAt) + (m.editedAt && !m.deleted ? ' · edytowano' : ''));
    node.appendChild(meta);

    if (!m.deleted && m.reactions && m.reactions.length > 0) {
      var row = make('div', 'gv-mc-reactions');
      m.reactions.forEach(function (r) {
        var def = REACTION_BY_KEY[r.key];
        if (!def) return;
        var chip = make('button', 'gv-mc-reaction gv-rx-' + r.key + (r.userIds.indexOf(o.meId) !== -1 ? ' mine' : ''));
        chip.type = 'button';
        chip.title = def.label + ': ' + r.usernames.join(', ');
        chip.appendChild(icon(def.icon));
        chip.appendChild(make('span', null, String(r.userIds.length)));
        chip.addEventListener('click', function (e) {
          e.stopPropagation();
          if (o.canPost()) o.handlers.onReact(m, r.key);
        });
        row.appendChild(chip);
      });
      node.appendChild(row);
    }

    if (!m.deleted) node.appendChild(renderActions(m, mine, list));
    return node;
  }

  function actionButton(iconName, title, extraClass, onClick) {
    var btn = make('button', 'gv-mc-action' + (extraClass ? ' ' + extraClass : ''));
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.appendChild(icon(iconName));
    if (onClick) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        onClick(btn);
      });
    }
    return btn;
  }

  function renderActions(m, mine, list) {
    var o = list.opts;
    var bar = make('div', 'gv-mc-actions');
    var canPost = o.canPost();

    if (canPost) {
      bar.appendChild(actionButton('bi-reply-fill', 'Odpowiedz', 'gv-mc-action-reply', function () { o.handlers.onReply(m); }));
      bar.appendChild(actionButton('bi-emoji-smile', 'Zareaguj', 'gv-mc-action-react', function (btn) {
        openReactionPicker(btn, m, o.meId, function (key) { o.handlers.onReact(m, key); });
      }));
    }
    if (mine && canPost && m.kind === 'text') {
      bar.appendChild(actionButton('bi-pencil-fill', 'Edytuj', 'gv-mc-action-edit', function () { o.handlers.onEdit(m); }));
    }
    if (mine) {
      bar.appendChild(actionButton('bi-trash3-fill', 'Usuń', 'gv-mc-action-delete', function () { o.handlers.onDelete(m); }));
    }
    // Zgłaszanie wiadomości otwiera wspólne okno (partials/report-modal.ejs) - jest tylko na pełnej stronie czatu.
    if (!mine && !m.senderDeleted && o.variant === 'full') {
      var flag = make('button', 'gv-mc-action gv-msg-report');
      flag.type = 'button';
      flag.title = 'Zgłoś wiadomość';
      flag.setAttribute('aria-label', 'Zgłoś wiadomość');
      flag.setAttribute('data-bs-toggle', 'modal');
      flag.setAttribute('data-bs-target', '#reportModal');
      flag.setAttribute('data-report-type', 'message');
      flag.setAttribute('data-report-url', '/reports/message/' + encodeURIComponent(m.id));
      flag.setAttribute('data-report-author', m.senderUsername);
      flag.appendChild(icon('bi-flag'));
      flag.addEventListener('click', function (e) { e.stopPropagation(); });
      bar.appendChild(flag);
    }
    if (!bar.firstChild) bar.classList.add('d-none');
    return bar;
  }

  function signature(m) {
    return [m.updatedAt, m.editedAt, m.deleted ? 1 : 0, JSON.stringify(m.reactions || []), JSON.stringify(m.replyTo || null)].join('|');
  }

  /* ------------------------------ lista wiadomości ------------------------------ */

  /**
   * @param {HTMLElement} container element z przewijaną listą
   * @param {{ meId, variant, baseClass, getType, canPost, handlers }} opts
   */
  function MessageList(container, opts) {
    var self = this;
    this.container = container;
    this.opts = opts;
    this.items = {}; // id -> { data, el, sig }
    this.order = []; // id w kolejności czasu
    this.pinned = true; // czy widok jest przy dole (wtedy nowe wiadomości przewijają go w dół)

    container.addEventListener('scroll', function () {
      self.pinned = self.nearBottom();
      if (self.pinned) self.hideNewPill();
    });
    // Dotknięcie wiadomości pokazuje jej przyciski (na ekranach dotykowych nie ma najechania myszą).
    container.addEventListener('click', function (e) {
      var msg = e.target.closest('[data-id]');
      Array.prototype.forEach.call(container.querySelectorAll('.gv-mc-active'), function (n) {
        if (n !== msg) n.classList.remove('gv-mc-active');
      });
      if (msg && container.contains(msg) && !e.target.closest('a, button, img')) msg.classList.toggle('gv-mc-active');
    });
  }

  MessageList.prototype.nearBottom = function () {
    var c = this.container;
    return c.scrollHeight - c.scrollTop - c.clientHeight < 90;
  };

  MessageList.prototype.scrollToBottom = function () {
    this.container.scrollTop = this.container.scrollHeight;
    this.pinned = true;
    this.hideNewPill();
  };

  /** Przycisk "Nowe wiadomości" - gdy ktoś pisze, a my czytamy wcześniejsze wiadomości (widok nie jest przy dole). */
  MessageList.prototype.showNewPill = function () {
    var self = this;
    if (!this.pill) {
      this.pill = make('button', 'gv-new-pill');
      this.pill.type = 'button';
      this.pill.appendChild(icon('bi-arrow-down-circle-fill'));
      this.pill.appendChild(document.createTextNode(' Nowe wiadomości'));
      this.pill.addEventListener('click', function () { self.scrollToBottom(); });
    }
    this.container.appendChild(this.pill); // zawsze jako ostatni element (przyklejony do dołu widoku)
  };

  MessageList.prototype.hideNewPill = function () {
    if (this.pill && this.pill.parentNode) this.pill.remove();
  };

  MessageList.prototype.onMediaLoad = function () {
    if (this.pinned) this.container.scrollTop = this.container.scrollHeight;
  };

  MessageList.prototype.clear = function () {
    this.items = {};
    this.order = [];
    this.container.innerHTML = '';
    this.pinned = true; // innerHTML zdjął też przycisk "Nowe wiadomości" - showNewPill dołoży go ponownie
  };

  MessageList.prototype.setAll = function (messages) {
    var self = this;
    this.clear();
    messages.forEach(function (m) { self.upsert(m, { quiet: true }); });
    this.scrollToBottom();
  };

  MessageList.prototype.maxUpdatedAt = function () {
    var max = null;
    var self = this;
    this.order.forEach(function (id) {
      var u = self.items[id].data.updatedAt || self.items[id].data.createdAt;
      if (!max || u > max) max = u;
    });
    return max;
  };

  /** Dodaje wiadomość albo podmienia ją, jeśli się zmieniła. Zwraca 'added', 'updated' albo 'same'. */
  MessageList.prototype.upsert = function (m, options) {
    options = options || {};
    var existing = this.items[m.id];
    var sig = signature(m);
    if (existing && existing.sig === sig) return 'same';

    var stick = this.pinned || m.senderId === this.opts.meId || options.forceScroll;
    var node = renderMessage(m, this);
    var result;

    if (existing) {
      existing.el.replaceWith(node);
      existing.el = node;
      existing.data = m;
      existing.sig = sig;
      result = 'updated';
    } else {
      this.items[m.id] = { data: m, el: node, sig: sig };
      var idx = this.order.length;
      while (idx > 0 && this.items[this.order[idx - 1]].data.createdAt > m.createdAt) idx -= 1;
      var before = idx < this.order.length ? this.items[this.order[idx]].el : null;
      this.order.splice(idx, 0, m.id);
      this.container.insertBefore(node, before);
      result = 'added';
      if (!stick && !options.quiet && m.senderId !== this.opts.meId) this.showNewPill();
      else if (this.pill && this.pill.parentNode) this.container.appendChild(this.pill);
    }

    if (!options.quiet) {
      this.refreshQuotesOf(m);
      if (stick) this.scrollToBottom();
    }
    return result;
  };

  /** Odpowiedzi cytujące zmienioną (np. usuniętą) wiadomość pokazują jej aktualny stan. */
  MessageList.prototype.refreshQuotesOf = function (m) {
    var self = this;
    this.order.forEach(function (id) {
      var item = self.items[id];
      var ref = item.data.replyTo;
      if (!ref || ref.id !== m.id || id === m.id) return;
      var next = Object.assign({}, item.data, {
        replyTo: {
          id: m.id,
          deleted: !!m.deleted,
          senderUsername: m.senderUsername,
          kind: m.kind,
          preview: previewOf(m),
        },
      });
      item.data = next;
      item.sig = signature(next);
      var node = renderMessage(next, self);
      item.el.replaceWith(node);
      item.el = node;
    });
  };

  MessageList.prototype.scrollToMessage = function (id) {
    var item = this.items[id];
    if (!item) return;
    item.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    item.el.classList.add('gv-mc-flash');
    setTimeout(function () { item.el.classList.remove('gv-mc-flash'); }, 1600);
  };

  /* ------------------------------ pole wiadomości ------------------------------ */

  /**
   * Pole wiadomości z panelami emoji/GIF, paskiem odpowiedzi/edycji i wskaźnikiem "pisze...".
   * @param {HTMLElement} host element, do którego budujemy pole
   * @param {{ variant, ids, getConversation, onMessage }} opts ids: true nadaje elementom stałe id (pełny czat)
   */
  function Composer(host, opts) {
    var self = this;
    var full = opts.variant === 'full';
    var ids = !!opts.ids;
    this.opts = opts;
    this.state = { replyTo: null, editing: null };
    this.sending = false;
    this.lastTypingSent = 0;

    function withId(node, id) {
      if (ids) node.id = id;
      return node;
    }

    var wrap = make('div', 'gv-composer gv-chat-input-wrap gv-composer-' + opts.variant);
    this.typing = make('div', 'gv-typing');
    this.typing.setAttribute('aria-live', 'polite');
    wrap.appendChild(this.typing);

    this.note = make('p', 'gv-group-hint gv-composer-note d-none');
    wrap.appendChild(this.note);

    this.context = make('div', 'gv-composer-context d-none');
    this.contextIcon = icon('bi-reply-fill');
    var ctxText = make('div', 'gv-composer-context-text');
    this.contextTitle = make('b');
    this.contextPreview = make('span');
    ctxText.appendChild(this.contextTitle);
    ctxText.appendChild(this.contextPreview);
    var ctxClose = make('button', 'gv-composer-context-close');
    ctxClose.type = 'button';
    ctxClose.setAttribute('aria-label', 'Anuluj');
    ctxClose.appendChild(icon('bi-x-lg'));
    ctxClose.addEventListener('click', function () { self.cancelContext(true); });
    this.context.appendChild(this.contextIcon);
    this.context.appendChild(ctxText);
    this.context.appendChild(ctxClose);
    wrap.appendChild(this.context);

    var pickerClass = 'gv-chat-picker' + (full ? '' : ' gv-chat-picker-mini');
    this.emojiPicker = withId(make('div', pickerClass + ' d-none'), 'emojiPicker');
    var emojiGrid = withId(make('div', 'gv-emoji-grid'), 'emojiGrid');
    this.emojiPicker.appendChild(emojiGrid);
    wrap.appendChild(this.emojiPicker);

    this.gifPicker = withId(make('div', pickerClass + ' gv-gif-picker d-none'), 'gifPicker');
    this.gifSearch = withId(make('input', 'form-control gv-input gv-gif-search'), 'gifSearchInput');
    this.gifSearch.type = 'search';
    this.gifSearch.placeholder = 'Szukaj GIF-a...';
    this.gifSearch.autocomplete = 'off';
    this.gifGrid = withId(make('div', 'gv-gif-grid'), 'gifGrid');
    this.gifPicker.appendChild(this.gifSearch);
    this.gifPicker.appendChild(this.gifGrid);
    wrap.appendChild(this.gifPicker);

    this.form = withId(make('form', full ? 'gv-chat-input-row' : 'nav-chat-form'), 'chatForm');
    var toolClass = full ? 'gv-chat-action-btn' : 'nav-chat-tool';
    this.emojiBtn = withId(make('button', toolClass), 'emojiBtn');
    this.emojiBtn.type = 'button';
    this.emojiBtn.title = 'Emoji';
    this.emojiBtn.setAttribute('aria-label', 'Emoji');
    this.emojiBtn.appendChild(icon('bi-emoji-smile'));
    this.gifBtn = withId(make('button', toolClass), 'gifBtn');
    this.gifBtn.type = 'button';
    this.gifBtn.title = 'GIF';
    this.gifBtn.setAttribute('aria-label', 'GIF');
    this.gifBtn.appendChild(icon('bi-filetype-gif'));
    this.input = withId(make('input'), 'chatText');
    this.input.type = 'text';
    this.input.maxLength = 1000;
    this.input.autocomplete = 'off';
    this.input.placeholder = 'Napisz wiadomość...';
    this.input.setAttribute('aria-label', 'Wiadomość');
    this.sendBtn = make('button', full ? 'gv-chat-send' : 'nav-chat-send');
    this.sendBtn.type = 'submit';
    this.sendBtn.setAttribute('aria-label', 'Wyślij');
    this.sendBtn.appendChild(icon('bi-send-fill'));
    this.form.appendChild(this.emojiBtn);
    this.form.appendChild(this.gifBtn);
    this.form.appendChild(this.input);
    this.form.appendChild(this.sendBtn);
    wrap.appendChild(this.form);
    host.appendChild(wrap);
    this.wrap = wrap;

    // emoji
    EMOJI_CODES.forEach(function (codes) {
      var emoji = emojiFromCodes(codes);
      var btn = make('button', 'gv-emoji-btn', emoji);
      btn.type = 'button';
      btn.addEventListener('click', function () { self.insertText(emoji); });
      emojiGrid.appendChild(btn);
    });
    this.emojiBtn.addEventListener('click', function () { self.togglePicker(self.emojiPicker); });
    this.gifBtn.addEventListener('click', function () {
      self.togglePicker(self.gifPicker);
      if (!self.gifPicker.classList.contains('d-none')) self.gifSearch.focus();
    });

    // GIF
    var gifTimer = null;
    var gifRequest = 0;
    this.gifSearch.addEventListener('input', function () {
      clearTimeout(gifTimer);
      var q = self.gifSearch.value.trim();
      if (q.length < 2) { self.gifGrid.innerHTML = ''; return; }
      gifTimer = setTimeout(function () {
        var id = ++gifRequest;
        request('/chat/gifs?q=' + encodeURIComponent(q))
          .then(function (res) { if (id === gifRequest) self.renderGifs(res.ok ? res.data.gifs || [] : []); })
          .catch(function () {});
      }, 350);
    });

    document.addEventListener('click', function (e) {
      if (wrap.contains(e.target) && (self.emojiPicker.contains(e.target) || self.gifPicker.contains(e.target) ||
          self.emojiBtn.contains(e.target) || self.gifBtn.contains(e.target))) return;
      self.closePickers();
    });

    this.form.addEventListener('submit', function (e) {
      e.preventDefault();
      self.submit();
    });
    this.input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && (self.state.replyTo || self.state.editing)) {
        e.stopPropagation();
        self.cancelContext(true);
      }
    });
    this.input.addEventListener('input', function () { self.signalTyping(); });
  }

  Composer.prototype.focus = function () { this.input.focus(); };

  Composer.prototype.insertText = function (text) {
    var input = this.input;
    var start = input.selectionStart == null ? input.value.length : input.selectionStart;
    var end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    var pos = start + text.length;
    input.focus();
    try { input.setSelectionRange(pos, pos); } catch (err) { /* pole bez zaznaczenia */ }
  };

  Composer.prototype.closePickers = function () {
    this.emojiPicker.classList.add('d-none');
    this.gifPicker.classList.add('d-none');
  };

  Composer.prototype.togglePicker = function (picker) {
    var opening = picker.classList.contains('d-none');
    this.closePickers();
    if (opening) picker.classList.remove('d-none');
  };

  Composer.prototype.renderGifs = function (gifs) {
    var self = this;
    this.gifGrid.innerHTML = '';
    if (gifs.length === 0) {
      this.gifGrid.appendChild(make('p', 'gv-gif-empty', 'Brak wyników. Spróbuj innego hasła.'));
      return;
    }
    gifs.forEach(function (gif) {
      var btn = make('button');
      btn.type = 'button';
      btn.title = gif.title;
      var img = make('img');
      img.src = gif.previewUrl;
      img.alt = gif.title;
      img.loading = 'lazy';
      btn.appendChild(img);
      btn.addEventListener('click', function () {
        self.closePickers();
        self.send(gif.url, 'gif');
      });
      self.gifGrid.appendChild(btn);
    });
  };

  /** Nowa (albo przełączona) rozmowa: czyścimy odpowiedź/edycję, panele i sygnał "pisze...". */
  Composer.prototype.setConversation = function () {
    this.cancelContext(true);
    this.closePickers();
    this.gifSearch.value = '';
    this.gifGrid.innerHTML = '';
    this.input.value = '';
    this.setTyping('');
    this.lastTypingSent = 0;
  };

  /** Blokuje pole (np. administrator wyłączył odpowiedź) i pokazuje powód zamiast pola. */
  Composer.prototype.setDisabled = function (disabled, reason) {
    this.form.classList.toggle('d-none', disabled);
    this.note.classList.toggle('d-none', !disabled);
    this.note.textContent = disabled ? reason || '' : '';
    if (disabled) this.cancelContext(true);
  };

  Composer.prototype.setTyping = function (text) {
    this.typing.innerHTML = '';
    if (!text) return;
    this.typing.appendChild(document.createTextNode(text));
    var dots = make('span', 'gv-typing-dots');
    dots.appendChild(make('i'));
    dots.appendChild(make('i'));
    dots.appendChild(make('i'));
    this.typing.appendChild(dots);
  };

  Composer.prototype.showContext = function (mode, message) {
    var isEdit = mode === 'edit';
    this.context.classList.remove('d-none');
    this.context.classList.toggle('editing', isEdit);
    this.contextIcon.className = 'bi ' + (isEdit ? 'bi-pencil-fill' : 'bi-reply-fill');
    this.contextTitle.textContent = isEdit ? 'Edytujesz wiadomość' : 'Odpowiadasz: ' + message.senderUsername;
    this.contextPreview.textContent = message.kind === 'gif' ? 'GIF' : String(message.text || '').slice(0, REPLY_PREVIEW_LENGTH);
  };

  Composer.prototype.startReply = function (message) {
    if (this.state.editing) this.input.value = '';
    this.state.editing = null;
    this.state.replyTo = message;
    this.showContext('reply', message);
    this.focus();
  };

  Composer.prototype.startEdit = function (message) {
    this.state.replyTo = null;
    this.state.editing = message;
    this.showContext('edit', message);
    this.input.value = message.text;
    this.focus();
  };

  Composer.prototype.cancelContext = function (clearEditedText) {
    if (this.state.editing && clearEditedText) this.input.value = '';
    this.state.replyTo = null;
    this.state.editing = null;
    this.context.classList.add('d-none');
  };

  /** Wiadomość, do której się odnosimy (odpowiedź/edycja), zmieniła się - np. ktoś ją usunął. */
  Composer.prototype.onMessageChanged = function (m) {
    var s = this.state;
    if (m.deleted && ((s.replyTo && s.replyTo.id === m.id) || (s.editing && s.editing.id === m.id))) {
      this.cancelContext(true);
    }
  };

  Composer.prototype.signalTyping = function () {
    var conv = this.opts.getConversation();
    if (!conv || this.state.editing || !this.input.value.trim()) return;
    var now = Date.now();
    if (now - this.lastTypingSent < TYPING_SEND_EVERY_MS) return;
    this.lastTypingSent = now;
    request(convUrl(conv, '/typing'), 'POST', {}).catch(function () {});
  };

  Composer.prototype.setBusy = function (busy) {
    this.sending = busy;
    this.sendBtn.disabled = busy;
  };

  Composer.prototype.submit = function () {
    var text = this.input.value.trim();
    if (!text) return;
    var conv = this.opts.getConversation();
    if (!conv) return;
    if (this.state.editing) return this.submitEdit(conv, text);
    this.input.value = ''; // czyścimy od razu, nie czekając na odpowiedź serwera
    this.send(text, 'text');
  };

  Composer.prototype.send = function (text, kind) {
    var self = this;
    var conv = this.opts.getConversation();
    if (!conv || this.sending) return; // blokada podwójnego Enter/kliknięcia
    this.setBusy(true);
    this.lastTypingSent = 0; // po wysłaniu następne pisanie od razu znowu sygnalizuje "pisze..."

    var payload = { text: text, kind: kind };
    if (this.state.replyTo) payload.replyToId = this.state.replyTo.id;

    function restore() {
      if (kind === 'text' && !self.input.value) self.input.value = text; // oddajemy tekst do poprawy
    }

    request(convUrl(conv, '/messages'), 'POST', payload)
      .then(function (res) {
        if (res.ok && res.data.message) {
          self.cancelContext(false);
          self.opts.onMessage(res.data.message);
        } else {
          toast(res.data.error || 'Nie udało się wysłać wiadomości.', false);
          restore();
        }
      })
      .catch(function () {
        toast('Brak połączenia z serwerem.', false);
        restore();
      })
      .then(function () {
        self.setBusy(false);
        self.focus();
      });
  };

  Composer.prototype.submitEdit = function (conv, text) {
    var self = this;
    var target = this.state.editing;
    if (this.sending) return;
    if (text === target.text) { this.cancelContext(true); return; } // nic się nie zmieniło
    this.setBusy(true);
    request('/chat/' + encodeURIComponent(conv.id) + '/messages/' + encodeURIComponent(target.id) + '/edit', 'POST', { text: text })
      .then(function (res) {
        if (res.ok && res.data.message) {
          self.cancelContext(true);
          self.opts.onMessage(res.data.message);
        } else {
          toast(res.data.error || 'Nie udało się zapisać zmian.', false);
        }
      })
      .catch(function () { toast('Brak połączenia z serwerem.', false); })
      .then(function () {
        self.setBusy(false);
        self.focus();
      });
  };

  /* ------------------------------ widok rozmowy ------------------------------ */

  function typingText(names) {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0] + ' pisze';
    if (names.length === 2) return names[0] + ' i ' + names[1] + ' piszą';
    if (names.length === 3) return names[0] + ', ' + names[1] + ' i ' + names[2] + ' piszą';
    return 'Kilka osób pisze';
  }

  /**
   * Lista wiadomości + pole wiadomości jednej otwartej rozmowy, podpięte do strumienia zdarzeń.
   * @param {{ listEl, composerHost, variant: 'full'|'mini', meId, isAdmin, ids, disabledReason, onGone, onMeta, onIncoming }} opts
   *   onGone(): rozmowa przestała być dostępna (usunięta, wyrzucono nas); onMeta(event): zmieniły się jej ustawienia;
   *   onIncoming(): przyszła cudza wiadomość (np. odśwież liczniki).
   */
  function ChatView(opts) {
    var self = this;
    this.opts = opts;
    this.conv = null;
    this.active = false;
    this.typers = {};
    this.lastCatchUp = 0;
    this.catchingUp = false;
    this.firstLoad = false; // pierwsze pobranie po otwarciu rozmowy (serwer oznacza ją wtedy jako przeczytaną)
    this.readTimer = null;

    this.list = new MessageList(opts.listEl, {
      meId: opts.meId,
      variant: opts.variant,
      baseClass: opts.variant === 'mini' ? 'nav-msg' : 'gv-msg',
      getType: function () { return self.conv ? self.conv.type : ''; },
      canPost: function () { return self.canPost(); },
      handlers: {
        onReply: function (m) { self.composer.startReply(m); },
        onEdit: function (m) { self.composer.startEdit(m); },
        onDelete: function (m) { self.deleteMessage(m); },
        onReact: function (m, key) { self.react(m, key); },
      },
    });

    this.composer = new Composer(opts.composerHost, {
      variant: opts.variant,
      ids: opts.ids,
      getConversation: function () { return self.conv; },
      onMessage: function (m) { self.list.upsert(m, { forceScroll: true }); },
    });

    Stream.on('message', function (d) { self.onStreamMessage(d); });
    Stream.on('typing', function (d) { self.onTyping(d); });
    Stream.on('sync', function (d) { self.onSync(d); });
    Stream.on('open', function () { self.catchUp(); });

    setInterval(function () {
      if (!self.active || !self.conv || document.hidden) return;
      var every = Stream.isOpen() ? SLOW_CATCHUP_MS : FAST_CATCHUP_MS;
      if (Date.now() - self.lastCatchUp >= every) self.catchUp();
    }, 2000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && self.active) {
        self.catchUp();
        self.flushRead();
      }
    });
  }

  ChatView.prototype.canPost = function () {
    return !!this.conv && (this.conv.canReply !== false || !!this.opts.isAdmin);
  };

  /**
   * @param {{ id, type, canReply }} conv
   * @param {Array} [initial] wiadomości już pobrane (pełny czat dostaje je razem ze stroną)
   */
  ChatView.prototype.open = function (conv, initial) {
    this.conv = conv;
    this.active = true;
    this.typers = {};
    this.list.clear();
    this.composer.setConversation();
    this.composer.setDisabled(!this.canPost(), this.disabledReason());
    if (initial) {
      this.list.setAll(initial);
      this.lastCatchUp = Date.now();
    } else {
      this.firstLoad = true;
      this.catchUp();
    }
  };

  ChatView.prototype.close = function () {
    this.active = false;
    this.conv = null;
    clearTimeout(this.readTimer);
    this.list.clear();
  };

  /** Ustawienia rozmowy się zmieniły (np. admin włączył/wyłączył odpowiedź) - przelicz, co wolno. */
  ChatView.prototype.setCanReply = function (canReply) {
    if (!this.conv) return;
    this.conv.canReply = canReply;
    this.composer.setDisabled(!this.canPost(), this.disabledReason());
  };

  ChatView.prototype.disabledReason = function () {
    return this.opts.disabledReason || 'Administrator wyłączył możliwość odpowiedzi w tej rozmowie.';
  };

  /** Dociąga nowe i zmienione wiadomości (start rozmowy, powrót połączenia, siatka bezpieczeństwa). */
  ChatView.prototype.catchUp = function () {
    var self = this;
    var conv = this.conv;
    if (!conv || this.catchingUp) return;
    this.catchingUp = true;
    var first = this.firstLoad;
    this.firstLoad = false;
    var since = this.list.maxUpdatedAt();
    var url = convUrl(conv, '/messages') + (since ? '?since=' + encodeURIComponent(since) : '');

    request(url)
      .then(function (res) {
        if (!res.ok || !self.conv || self.conv.id !== conv.id) return;
        var messages = res.data.messages || [];
        if (!since) {
          self.list.setAll(messages);
        } else {
          var incoming = false;
          messages.forEach(function (m) {
            var result = self.list.upsert(m);
            if (result === 'added' && m.senderId !== self.opts.meId) incoming = true;
            self.composer.onMessageChanged(m);
          });
          if (incoming && self.opts.onIncoming) self.opts.onIncoming();
        }
        if (first && self.opts.onIncoming) self.opts.onIncoming(); // pierwsze otwarcie zdjęło licznik nieprzeczytanych
      })
      .catch(function () {})
      .then(function () {
        self.catchingUp = false;
        self.lastCatchUp = Date.now();
      });
  };

  ChatView.prototype.onStreamMessage = function (d) {
    if (!this.active || !this.conv || d.conversationId !== this.conv.id) return;
    var m = d.message;
    var result = this.list.upsert(m);
    this.composer.onMessageChanged(m);
    if (result === 'added' && m.senderId !== this.opts.meId) {
      delete this.typers[m.senderId];
      this.renderTyping();
      this.markRead();
    }
  };

  ChatView.prototype.onSync = function (d) {
    if (!this.active || !this.conv || d.conversationId !== this.conv.id) return;
    if (d.reason === 'cleared') this.list.clear();
    else if (d.reason === 'gone') { if (this.opts.onGone) this.opts.onGone(); }
    else if (d.reason === 'meta' && this.opts.onMeta) this.opts.onMeta(d);
  };

  // Otwarta rozmowa jest na ekranie, więc cudza wiadomość jest od razu "przeczytana" - inaczej licznik w navbarze
  // naliczyłby ją jako nową. Gdy karta jest w tle, oznaczamy dopiero po powrocie do niej.
  ChatView.prototype.markRead = function () {
    var self = this;
    this.readPending = true;
    if (document.hidden) return;
    clearTimeout(this.readTimer);
    this.readTimer = setTimeout(function () { self.flushRead(); }, 250);
  };

  ChatView.prototype.flushRead = function () {
    if (!this.readPending || !this.conv || document.hidden) return;
    this.readPending = false;
    request(convUrl(this.conv, '/read'), 'POST', {}).catch(function () {});
  };

  ChatView.prototype.onTyping = function (d) {
    var self = this;
    if (!this.active || !this.conv || d.conversationId !== this.conv.id || d.userId === this.opts.meId) return;
    this.typers[d.userId] = { username: d.username, until: Date.now() + TYPING_SHOWN_FOR_MS };
    this.renderTyping();
    setTimeout(function () { self.renderTyping(); }, TYPING_SHOWN_FOR_MS + 100);
  };

  ChatView.prototype.renderTyping = function () {
    var now = Date.now();
    var names = [];
    var self = this;
    Object.keys(this.typers).forEach(function (id) {
      if (self.typers[id].until > now) names.push(self.typers[id].username);
      else delete self.typers[id];
    });
    this.composer.setTyping(typingText(names));
  };

  ChatView.prototype.react = function (m, key) {
    var self = this;
    if (!this.conv) return;
    request('/chat/' + encodeURIComponent(this.conv.id) + '/messages/' + encodeURIComponent(m.id) + '/react', 'POST', { key: key })
      .then(function (res) {
        if (res.ok && res.data.message) self.list.upsert(res.data.message);
        else toast(res.data.error || 'Nie udało się dodać reakcji.', false);
      })
      .catch(function () { toast('Brak połączenia z serwerem.', false); });
  };

  ChatView.prototype.deleteMessage = function (m) {
    var self = this;
    if (!this.conv) return;
    if (!window.confirm('Usunąć tę wiadomość? Zniknie dla wszystkich uczestników rozmowy.')) return;
    request('/chat/' + encodeURIComponent(this.conv.id) + '/messages/' + encodeURIComponent(m.id) + '/delete', 'POST', {})
      .then(function (res) {
        if (res.ok && res.data.message) {
          self.list.upsert(res.data.message);
          self.composer.onMessageChanged(res.data.message);
        } else {
          toast(res.data.error || 'Nie udało się usunąć wiadomości.', false);
        }
      })
      .catch(function () { toast('Brak połączenia z serwerem.', false); });
  };

  Stream.connect();

  window.GVChat = { Stream: Stream, ChatView: ChatView, REACTIONS: REACTIONS };
})();
