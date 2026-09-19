/**
 * Wyszukiwarka gier do formularza dodawania ulubionej gry.
 * Znaczniki: <div data-game-picker> z polem tekstowym, ukrytym inputem gameId
 * i kontenerem .gv-picker-results. Wybranie gry z listy wysyła formularz.
 * Wyniki pochodzą z /games/search-json (IGDB).
 */
(function () {
  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  function initPicker(root) {
    var textInput = root.querySelector('input[type="search"]');
    var idInput = root.querySelector('input[name="gameId"]');
    var results = root.querySelector('.gv-picker-results');
    var form = root.closest('form');
    var requestId = 0;

    function clearResults() {
      results.innerHTML = '';
      results.classList.remove('open');
    }

    function message(text) {
      results.innerHTML = '';
      var div = document.createElement('div');
      div.className = 'gv-picker-empty';
      div.textContent = text;
      results.appendChild(div);
      results.classList.add('open');
    }

    function choose(game) {
      idInput.value = game.id;
      form.submit();
    }

    function render(games) {
      results.innerHTML = '';
      if (games.length === 0) {
        message('Nie znaleziono takiej gry.');
        return;
      }
      games.forEach(function (game) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'gv-picker-item';

        var img = document.createElement('img');
        img.src = game.coverImage || '/images/game-placeholder.svg';
        img.alt = '';

        var text = document.createElement('span');
        var title = document.createElement('b');
        title.textContent = game.title;
        var meta = document.createElement('small');
        meta.textContent = [game.releaseYear, game.platform].filter(Boolean).join(' · ');
        text.appendChild(title);
        text.appendChild(meta);

        item.appendChild(img);
        item.appendChild(text);
        item.addEventListener('click', function () { choose(game); });
        results.appendChild(item);
      });
      results.classList.add('open');
    }

    var search = debounce(function () {
      var q = textInput.value.trim();
      if (q.length < 2) {
        clearResults();
        return;
      }
      var current = ++requestId;
      fetch('/games/search-json?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (current === requestId) render(data.games || []);
        })
        .catch(function () {
          if (current === requestId) message('Nie udało się pobrać wyników. Spróbuj ponownie.');
        });
    }, 300);

    textInput.addEventListener('input', function () {
      idInput.value = ''; // po edycji tekstu poprzedni wybór przestaje obowiązywać
      search();
    });

    // Enter w polu wyszukiwania nie wysyła formularza bez wybranej gry.
    textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') e.preventDefault();
    });

    if (form) {
      form.addEventListener('submit', function (e) {
        if (!idInput.value) {
          e.preventDefault();
          textInput.focus();
          message('Wybierz grę z listy wyników.');
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) clearResults();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-game-picker]').forEach(initPicker);
  });
})();
