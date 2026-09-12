const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();

const { ensureGuest } = require('../middleware/auth');
const {
  findByEmail,
  findByUsername,
  findByUsernameOrEmail,
  createUser,
  updatePassword,
  setResetToken,
  findByResetToken,
  clearResetToken,
} = require('../utils/userHelpers');
const { sendPasswordResetEmail } = require('../utils/mailer');

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minut

/** Weryfikuje token reCAPTCHA v2 po stronie serwera. */
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
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

/** Sprawdza, czy klient oczekuje odpowiedzi JSON (fetch) czy pełnej strony. */
function wantsJsonResponse(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

/* ---------------------------- SIGN UP ---------------------------- */

router.get('/signup', ensureGuest, (req, res) => {
  res.render('auth/signup', {
    title: 'Utwórz konto',
    formData: {},
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY,
  });
});

router.post('/signup', ensureGuest, async (req, res, next) => {
  const wantsJson = wantsJsonResponse(req);

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
    if (email && (await findByEmail(email))) {
      errors.push('Ten adres e-mail jest już zarejestrowany.');
    }
    if (username && (await findByUsername(username))) {
      errors.push('Ta nazwa użytkownika jest już zajęta.');
    }

    const recaptchaOk = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaOk) {
      errors.push('Weryfikacja "I am a human" nie powiodła się. Spróbuj ponownie.');
    }

    if (errors.length > 0) {
      if (wantsJson) {
        return res.status(400).json({ success: false, message: errors.join(' ') });
      }
      errors.forEach((e) => req.flash('error', e));
      return res.status(400).render('auth/signup', {
        title: 'Utwórz konto',
        formData: { email, username },
        recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY,
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await createUser({ email, username, passwordHash });

    if (wantsJson) {
      return res.json({
        success: true,
        message: 'Konto zostało utworzone.',
      });
    }

    req.flash('success', 'Konto zostało utworzone. Możesz się teraz zalogować.');
    res.redirect('/auth/signin');
  } catch (err) {
    if (wantsJson) {
      return res.status(500).json({ success: false, message: 'Wystąpił błąd serwera.' });
    }
    next(err);
  }
});

/* ---------------------------- SIGN IN ---------------------------- */

router.get('/signin', ensureGuest, (req, res) => {
  res.render('auth/signin', { title: 'Zaloguj się', formData: {} });
});

router.post('/signin', ensureGuest, async (req, res, next) => {
  const wantsJson = wantsJsonResponse(req);

  try {
    const { identifier, password, remember } = req.body;
    const user = identifier ? await findByUsernameOrEmail(identifier) : null;

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
      return res.status(500).json({ success: false, message: 'Wystąpił błąd serwera.' });
    }
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

/* ------------------------- RESET PASSWORD (WYSYŁKA LINKU) ------------------------- */

router.get('/reset-password', ensureGuest, (req, res) => {
  res.render('auth/reset-password', { title: 'Zresetuj hasło' });
});

router.post('/reset-password', ensureGuest, async (req, res) => {
  const wantsJson = wantsJsonResponse(req);
  const { email } = req.body;

  if (!email || !email.trim()) {
    const message = 'Podaj adres e-mail.';
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    req.flash('error', message);
    return res.redirect('/auth/reset-password');
  }

  const user = await findByEmail(email);

  if (user) {
    try {
      const token = crypto.randomBytes(32).toString('hex');

      await setResetToken(user.id, token, RESET_TOKEN_TTL_MS);
      await sendPasswordResetEmail(user.email, token);
      console.log(`Link resetujący wysłany na: ${user.email}`);
    } catch (err) {
      console.error('Błąd podczas wysyłania maila:', err);
    }
  }

  const message =
    'Jeśli podany adres e-mail istnieje w naszej bazie, wysłaliśmy na niego wiadomość z dalszymi instrukcjami.';

  if (wantsJson) {
    return res.json({ success: true, message });
  }

  req.flash('success', message);
  res.redirect('/auth/signin');
});

/* ------------------- USTAWIANIE NOWEGO HASŁA (Z LINKU W MAILU) ------------------- */

router.get('/reset-password/:token', ensureGuest, async (req, res) => {
  const { token } = req.params;
  const user = await findByResetToken(token);

  res.render('auth/new-password', {
    title: 'Ustaw nowe hasło',
    valid: !!user,
    token,
  });
});

router.post('/reset-password/:token', ensureGuest, async (req, res) => {
  const wantsJson = wantsJsonResponse(req);
  const { token } = req.params;
  const { password, password2 } = req.body;

  const user = await findByResetToken(token);

  if (!user) {
    const message = 'Link jest nieprawidłowy lub wygasł. Poproś o nowy.';
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    req.flash('error', message);
    return res.redirect('/auth/reset-password');
  }

  const errors = [];
  if (!password || password.length < 8) {
    errors.push('Hasło musi mieć co najmniej 8 znaków.');
  }
  if (password !== password2) {
    errors.push('Podane hasła nie są identyczne.');
  }

  if (errors.length > 0) {
    const message = errors.join(' ');
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    req.flash('error', message);
    return res.redirect(`/auth/reset-password/${token}`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await updatePassword(user.id, passwordHash);
  await clearResetToken(user.id); // token jednorazowy - unieważniamy po użyciu

  const message = 'Hasło zostało zmienione. Możesz się teraz zalogować.';

  if (wantsJson) {
    return res.json({ success: true, message });
  }

  req.flash('success', message);
  res.redirect('/auth/signin');
});

module.exports = router;