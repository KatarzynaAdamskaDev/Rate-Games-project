const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { ensureAuthenticated } = require('../middleware/auth');
const {
  findById,
  findByUsername,
  updatePassword,
} = require('../utils/userHelpers');
const { updateUsername, deleteUser } = require('../utils/profileHelpers');
const { isReservedUsername } = require('../utils/reservedUsernames');
const { moderateText, moderateName } = require('../utils/contentFilter');
const { limiters } = require('../middleware/rateLimit');
const { NOTIFICATION_TYPES, parsePrefs, serializePrefs } = require('../utils/notificationPrefs');
const totp = require('../utils/totp');
const { MAX_FAVORITES, addFavorite, removeFavorite } = require('../utils/favoriteHelpers');
const { follow, unfollow } = require('../utils/socialHelpers');
const { createNotification } = require('../utils/notificationHelpers');
const {
  buildProfileViewModel,
  buildTabData,
  normalizeProfileTab,
} = require('../utils/profileViewModel');
const {
  levelProgress,
  pointsFromStats,
  FRAMES,
  BACKGROUNDS,
} = require('../utils/pointsHelpers');
const User = require('../models/User');

/* --------------------------- ZAKŁADKI USTAWIEŃ --------------------------- */

const SETTINGS_TABS = [
  { id: 'general', label: 'Ogólne', icon: 'bi-person-fill' },
  { id: 'avatar', label: 'Awatar', icon: 'bi-image-fill' },
  { id: 'appearance', label: 'Wygląd profilu', icon: 'bi-palette-fill' },
  { id: 'notifications', label: 'Powiadomienia', icon: 'bi-bell-fill' },
  { id: 'account', label: 'Konto i bezpieczeństwo', icon: 'bi-shield-lock-fill' },
];

function settingsUrl(tab) {
  return `/profile/settings?tab=${tab}`;
}

/* --------------------------- UPLOAD AWATARA --------------------------- */

const AVATAR_DIR = path.join(__dirname, '..', 'public', 'images', 'avatars');
// Git nie przechowuje pustych katalogów, więc na świeżym klonie projektu
// katalog nie istnieje, a multer nie tworzy go sam (błąd ENOENT przy uploadzie).
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.session.user.id}-${Date.now()}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      const invalidType = new Error('Dozwolone są tylko pliki PNG, JPG, WEBP lub GIF.');
      invalidType.userFacing = true;
      return cb(invalidType);
    }
    cb(null, true);
  },
});

/** Aktualny poziom użytkownika i ewentualne "odblokuj wszystko" od administratora (do weryfikacji odblokowań). */
async function getUnlockContext(userId) {
  const user = await findById(userId);
  const vm = await buildProfileViewModel(user);
  return {
    level: levelProgress(pointsFromStats(vm.stats)).level,
    unlockAll: !!user.unlockAll,
  };
}

/* -------------------------- WŁASNY PROFIL -------------------------- */

router.get('/', ensureAuthenticated, async (req, res) => {
  const user = await findById(req.session.user.id);
  const vm = await buildProfileViewModel(user);
  const tab = normalizeProfileTab(req.query.tab);
  const tabData = await buildTabData(user.id, tab);

  res.render('profile/show', {
    title: 'Twój profil',
    ...vm,
    ...tabData,
    isOwnProfile: true,
    alreadyFollowing: false,
    maxFavorites: MAX_FAVORITES,
    tab,
  });
});

