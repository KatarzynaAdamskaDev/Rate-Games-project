/**
 * Polubienia i komentarze pod recenzjami (strona główna, lista recenzji) bez przeładowania.
 * Znaczniki: views/partials/review-actions.ejs
 *   - .gv-ract-like       - przełącza polubienie (POST .../like, odpowiedź JSON),
 *   - .gv-ract-comments   - rozwija panel komentarzy (GET/POST .../comments, JSON).
 */
(function () {
  var JSON_HEADERS = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

  function baseUrl(box) {
    return '/games/' + encodeURIComponent(box.dataset.gameId) + '/reviews/' + encodeURIComponent(box.dataset.reviewId);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('pl-PL');
  }

  function iconButton(iconName, title, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gv-icon-btn' + (extraClass ? ' ' + extraClass : '');
    btn.title = title;
    btn.setAttribute('aria-label', title);
    var i = document.createElement('i');
    i.className = 'bi ' + iconName;
    btn.appendChild(i);
    return btn;
  }

  /**
   * Komentarz z tymi samymi akcjami co na stronie gry: polubienie (dla każdego), zgłoszenie (cudze) i usunięcie (własne).
   * callbacks.onDeleted() dostaje informację, że komentarz zniknął (żeby zmienić licznik).
   */
  function renderComment(c, box, callbacks) {
    var meId = box.dataset.me || '';
    var item = document.createElement('div');
    item.className = 'gv-rcomment';
    item.id = 'comment-' + c.id;

    var link = document.createElement('a');
    link.href = '/' + encodeURIComponent(c.username);
    link.className = 'gv-rcomment-author';
    link.textContent = c.username;

    var text = document.createElement('span');
    text.className = 'gv-rcomment-text';
    text.textContent = c.text;

    var foot = document.createElement('div');
    foot.className = 'gv-rcomment-foot';
    var date = document.createElement('small');
    date.textContent = formatDate(c.createdAt);
    var actions = document.createElement('div');
    actions.className = 'gv-rcomment-actions';

    // Polubienie: niezalogowany dostaje okno logowania (jak przy polubieniu recenzji).
    var like = iconButton(c.liked ? 'bi-heart-fill' : 'bi-heart', meId ? 'Polub' : 'Zaloguj się, aby polubić', c.liked ? 'liked' : '');
    var count = document.createElement('span');
    count.className = 'gv-count';
    count.textContent = String(c.likeCount || 0);
    like.appendChild(count);
    if (!meId) {
      like.setAttribute('data-bs-toggle', 'modal');
      like.setAttribute('data-bs-target', '#signInModal');
    } else {
      like.addEventListener('click', function () {
        fetch(baseUrl(box) + '/comments/' + encodeURIComponent(c.id) + '/like', { method: 'POST', headers: JSON_HEADERS })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.error) {
              if (window.showToast) window.showToast(data.error, false);
              return;
            }
            like.classList.toggle('liked', data.liked);
            like.querySelector('i').className = 'bi ' + (data.liked ? 'bi-heart-fill' : 'bi-heart');
            count.textContent = String(data.likeCount);
          })
          .catch(function () {});
      });
    }
    actions.appendChild(like);

    if (meId && !c.mine) {
      var report = iconButton('bi-flag', 'Zgłoś komentarz', 'gv-report-btn');
      report.setAttribute('data-bs-toggle', 'modal');
      report.setAttribute('data-bs-target', '#reportModal');
      report.setAttribute('data-report-type', 'comment');
      report.setAttribute('data-report-url', '/reports/comment/' + encodeURIComponent(c.id));
      report.setAttribute('data-report-author', c.username);
      actions.appendChild(report);
    }

    if (c.mine) {
      var del = iconButton('bi-trash', 'Usuń komentarz', 'gv-delete-btn');
      del.addEventListener('click', function () {
        if (!window.confirm('Usunąć komentarz?')) return;
        fetch(baseUrl(box) + '/comments/' + encodeURIComponent(c.id) + '/delete', { method: 'POST', headers: JSON_HEADERS })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) {
              if (window.showToast) window.showToast(data.error || 'Nie udało się usunąć komentarza.', false);
              return;
            }
            item.remove();
            if (callbacks && callbacks.onDeleted) callbacks.onDeleted();
          })
          .catch(function () {});
      });
      actions.appendChild(del);
    }

    foot.appendChild(date);
    foot.appendChild(actions);
    item.appendChild(link);
    item.appendChild(text);
    item.appendChild(foot);
    return item;
  }

  function setCount(button, value) {
    button.querySelector('.gv-count').textContent = String(value);
  }

  function initReview(box) {
    var likeBtn = box.querySelector('.gv-ract-like');
    var commentsBtn = box.querySelector('.gv-ract-comments');
    var panel = box.nextElementSibling; // .gv-rcomments
    var list = panel.querySelector('.gv-rcomments-list');
    var form = panel.querySelector('.gv-rcomments-form');
    var loaded = false;

    // Niezalogowany: przycisk polubienia otwiera okno logowania (data-bs-toggle).
    if (likeBtn && !likeBtn.hasAttribute('data-bs-toggle')) {
      likeBtn.addEventListener('click', function () {
        fetch(baseUrl(box) + '/like', { method: 'POST', headers: JSON_HEADERS })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.error) {
              if (window.showToast) window.showToast(data.error, false);
              return;
            }
            likeBtn.classList.toggle('liked', data.liked);
            var icon = likeBtn.querySelector('i');
            icon.className = 'bi ' + (data.liked ? 'bi-heart-fill' : 'bi-heart');
            setCount(likeBtn, data.likeCount);
          })
          .catch(function () {});
      });
    }

    function showEmptyNote() {
      if (list.querySelector('.gv-rcomment') || list.querySelector('.gv-rcomments-empty')) return;
      var empty = document.createElement('p');
      empty.className = 'gv-rcomments-empty';
      empty.textContent = 'Brak komentarzy - napisz pierwszy.';
      list.appendChild(empty);
    }

    var commentCallbacks = {
      onDeleted: function () {
        setCount(commentsBtn, list.querySelectorAll('.gv-rcomment').length);
        showEmptyNote();
      },
    };

    function loadComments() {
      list.innerHTML = '';
      return fetch(baseUrl(box) + '/comments', { headers: JSON_HEADERS })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          (data.comments || []).forEach(function (c) { list.appendChild(renderComment(c, box, commentCallbacks)); });
          showEmptyNote();
          loaded = true;
        });
    }

    commentsBtn.addEventListener('click', function () {
      var opening = panel.classList.contains('d-none');
      panel.classList.toggle('d-none', !opening);
      commentsBtn.setAttribute('aria-expanded', String(opening));
      if (opening && !loaded) loadComments().catch(function () {});
    });

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = form.querySelector('input');
        var text = input.value.trim();
        if (!text) return;

        fetch(baseUrl(box) + '/comments', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, JSON_HEADERS),
          body: 'text=' + encodeURIComponent(text),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) {
              if (data.error && window.showToast) window.showToast(data.error, false);
              return;
            }
            var empty = list.querySelector('.gv-rcomments-empty');
            if (empty) empty.remove();
            list.appendChild(renderComment(data.comment, box, commentCallbacks));
            input.value = '';
            setCount(commentsBtn, list.querySelectorAll('.gv-rcomment').length);
          })
          .catch(function () {});
      });
    }
  }

  // Przycisk "Edytuj" (tylko autor recenzji) - pokazuje/chowa formularz edycji pod recenzją.
  function initEditToggle(btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.dataset.target);
      if (target) target.classList.toggle('d-none');
    });
  }

  // Gwiazdkowy selektor oceny w formularzu edycji (te same zasady co przy dodawaniu opinii
  // na stronie gry - lewa połowa gwiazdki = pół punktu). Zob. views/games/detail.ejs.
  function initStarPicker(picker) {
    var input = picker.nextElementSibling;
    var stars = Array.prototype.slice.call(picker.querySelectorAll('i'));

    function valueFromEvent(star, e) {
      var rect = star.getBoundingClientRect();
      var isLeftHalf = (e.clientX - rect.left) < rect.width / 2;
      var base = Number(star.dataset.value);
      return isLeftHalf ? base - 0.5 : base;
    }

    function paint(value) {
      stars.forEach(function (star) {
        var starValue = Number(star.dataset.value);
        star.classList.remove('bi-star', 'bi-star-fill', 'bi-star-half');
        if (value >= starValue) {
          star.classList.add('bi-star-fill');
        } else if (value >= starValue - 0.5) {
          star.classList.add('bi-star-half');
        } else {
          star.classList.add('bi-star');
        }
      });
    }

    stars.forEach(function (star) {
      star.addEventListener('mousemove', function (e) { paint(valueFromEvent(star, e)); });
      star.addEventListener('click', function (e) {
        var value = valueFromEvent(star, e);
        picker.dataset.selected = value;
        input.value = value;
        paint(value);
      });
    });

    picker.addEventListener('mouseleave', function () {
      paint(Number(picker.dataset.selected || 0));
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.gv-ractions').forEach(initReview);
    document.querySelectorAll('.gv-ract-edit-toggle').forEach(initEditToggle);
    document.querySelectorAll('.gv-star-picker').forEach(initStarPicker);

    // Bez wybranej oceny gwiazdkowej formularz recenzji (edycja tu, nowa - modal na stronie głównej) się nie wysyła.
    document.querySelectorAll('.gv-review-form').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        var input = form.querySelector('.gv-star-picker-input');
        if (input && !input.value) {
          e.preventDefault();
          alert('Wybierz ocenę przed dodaniem opinii.');
        }
      });
    });
  });
})();
