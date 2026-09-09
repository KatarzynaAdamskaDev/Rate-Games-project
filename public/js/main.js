document.addEventListener('DOMContentLoaded', function () {
  /* -------------------- Pokaż/ukryj hasło -------------------- */
  // document.querySelectorAll('.gv-password-toggle').forEach(function (btn) {
  //   btn.addEventListener('click', function () {
  //     var targetId = btn.getAttribute('data-target');
  //     var input = document.getElementById(targetId);
  //     if (!input) return;
  //     input.type = input.type === 'password' ? 'text' : 'password';
  //   });
  // });

  document.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.toggleInit) return; // nie dubluj przycisku
    input.dataset.toggleInit = 'true';

    const wrap = document.createElement('div');
    wrap.className = 'gv-pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gv-pw-toggle';
    btn.title = 'Pokaż/ukryj hasło';
    btn.innerHTML = eyeOpenSVG();

    btn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.innerHTML = input.type === 'password' ? eyeOpenSVG() : eyeClosedSVG();
    });

    wrap.appendChild(btn);
  });

  function eyeOpenSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
      <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
      <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
    </svg>`;
  }

  function eyeClosedSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
      <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
    </svg>`;
  }

  /* -------------------- Rozwijana wyszukiwarka -------------------- */
  var navCenter = document.getElementById('gvNavRight');
  var searchToggle = document.getElementById('gvSearchToggle');
  var searchInput = document.getElementById('gvSearchInput');

  function openSearch() {
    if (!navCenter) return;
    navCenter.classList.add('gv-search-active');
    if (searchInput) setTimeout(function () { searchInput.focus(); }, 150);
  }

  function closeSearch() {
    if (!navCenter) return;
    navCenter.classList.remove('gv-search-active');
  }

  if (searchToggle) {
    searchToggle.addEventListener('click', function () {
      if (navCenter.classList.contains('gv-search-active')) {
        closeSearch();
      } else {
        openSearch();
      }
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSearch();
  });

  /* -------------------- Menu mobilne -------------------- */
  var mobileToggle = document.getElementById('gvMobileToggle');
  var navLinks = document.getElementById('gvNavLinks');
  if (mobileToggle && navLinks) {
    mobileToggle.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('gv-nav-open');
      mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      mobileToggle.classList.toggle('gv-nav-toggler-open', isOpen);
    });
  }

  /* -------------------- Modal logowania (AJAX) -------------------- */
  var signInForm = document.getElementById('signInForm');
  var signInError = document.getElementById('signInModalError');
  var signInModalEl = document.getElementById('signInModal');

  if (signInForm) {
    signInForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (signInError) {
        signInError.classList.add('d-none');
        signInError.textContent = '';
      }

      var formData = new URLSearchParams(new FormData(signInForm));

      fetch('/auth/signin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: formData.toString(),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok && result.data.success) {
            // Odśwież bieżącą stronę, aby odzwierciedlić stan zalogowania
            window.location.reload();
          } else {
            if (signInError) {
              signInError.textContent =
                result.data.message || 'Nie udało się zalogować.';
              signInError.classList.remove('d-none');
            }
          }
        })
        .catch(function () {
          if (signInError) {
            signInError.textContent =
              'Wystąpił błąd połączenia. Spróbuj ponownie.';
            signInError.classList.remove('d-none');
          }
        });
    });
  }

  // Wyczyść formularz i błędy przy każdym otwarciu modala
  if (signInModalEl) {
    signInModalEl.addEventListener('show.bs.modal', function () {
      if (signInForm) signInForm.reset();
      if (signInError) {
        signInError.classList.add('d-none');
        signInError.textContent = '';
      }
    });
  }
});
