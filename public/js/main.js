document.addEventListener('DOMContentLoaded', function () {
  /* -------------------- Pokaż/ukryj hasło -------------------- */
  document.querySelectorAll('.gv-password-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-target');
      var input = document.getElementById(targetId);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  /* -------------------- Rozwijana wyszukiwarka -------------------- */
  var navCenter = document.getElementById('gvNavCenter');
  var searchToggle = document.getElementById('gvSearchToggle');
  var searchClose = document.getElementById('gvSearchClose');
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
  if (searchClose) {
    searchClose.addEventListener('click', function (e) {
      e.preventDefault();
      closeSearch();
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
