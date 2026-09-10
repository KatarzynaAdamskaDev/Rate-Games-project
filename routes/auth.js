const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { ensureGuest } = require('../middleware/auth');
const {
  findByEmail,
  findByUsername,
  findByUsernameOrEmail,
  createUser,
  updatePassword,
} = require('../utils/userHelpers');

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/** Weryfikuje token reCAPTCHA v2 po stronie serwera. */
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    // Brak skonfigurowanych kluczy - nie blokuj działania aplikacji w dev,
    // ale wypisz ostrzeżenie w konsoli.
    console.warn(
      '[reCAPTCHA] Brak RECAPTCHA_SECRET_KEY w .env - weryfikacja pominięta.'
    );
    return true;
  }
  if (!token) return false;

  const params = new URLSearchParams({ secret, response: token });
  const resp = await fetch(RECAPTCHA_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await resp.json();
  return data.success === true;
}

/* ---------------------------- SIGN UP ---------------------------- */

router.get('/signup', ensureGuest, (req, res) => {
  res.render('auth/signup', {
    title: 'Utwórz konto',
    formData: {},
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY 
  });
});
router.post('/signup', ensureGuest, async (req, res, next) => {
  try {
    const {
      email,
      username,
      password,
      acceptTerms,
      acceptPrivacy,
      'g-recaptcha-response': recaptchaToken,
    } = req.body;

    const errors = [];

    if (!email || !username || !password) {
      errors.push('Wszystkie pola są wymagane.');
    }
    if (!acceptTerms) {
      errors.push('Musisz zaakceptować Regulamin i potwierdzić wiek 16+.');
    }
    if (!acceptPrivacy) {
      errors.push('Musisz zaakceptować Politykę Prywatności.');
    }
    if (password && password.length < 8) {
      errors.push('Hasło musi mieć co najmniej 8 znaków.');
    }
    if (email && findByEmail(email)) {
      errors.push('Ten adres e-mail jest już zarejestrowany.');
    }
    if (username && findByUsername(username)) {
      errors.push('Ta nazwa użytkownika jest już zajęta.');
    }

    const recaptchaOk = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaOk) {
      errors.push('Weryfikacja "I am a human" nie powiodła się. Spróbuj ponownie.');
    }

    if (errors.length > 0) {
      errors.forEach((e) => req.flash('error', e));
      return res.status(400).render('auth/signup', {
        title: 'Utwórz konto',
        formData: { email, username },
        recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    createUser({ email, username, passwordHash });

    req.flash('success', 'Konto zostało utworzone. Możesz się teraz zalogować.');
    res.redirect('/auth/signin');
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- SIGN IN ---------------------------- */

router.get('/signin', ensureGuest, (req, res) => {
  res.render('auth/signin', { title: 'Zaloguj się', formData: {} });
});

router.post('/signin', ensureGuest, async (req, res, next) => {
  // Formularz w modalu wysyła żądanie AJAX (fetch) i oczekuje odpowiedzi JSON,
  // dzięki czemu strona w tle nie przeładowuje się przy błędnym logowaniu.
  const wantsJson =
    req.xhr || (req.headers.accept || '').includes('application/json');

  try {
    const { identifier, password, remember } = req.body;
    const user = identifier ? findByUsernameOrEmail(identifier) : null;

    const passwordMatches = user
      ? await bcrypt.compare(password || '', user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      const message = 'Nieprawidłowa nazwa użytkownika/e-mail lub hasło.';
      if (wantsJson) {
        return res.status(400).json({ success: false, message });
      }
      req.flash('error', message);
      return res.status(400).render('auth/signin', {
        title: 'Zaloguj się',
        formData: { identifier },
      });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    if (remember) {
      // 30 dni zamiast domyślnego czasu życia sesji (przeglądarki)
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    }

    if (wantsJson) {
      return res.json({
        success: true,
        message: `Witaj ponownie, ${user.username}!`,
      });
    }

    req.flash('success', `Witaj ponownie, ${user.username}!`);
    res.redirect('/');
  } catch (err) {
    if (wantsJson) {
      return res
        .status(500)
        .json({ success: false, message: 'Wystąpił błąd serwera.' });
    }
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

/* ------------------------- RESET PASSWORD ------------------------- */

router.get('/reset-password', ensureGuest, (req, res) => {
  res.render('auth/reset-password', { title: 'Zresetuj hasło' });
});

router.post('/reset-password', ensureGuest, (req, res) => {
  const { email } = req.body;
  const user = email ? findByEmail(email) : null;

  // Ze względów bezpieczeństwa zawsze pokazujemy ten sam komunikat,
  // niezależnie od tego, czy e-mail istnieje w bazie.
  if (user) {
    // TODO: tutaj docelowo należałoby wysłać e-mail z linkiem resetującym
    // (np. przez nodemailer) zawierającym jednorazowy token.
    console.log(`[reset-password] Link resetujący dla: ${user.email}`);
  }

  req.flash(
    'success',
    'Jeśli podany adres e-mail istnieje w naszej bazie, wysłaliśmy na niego wiadomość z dalszymi instrukcjami.'
  );
  res.redirect('/auth/signin');
});

module.exports = router;
