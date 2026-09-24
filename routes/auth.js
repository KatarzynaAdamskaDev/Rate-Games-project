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
const { isReservedUsername } = require('../utils/reservedUsernames');
const { moderateName } = require('../utils/contentFilter');
const { limiters } = require('../middleware/rateLimit');
const User = require('../models/User');
const totp = require('../utils/totp');
const { isBanActive, banMessage } = require('../utils/moderationStatus');
const { closeSession: closeChatStreams } = require('../utils/chatEvents');

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minut
const TWO_FACTOR_PENDING_MS = 5 * 60 * 1000; // tyle czasu na wpisanie kodu 2FA

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

/** Skraca adres e-mail w logach (a***@gmail.com), żeby nie zapisywać go w całości. */
function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  return domain ? `${name.slice(0, 1)}***@${domain}` : '***';
}

/** Jednoznaczny komunikat w terminalu: czy krok resetowania hasła się udał. */
function logReset(ok, message) {
  console.log(`${ok ? '[reset hasła] OK:' : '[reset hasła] BŁĄD:'} ${message}`);
}

/** Sprawdza, czy klient oczekuje odpowiedzi JSON (fetch) czy pełnej strony. */
function wantsJsonResponse(req) {
  return req.xhr || (req.headers.accept || '').includes('application/json');
}

/** Zapisuje użytkownika w sesji (po poprawnym haśle albo po kodzie 2FA). */
function startSession(req, user, remember) {
  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl || null,
  };

  if (remember) {
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
  }
}

/* ---------------------------- SIGN UP ---------------------------- */

router.get('/signup', ensureGuest, (req, res) => {
  res.render('auth/signup', {
    title: 'Utwórz konto',
    formData: {},
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY,
  });
});

