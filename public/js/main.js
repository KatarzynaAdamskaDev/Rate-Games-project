/* -------------------- Toasty (komunikaty w rogu ekranu) --------------------
   UWAGA: te dwie funkcje muszą być w zasięgu GLOBALNYM (poza
   DOMContentLoaded), bo wywołują je też inline <script> na innych stronach
   (np. partials/flash.ejs, profile/show.ejs) zanim main.js zdąży się w pełni
   zainicjować. */
function showToast(message, isSuccess) {
  var container = document.getElementById('gvToastContainer');
  if (!container || !message) return;

  var toast = document.createElement('div');
  toast.className = 'gv-toast' + (isSuccess ? ' gv-toast-success' : '');
  toast.textContent = message;

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gv-toast-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', function () { removeToast(toast); });
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  setTimeout(function () { removeToast(toast); }, 5000);
}

function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add('gv-toast-out');
  setTimeout(function () {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 200);
}

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

  function postJson(url, formEl) {
    var formData = new URLSearchParams(new FormData(formEl));
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formData.toString(),
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    });
  }

  /* -------------------- Modal logowania (AJAX) -------------------- */
  var signInForm = document.getElementById('signInForm');
  var signInModalEl = document.getElementById('signInModal');

  if (signInForm) {
    signInForm.addEventListener('submit', function (e) {
      e.preventDefault();

      postJson('/auth/signin', signInForm)
        .then(function (result) {
          if (result.ok && result.data.success) {
            // Administrator z 2FA: po haśle otwieramy okno na kod z aplikacji.
            if (result.data.twoFactor) {
              openTwoFactorModal();
            } else {
              window.location.reload();
            }
          } else {
            showToast(result.data.message || 'Nie udało się zalogować.', false);
          }
        })
        .catch(function () {
          showToast('Wystąpił błąd połączenia. Spróbuj ponownie.', false);
        });
    });
  }

  /* -------------------- Modal kodu 2FA (administratorzy) -------------------- */
  var twoFactorModalEl = document.getElementById('twoFactorModal');
  var twoFactorForm = document.getElementById('twoFactorForm');
  var twoFactorDone = false;

  function openTwoFactorModal() {
    if (!twoFactorModalEl || typeof bootstrap === 'undefined') return;
    twoFactorDone = false;
    var show = function () {
      twoFactorForm.reset();
      bootstrap.Modal.getOrCreateInstance(twoFactorModalEl).show();
    };
    // Najpierw zamykamy okno logowania (jeśli jest otwarte), potem otwieramy okno z kodem.
    if (signInModalEl && signInModalEl.classList.contains('show')) {
      signInModalEl.addEventListener('hidden.bs.modal', show, { once: true });
      bootstrap.Modal.getOrCreateInstance(signInModalEl).hide();
    } else {
      show();
    }
  }

  if (twoFactorModalEl && twoFactorForm) {
    twoFactorModalEl.addEventListener('shown.bs.modal', function () {
      document.getElementById('twoFactorCode').focus();
    });

    twoFactorForm.addEventListener('submit', function (e) {
      e.preventDefault();
      postJson('/auth/2fa', twoFactorForm)
        .then(function (result) {
          if (result.ok && result.data.success) {
            twoFactorDone = true;
            window.location.reload();
          } else {
            showToast(result.data.message || 'Nieprawidłowy kod.', false);
            document.getElementById('twoFactorCode').select();
          }
        })
        .catch(function () {
          showToast('Wystąpił błąd połączenia. Spróbuj ponownie.', false);
        });
    });

    // Zamknięcie okna bez podania kodu przerywa logowanie (hasło było tylko pierwszym krokiem).
    twoFactorModalEl.addEventListener('hidden.bs.modal', function () {
      if (twoFactorDone) return;
      fetch('/auth/2fa/cancel', {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      }).catch(function () {});
    });

    // Serwer pamięta niedokończone logowanie (np. po wysłaniu formularza bez JavaScriptu).
    if (twoFactorModalEl.getAttribute('data-auto-open') === '1') openTwoFactorModal();
  }

  /* -------------------- Modal rejestracji (AJAX + auto-login) -------------------- */
  var signupForm = document.getElementById('signupForm');

  if (signupForm) {
    signupForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var pass1 = document.getElementById('signupPassword').value;
      var pass2 = document.getElementById('signupPassword2').value;

      if (pass1 !== pass2) {
        showToast('Podane hasła nie są identyczne.', false);
        return;
      }

      postJson('/auth/signup', signupForm)
        .then(function (result) {
          if (result.ok && result.data.success) {
            var loginData = new URLSearchParams();
            loginData.set('identifier', document.getElementById('signupUsername').value);
            loginData.set('password', pass1);

            return fetch('/auth/signin', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
              },
              body: loginData.toString(),
            }).then(function () {
              window.location.reload();
            });
          } else {
            showToast(result.data.message || 'Nie udało się utworzyć konta.', false);
          }
        })
        .catch(function () {
          showToast('Wystąpił błąd połączenia. Spróbuj ponownie.', false);
        });
    });
  }

  /* -------------------- Modal resetu hasła (AJAX) -------------------- */
  var forgotForm = document.getElementById('forgotForm');

  if (forgotForm) {
    forgotForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var email = document.getElementById('forgotEmail').value.trim();

      if (!email) {
        showToast('Podaj adres e-mail.', false);
        return;
      }

      postJson('/auth/reset-password', forgotForm)
        .then(function (result) {
          showToast(result.data.message, result.ok && result.data.success);
          if (result.ok && result.data.success) {
            forgotForm.reset();
          }
        })
        .catch(function () {
          showToast('Wystąpił błąd połączenia. Spróbuj ponownie.', false);
        });
    });
  }

  // Wyczyść wszystkie formularze przy każdym otwarciu modala
  if (signInModalEl) {
    signInModalEl.addEventListener('show.bs.modal', function () {
      [signInForm, signupForm, forgotForm].forEach(function (form) {
        if (form) form.reset();
      });
    });
  }
    /* -------------------- Walidacja formularza rejestracji (modal) -------------------- */
  var signupForm = document.getElementById('signupForm');
  var signupError = document.getElementById('signupModalError');

  if (signupForm) {
    signupForm.addEventListener('submit', function (e) {
      var pass1 = document.getElementById('signupPassword').value;
      var pass2 = document.getElementById('signupPassword2').value;

      if (pass1 !== pass2) {
        e.preventDefault();
        if (signupError) {
          signupError.textContent = 'Podane hasła nie są identyczne.';
          signupError.classList.remove('d-none');
        }
      }
    });
  }
});