router.get('/settings', ensureAuthenticated, async (req, res, next) => {
  try {
    const tab = SETTINGS_TABS.some((t) => t.id === req.query.tab) ? req.query.tab : 'general';
    const user = await findById(req.session.user.id);
    // Poziom, ramki, tła i odznaki (wcześniej zakładka na profilu) są częścią edycji profilu.
    const vm = await buildProfileViewModel(user);

    const twoFactor = { available: user.role === 'admin', enabled: !!user.twoFactorEnabled };
    if (twoFactor.available && tab === 'account') {
      let recoveryLeft = 0;
      try {
        recoveryLeft = JSON.parse(user.twoFactorRecovery || '[]').length;
      } catch (err) {
        recoveryLeft = 0;
      }
      twoFactor.recoveryLeft = recoveryLeft;

      const pending = req.session.twoFactorSetup;
      if (pending && !twoFactor.enabled) {
        twoFactor.setup = {
          secret: pending.secret,
          qr: await totp.buildQrDataUrl(pending.secret, user.email),
        };
      }
      // Kody awaryjne pokazujemy tylko raz - zaraz po włączeniu 2FA.
      if (req.session.newRecoveryCodes) {
        twoFactor.newRecoveryCodes = req.session.newRecoveryCodes;
        delete req.session.newRecoveryCodes;
      }
    }

    res.render('profile/settings', {
      title: 'Edytuj profil',
      ...vm,
      tab,
      tabs: SETTINGS_TABS,
      accountEmail: user.email,
      notificationTypes: NOTIFICATION_TYPES,
      notificationPrefs: parsePrefs(user.notificationPrefs),
      twoFactor,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/username', ensureAuthenticated, async (req, res) => {
  const { username } = req.body;

  if (!username || username.trim().length < 3) {
    req.flash('error', 'Nazwa użytkownika musi mieć co najmniej 3 znaki.');
    return res.redirect(settingsUrl('general'));
  }

  if (isReservedUsername(username)) {
    req.flash('error', 'Ta nazwa użytkownika jest zarezerwowana i niedostępna.');
    return res.redirect(settingsUrl('general'));
  }

  const nameCheck = moderateName(username);
  if (!nameCheck.ok) {
    req.flash('error', nameCheck.error);
    return res.redirect(settingsUrl('general'));
  }

  const result = await updateUsername(req.session.user.id, username.trim());
  if (!result.ok) {
    req.flash(
      'error',
      result.reason === 'taken'
        ? 'Ta nazwa użytkownika jest już zajęta.'
        : 'Nie udało się zmienić nazwy użytkownika.'
    );
    return res.redirect(settingsUrl('general'));
  }

  req.session.user.username = result.user.username;
  req.flash('success', 'Nazwa użytkownika została zmieniona.');
  res.redirect(settingsUrl('general'));
});

router.post('/settings/password', ensureAuthenticated, async (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    req.flash('error', 'Nowe hasło musi mieć co najmniej 8 znaków.');
    return res.redirect(settingsUrl('account'));
  }
  if (newPassword !== confirmPassword) {
    req.flash('error', 'Podane hasła nie są identyczne.');
    return res.redirect(settingsUrl('account'));
  }

  const user = await findById(req.session.user.id);
  if (user && (await bcrypt.compare(newPassword, user.passwordHash))) {
    req.flash('error', 'Nowe hasło nie może być takie samo jak obecne.');
    return res.redirect(settingsUrl('account'));
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updatePassword(req.session.user.id, passwordHash);
  req.flash('success', 'Hasło zostało zmienione.');
  res.redirect(settingsUrl('account'));
});

/* --------------------------- AWATAR --------------------------- */

router.post('/settings/avatar', ensureAuthenticated, limiters.upload, (req, res) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      let message = 'Nie udało się wgrać zdjęcia. Spróbuj ponownie.';
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'Zdjęcie jest za duże (maksymalnie 2 MB).';
      } else if (err.userFacing) {
        message = err.message;
      } else {
        console.error('Błąd uploadu awatara:', err);
      }
      req.flash('error', message);
      return res.redirect(settingsUrl('avatar'));
    }
    if (!req.file) {
      req.flash('error', 'Wybierz plik ze zdjęciem.');
      return res.redirect(settingsUrl('avatar'));
    }

    const user = await User.findByPk(req.session.user.id);
    const oldAvatarUrl = user.avatarUrl;

    user.avatarUrl = `/images/avatars/${req.file.filename}`;
    await user.save();
    req.session.user.avatarUrl = user.avatarUrl; // od razu odświeża awatar w navbarze

    // Sprzątamy poprzedni plik awatara, żeby nie zaśmiecać dysku.
    if (oldAvatarUrl && oldAvatarUrl.startsWith('/images/avatars/')) {
      const oldPath = path.join(__dirname, '..', 'public', oldAvatarUrl);
      fs.unlink(oldPath, () => {}); // ignorujemy błąd, jeśli plik już nie istnieje
    }

    req.flash('success', 'Zdjęcie profilowe zostało zaktualizowane.');
    res.redirect(settingsUrl('avatar'));
  });
});

router.post('/settings/avatar/remove', ensureAuthenticated, async (req, res) => {
  const user = await User.findByPk(req.session.user.id);
  const oldAvatarUrl = user.avatarUrl;

  user.avatarUrl = null;
  await user.save();
  req.session.user.avatarUrl = null;

  if (oldAvatarUrl && oldAvatarUrl.startsWith('/images/avatars/')) {
    fs.unlink(path.join(__dirname, '..', 'public', oldAvatarUrl), () => {});
  }

  req.flash('success', 'Zdjęcie profilowe zostało usunięte.');
  res.redirect(settingsUrl('avatar'));
});

/* --------------------------- OPIS PROFILU (BIO) --------------------------- */

