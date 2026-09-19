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

  function renderComment(c) {
    var item = document.createElement('div');
    item.className = 'gv-rcomment';

    var link = document.createElement('a');
    link.href = '/' + encodeURIComponent(c.username);
    link.className = 'gv-rcomment-author';
    link.textContent = c.username;

    var text = document.createElement('span');
    text.className = 'gv-rcomment-text';
    text.textContent = c.text;

    var date = document.createElement('small');
    date.textContent = formatDate(c.createdAt);

    item.appendChild(link);
    item.appendChild(text);
    item.appendChild(date);
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
            likeBtn.classList.toggle('liked', data.liked);
            var icon = likeBtn.querySelector('i');
            icon.className = 'bi ' + (data.liked ? 'bi-heart-fill' : 'bi-heart');
            setCount(likeBtn, data.likeCount);
          })
          .catch(function () {});
      });
    }

    function loadComments() {
      list.innerHTML = '';
      return fetch(baseUrl(box) + '/comments', { headers: JSON_HEADERS })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          (data.comments || []).forEach(function (c) { list.appendChild(renderComment(c)); });
          if (!data.comments || data.comments.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'gv-rcomments-empty';
            empty.textContent = 'Brak komentarzy - napisz pierwszy.';
            list.appendChild(empty);
          }
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
            if (!data.ok) return;
            var empty = list.querySelector('.gv-rcomments-empty');
            if (empty) empty.remove();
            list.appendChild(renderComment(data.comment));
            input.value = '';
            setCount(commentsBtn, list.querySelectorAll('.gv-rcomment').length);
          })
          .catch(function () {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.gv-ractions').forEach(initReview);
  });
})();