document.addEventListener('DOMContentLoaded', function () {
  const searchForm = document.getElementById('navSearchForm');
  if (searchForm) {
    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const query = searchForm.querySelector('input[name="q"]').value.trim();
      if (query) {
        window.location.href = '/search?q=' + encodeURIComponent(query);
      }
    });
  }
});

// Udostępnianie: przycisk z atrybutem data-share otwiera systemowe okno udostępniania (telefony),
// a gdy go nie ma - kopiuje adres do schowka.
document.addEventListener('click', function (event) {
  var button = event.target.closest && event.target.closest('[data-share]');
  if (!button) return;

  var url = button.getAttribute('data-share-url') || window.location.href;
  var title = button.getAttribute('data-share-title') || document.title;
  var label = button.querySelector('[data-share-label]');

  function confirmCopied() {
    if (typeof showToast === 'function') showToast('Link skopiowany do schowka.', true);
    if (label) {
      var original = label.textContent;
      label.textContent = 'Skopiowano!';
      setTimeout(function () { label.textContent = original; }, 2000);
    }
  }

  function copy() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(confirmCopied, function () { window.prompt('Skopiuj adres:', url); });
    } else {
      window.prompt('Skopiuj adres:', url);
    }
  }

  if (navigator.share) {
    navigator.share({ title: title, url: url }).catch(function (err) {
      if (err && err.name !== 'AbortError') copy();
    });
  } else {
    copy();
  }
});