router.post('/settings/bio', ensureAuthenticated, async (req, res) => {
  const checked = moderateText((req.body.bio || '').trim().slice(0, 300), {
    userId: req.session.user.id,
    duplicates: false,
  });
  if (!checked.ok) {
    req.flash('error', checked.error);
    return res.redirect(settingsUrl('general'));
  }

  await User.update({ bio: checked.text }, { where: { id: req.session.user.id } });
  req.flash(
    'success',
    checked.masked
      ? 'Opis zapisany - niedozwolone słowa zostały zamaskowane.'
      : 'Opis profilu został zaktualizowany.'
  );
  res.redirect(settingsUrl('general'));
});

/* --------------------- RAMKI / TŁA (WYBÓR AKTYWNYCH) --------------------- */

router.post('/customize/frame/:frameId', ensureAuthenticated, async (req, res) => {
  const { frameId } = req.params;
  const frame = FRAMES.find((f) => f.id === frameId);

  if (!frame) {
    req.flash('error', 'Nieznana ramka.');
    return res.redirect(settingsUrl('appearance'));
  }

  const { level, unlockAll } = await getUnlockContext(req.session.user.id);
  if (!unlockAll && frame.levelRequired > level) {
    req.flash('error', `Ta ramka odblokowuje się na poziomie ${frame.levelRequired}.`);
    return res.redirect(settingsUrl('appearance'));
  }

  await User.update({ activeFrame: frameId }, { where: { id: req.session.user.id } });
  req.flash('success', `Ustawiono ramkę: ${frame.label}.`);
  res.redirect(settingsUrl('appearance'));
});

router.post('/customize/background/:bgId', ensureAuthenticated, async (req, res) => {
  const { bgId } = req.params;
  const bg = BACKGROUNDS.find((b) => b.id === bgId);

  if (!bg) {
    req.flash('error', 'Nieznane tło.');
    return res.redirect(settingsUrl('appearance'));
  }

  const { level, unlockAll } = await getUnlockContext(req.session.user.id);
  if (!unlockAll && bg.levelRequired > level) {
    req.flash('error', `To tło odblokowuje się na poziomie ${bg.levelRequired}.`);
    return res.redirect(settingsUrl('appearance'));
  }

  await User.update({ activeBackground: bgId }, { where: { id: req.session.user.id } });
  req.flash('success', `Ustawiono tło: ${bg.label}.`);
  res.redirect(settingsUrl('appearance'));
});

router.post('/customize/trophy/:badgeId', ensureAuthenticated, async (req, res) => {
  const { badgeId } = req.params;
  const user = await findById(req.session.user.id);
  const { allBadges } = await buildProfileViewModel(user);

  if (badgeId === 'default') {
    await User.update({ activeTrophy: null }, { where: { id: user.id } });
    req.flash('success', 'Ustawiono domyślne trofeum.');
    return res.redirect(settingsUrl('appearance'));
  }

  const badge = allBadges.find((b) => b.id === badgeId);
  if (!badge) {
    req.flash('error', 'Nieznana odznaka.');
    return res.redirect(settingsUrl('appearance'));
  }
  if (badge.locked) {
    req.flash('error', 'Ta odznaka nie jest jeszcze odblokowana.');
    return res.redirect(settingsUrl('appearance'));
  }

  await User.update({ activeTrophy: badgeId }, { where: { id: user.id } });
  req.flash('success', `Trofeum w banerze: ${badge.label}.`);
  res.redirect(settingsUrl('appearance'));
});

/* --------------------------- POWIADOMIENIA --------------------------- */

router.post('/settings/notifications', ensureAuthenticated, async (req, res) => {
  await User.update(
    { notificationPrefs: serializePrefs(req.body) },
    { where: { id: req.session.user.id } }
  );
  req.flash('success', 'Ustawienia powiadomień zostały zapisane.');
  res.redirect(settingsUrl('notifications'));
});

/* ------------------- DWUETAPOWE LOGOWANIE (2FA, ADMINISTRATORZY) ------------------- */

function requireAdminRole(req, res, next) {
  if (req.session.user.role === 'admin') return next();
  req.flash('error', 'Dwuetapowe logowanie jest dostępne dla administratorów.');
  return res.redirect(settingsUrl('account'));
}

router.post('/settings/2fa/start', ensureAuthenticated, requireAdminRole, (req, res) => {
  req.session.twoFactorSetup = { secret: totp.generateSecret() };
  res.redirect(settingsUrl('account'));
});

router.post('/settings/2fa/cancel', ensureAuthenticated, requireAdminRole, (req, res) => {
  delete req.session.twoFactorSetup;
  res.redirect(settingsUrl('account'));
});

