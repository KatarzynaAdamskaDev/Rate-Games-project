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

/** Pomaga obliczyć aktualny poziom użytkownika (do weryfikacji odblokowań). */
async function getCurrentLevel(userId) {
  const user = await findById(userId);
  const vm = await buildProfileViewModel(user);
  return levelProgress(pointsFromStats(vm.stats)).level;
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

router.get('/settings', ensureAuthenticated, async (req, res) => {
  const user = await findById(req.session.user.id);
  // Poziom, ramki, tła i odznaki (wcześniej zakładka na profilu) są częścią edycji profilu.
  const vm = await buildProfileViewModel(user);
  res.render('profile/settings', {
    title: 'Edytuj profil',
    ...vm,
  });
});

router.post('/settings/username', ensureAuthenticated, async (req, res) => {
  const { username } = req.body;

  if (!username || username.trim().length < 3) {
    req.flash('error', 'Nazwa użytkownika musi mieć co najmniej 3 znaki.');
    return res.redirect('/profile/settings');
  }

  if (isReservedUsername(username)) {
    req.flash('error', 'Ta nazwa użytkownika jest zarezerwowana i niedostępna.');
    return res.redirect('/profile/settings');
  }

  const result = await updateUsername(req.session.user.id, username.trim());
  if (!result.ok) {
    req.flash(
      'error',
      result.reason === 'taken'
        ? 'Ta nazwa użytkownika jest już zajęta.'
        : 'Nie udało się zmienić nazwy użytkownika.'
    );
    return res.redirect('/profile/settings');
  }

  req.session.user.username = result.user.username;
  req.flash('success', 'Nazwa użytkownika została zmieniona.');
  res.redirect('/profile/settings');
});

router.post('/settings/password', ensureAuthenticated, async (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    req.flash('error', 'Nowe hasło musi mieć co najmniej 8 znaków.');
    return res.redirect('/profile/settings');
  }
  if (newPassword !== confirmPassword) {
    req.flash('error', 'Podane hasła nie są identyczne.');
    return res.redirect('/profile/settings');
  }

  const user = await findById(req.session.user.id);
  if (user && (await bcrypt.compare(newPassword, user.passwordHash))) {
    req.flash('error', 'Nowe hasło nie może być takie samo jak obecne.');
    return res.redirect('/profile/settings');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updatePassword(req.session.user.id, passwordHash);
  req.flash('success', 'Hasło zostało zmienione.');
  res.redirect('/profile/settings');
});

/* --------------------------- AWATAR --------------------------- */

router.post('/settings/avatar', ensureAuthenticated, (req, res) => {
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
      return res.redirect('/profile/settings');
    }
    if (!req.file) {
      req.flash('error', 'Wybierz plik ze zdjęciem.');
      return res.redirect('/profile/settings');
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
    res.redirect('/profile/settings');
  });
});

/* --------------------------- OPIS PROFILU (BIO) --------------------------- */

router.post('/settings/bio', ensureAuthenticated, async (req, res) => {
  const bio = (req.body.bio || '').trim().slice(0, 300);
  await User.update({ bio }, { where: { id: req.session.user.id } });
  req.flash('success', 'Opis profilu został zaktualizowany.');
  res.redirect('/profile/settings');
});

/* --------------------- RAMKI / TŁA (WYBÓR AKTYWNYCH) --------------------- */

router.post('/customize/frame/:frameId', ensureAuthenticated, async (req, res) => {
  const { frameId } = req.params;
  const frame = FRAMES.find((f) => f.id === frameId);

  if (!frame) {
    req.flash('error', 'Nieznana ramka.');
    return res.redirect('/profile/settings#wyglad');
  }

  const level = await getCurrentLevel(req.session.user.id);
  if (frame.levelRequired > level) {
    req.flash('error', `Ta ramka odblokowuje się na poziomie ${frame.levelRequired}.`);
    return res.redirect('/profile/settings#wyglad');
  }

  await User.update({ activeFrame: frameId }, { where: { id: req.session.user.id } });
  req.flash('success', `Ustawiono ramkę: ${frame.label}.`);
  res.redirect('/profile/settings#wyglad');
});

router.post('/customize/background/:bgId', ensureAuthenticated, async (req, res) => {
  const { bgId } = req.params;
  const bg = BACKGROUNDS.find((b) => b.id === bgId);

  if (!bg) {
    req.flash('error', 'Nieznane tło.');
    return res.redirect('/profile/settings#wyglad');
  }

  const level = await getCurrentLevel(req.session.user.id);
  if (bg.levelRequired > level) {
    req.flash('error', `To tło odblokowuje się na poziomie ${bg.levelRequired}.`);
    return res.redirect('/profile/settings#wyglad');
  }

  await User.update({ activeBackground: bgId }, { where: { id: req.session.user.id } });
  req.flash('success', `Ustawiono tło: ${bg.label}.`);
  res.redirect('/profile/settings#wyglad');
});

router.post('/customize/trophy/:badgeId', ensureAuthenticated, async (req, res) => {
  const { badgeId } = req.params;
  const user = await findById(req.session.user.id);
  const { allBadges } = await buildProfileViewModel(user);

  if (badgeId === 'default') {
    await User.update({ activeTrophy: null }, { where: { id: user.id } });
    req.flash('success', 'Ustawiono domyślne trofeum.');
    return res.redirect('/profile/settings#trofeum');
  }

  const badge = allBadges.find((b) => b.id === badgeId);
  if (!badge) {
    req.flash('error', 'Nieznana odznaka.');
    return res.redirect('/profile/settings#trofeum');
  }
  if (badge.locked) {
    req.flash('error', 'Ta odznaka nie jest jeszcze odblokowana.');
    return res.redirect('/profile/settings#trofeum');
  }

  await User.update({ activeTrophy: badgeId }, { where: { id: user.id } });
  req.flash('success', `Trofeum w banerze: ${badge.label}.`);
  res.redirect('/profile/settings#trofeum');
});

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

router.post('/follow/:username', ensureAuthenticated, async (req, res) => {
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

router.post('/unfollow/:username', ensureAuthenticated, async (req, res) => {
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