router.post('/signup', ensureGuest, limiters.signup, async (req, res, next) => {
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
    if (username && isReservedUsername(username)) {
      errors.push('Ta nazwa użytkownika jest zarezerwowana i niedostępna.');
    }
    if (username && (await findByUsername(username))) {
      errors.push('Ta nazwa użytkownika jest już zajęta.');
    }
    if (username && !moderateName(username).ok) {
      errors.push('Ta nazwa użytkownika zawiera niedozwolone słownictwo.');
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
    console.error('Błąd serwera w routes/auth.js:', err);
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

router.post('/signin', ensureGuest, limiters.signin, limiters.signinAccount, async (req, res, next) => {
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

    if (isBanActive(user)) {
      const message = banMessage(user);
      if (wantsJson) {
        return res.status(403).json({ success: false, message });
      }
      req.flash('error', message);
      return res.status(403).render('auth/signin', {
        title: 'Zaloguj się',
        formData: { identifier },
      });
    }

    // Administrator z włączonym 2FA: hasło to dopiero pierwszy krok - sesji jeszcze nie zakładamy.
    if (user.role === 'admin' && user.twoFactorEnabled) {
      req.session.pendingTwoFactor = {
        userId: user.id,
        remember: !!remember,
        expiresAt: Date.now() + TWO_FACTOR_PENDING_MS,
      };
      if (wantsJson) {
        return res.json({
          success: true,
          twoFactor: true,
          message: 'Podaj kod z aplikacji uwierzytelniającej.',
        });
      }
      // Okno z kodem otwiera się samo na stronie głównej (pendingTwoFactor).
      return res.redirect('/');
    }

    startSession(req, user, remember);

    if (wantsJson) {
      return res.json({
        success: true,
        message: `Witaj ponownie, ${user.username}!`,
      });
    }

    req.flash('success', `Witaj ponownie, ${user.username}!`);
    res.redirect('/');
  } catch (err) {
    console.error('Błąd serwera w routes/auth.js:', err);
    if (wantsJson) {
      return res.status(500).json({ success: false, message: 'Wystąpił błąd serwera.' });
    }
    next(err);
  }
});

/* ------------------- DRUGI KROK LOGOWANIA: KOD 2FA (ADMIN) ------------------- */

function getPendingTwoFactor(req) {
  const pending = req.session.pendingTwoFactor;
  if (!pending || pending.expiresAt < Date.now()) {
    delete req.session.pendingTwoFactor;
    return null;
  }
  return pending;
}

// Kod 2FA wpisuje się w oknie modalnym (partials/two-factor-modal.ejs), więc osobnej strony nie ma.
router.get('/2fa', (req, res) => res.redirect('/'));

router.post('/2fa/cancel', (req, res) => {
  delete req.session.pendingTwoFactor;
  if (wantsJsonResponse(req)) return res.json({ success: true });
  res.redirect('/');
});

router.post('/2fa', ensureGuest, limiters.twoFactor, async (req, res, next) => {
  const wantsJson = wantsJsonResponse(req);

  function fail(status, message, closeModal = false) {
    if (closeModal) delete req.session.pendingTwoFactor;
    if (wantsJson) return res.status(status).json({ success: false, message });
    req.flash('error', message);
    return res.redirect('/');
  }

  try {
    const pending = getPendingTwoFactor(req);
    if (!pending) return fail(400, 'Sesja logowania wygasła. Zaloguj się ponownie.', true);

    const user = await User.findByPk(pending.userId);
    if (!user || isBanActive(user) || !user.twoFactorEnabled) {
      return fail(400, 'Nie można dokończyć logowania.', true);
    }

    const code = String((req.body && req.body.code) || '').trim();
    let ok = totp.verifyCode(user.twoFactorSecret, code, `login:${user.id}`);

    if (!ok) {
      // Kod awaryjny (jednorazowy) zamiast kodu z aplikacji.
      const remaining = totp.consumeRecoveryCode(user.twoFactorRecovery, code);
      if (remaining) {
        await user.update({ twoFactorRecovery: JSON.stringify(remaining) });
        ok = true;
      }
    }

    if (!ok) return fail(400, 'Nieprawidłowy kod. Spróbuj ponownie.');

    delete req.session.pendingTwoFactor;
    startSession(req, user.get({ plain: true }), pending.remember);

    if (wantsJson) {
      return res.json({ success: true, message: `Witaj ponownie, ${user.username}!` });
    }
    req.flash('success', `Witaj ponownie, ${user.username}!`);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  // Strumienie czatu (SSE) tej sesji zamykamy razem z nią - wylogowana osoba nie może dalej dostawać wiadomości.
  closeChatStreams(req.sessionID);
  req.session.destroy(() => {
    res.redirect('/');
  });
});

/* ------------------------- RESET PASSWORD (WYSYŁKA LINKU) ------------------------- */

router.get('/reset-password', (req, res) => {
  res.render('auth/reset-password', { title: 'Zresetuj hasło' });
});

router.post('/reset-password', limiters.passwordReset, async (req, res) => {
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

  if (!user) {
    // Klientowi zawsze odpowiadamy tak samo (nie ujawniamy, czy konto istnieje).
    logReset(false, `nie wysłano maila - brak konta z adresem ${maskEmail(email)}.`);
  } else if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    logReset(false, 'nie wysłano maila - brak EMAIL_USER / EMAIL_PASS w pliku .env.');
  } else {
    try {
      const token = crypto.randomBytes(32).toString('hex');

      await setResetToken(user.id, token, RESET_TOKEN_TTL_MS);
      await sendPasswordResetEmail(user.email, token);
      logReset(true, `mail z linkiem wysłany na ${maskEmail(user.email)} (link ważny 15 min).`);
    } catch (err) {
      logReset(false, `nie udało się wysłać maila na ${maskEmail(user.email)}: ${err.message}`);
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

router.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const user = await findByResetToken(token);

  res.render('auth/new-password', {
    title: 'Ustaw nowe hasło',
    valid: !!user,
    token,
  });
});

router.post('/reset-password/:token', async (req, res) => {
  const wantsJson = wantsJsonResponse(req);
  const { token } = req.params;
  const { password, password2 } = req.body;

  const user = await findByResetToken(token);

  if (!user) {
    logReset(false, 'ustawianie nowego hasła odrzucone - link nieprawidłowy lub wygasł.');
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
  if (errors.length === 0 && (await bcrypt.compare(password, user.passwordHash))) {
    errors.push('Nowe hasło nie może być takie samo jak dotychczasowe.');
  }

  if (errors.length > 0) {
    logReset(false, `nowe hasło dla ${user.username} odrzucone: ${errors.join(' ')}`);
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
  logReset(true, `hasło zmienione dla użytkownika ${user.username}.`);

  const message = 'Hasło zostało zmienione. Możesz się teraz zalogować.';

  if (wantsJson) {
    return res.json({ success: true, message });
  }

  req.flash('success', message);
  res.redirect('/auth/signin');
});

module.exports = router;