router.post(
  '/settings/2fa/enable',
  ensureAuthenticated,
  requireAdminRole,
  limiters.twoFactor,
  async (req, res) => {
    const pending = req.session.twoFactorSetup;
    if (!pending) {
      req.flash('error', 'Rozpocznij konfigurację od nowa.');
      return res.redirect(settingsUrl('account'));
    }

    if (!totp.verifyCode(pending.secret, req.body.code, `setup:${req.session.user.id}`)) {
      req.flash('error', 'Kod jest nieprawidłowy albo wygasł. Wpisz aktualny kod z aplikacji.');
      return res.redirect(settingsUrl('account'));
    }

    const { codes, hashes } = totp.generateRecoveryCodes();
    await User.update(
      {
        twoFactorEnabled: true,
        twoFactorSecret: pending.secret,
        twoFactorRecovery: JSON.stringify(hashes),
      },
      { where: { id: req.session.user.id } }
    );
    delete req.session.twoFactorSetup;
    req.session.newRecoveryCodes = codes;

    req.flash('success', 'Dwuetapowe logowanie zostało włączone.');
    res.redirect(settingsUrl('account'));
  }
);

router.post(
  '/settings/2fa/disable',
  ensureAuthenticated,
  requireAdminRole,
  limiters.twoFactor,
  async (req, res) => {
    const user = await User.findByPk(req.session.user.id);
    const passwordOk = await bcrypt.compare(req.body.password || '', user.passwordHash);
    const code = String(req.body.code || '');
    const codeOk =
      totp.verifyCode(user.twoFactorSecret, code, `login:${user.id}`) ||
      totp.consumeRecoveryCode(user.twoFactorRecovery, code) !== null;

    if (!passwordOk || !codeOk) {
      req.flash('error', 'Hasło lub kod jest nieprawidłowy - 2FA pozostaje włączone.');
      return res.redirect(settingsUrl('account'));
    }

    await user.update({ twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecovery: null });
    req.flash('success', 'Dwuetapowe logowanie zostało wyłączone.');
    res.redirect(settingsUrl('account'));
  }
);

router.post('/settings/delete', ensureAuthenticated, async (req, res) => {
  await deleteUser(req.session.user.id);
  req.session.destroy(() => {
    res.redirect('/');
  });
});

/* ------------------------------ ULUBIONE GRY ------------------------------ */

router.post('/favorites', ensureAuthenticated, async (req, res) => {
  const result = await addFavorite(req.session.user.id, req.body.gameId);

  if (result.ok) {
    req.flash('success', `Dodano do ulubionych: ${result.title}.`);
  } else {
    const messages = {
      limit: `Możesz mieć maksymalnie ${MAX_FAVORITES} ulubionych gier - usuń którąś, żeby dodać nową.`,
      duplicate: 'Ta gra jest już w Twoich ulubionych.',
      not_found: 'Nie znaleziono takiej gry.',
    };
    req.flash('error', messages[result.reason] || 'Nie udało się dodać gry.');
  }
  res.redirect('/profile?tab=favorites');
});

router.post('/favorites/:gameId/delete', ensureAuthenticated, async (req, res) => {
  await removeFavorite(req.session.user.id, req.params.gameId);
  req.flash('success', 'Usunięto grę z ulubionych.');
  res.redirect('/profile?tab=favorites');
});

/* ----------------------------- OBSERWOWANIE ----------------------------- */

router.post('/follow/:username', ensureAuthenticated, limiters.follow, async (req, res) => {
  const target = await findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika.');
    return res.redirect('/');
  }
  const started = await follow(req.session.user.id, target.id);
  if (started) {
    await createNotification({
      userId: target.id,
      type: 'follow',
      actorId: req.session.user.id,
      message: `Nowy obserwujący: ${req.session.user.username}`,
      link: `/${encodeURIComponent(req.session.user.username)}`,
    });
  }
  res.redirect(req.get('Referer') || `/${target.username}`);
});

router.post('/unfollow/:username', ensureAuthenticated, limiters.follow, async (req, res) => {
  const target = await findByUsername(req.params.username);
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika.');
    return res.redirect('/');
  }
  await unfollow(req.session.user.id, target.id);
  res.redirect(req.get('Referer') || `/${target.username}`);
});

/* ---------------- Kompatybilność wsteczna ze starym adresem ---------------- */
// Stare linki postaci /profile/nazwa przekierowują na nowy /nazwa
router.get('/:username', (req, res) => {
  res.redirect(301, `/${req.params.username}`);
});

module.exports = router;