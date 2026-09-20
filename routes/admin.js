const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { Op, fn, col } = require('sequelize');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Review = require('../models/Review');
const ReviewComment = require('../models/ReviewComment');
const CommentLike = require('../models/CommentLike');
const ReviewReport = require('../models/ReviewReport');
const ContentReport = require('../models/ContentReport');
const CustomGame = require('../models/CustomGame');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AdminLog = require('../models/AdminLog');

const { deleteUser } = require('../utils/profileHelpers');
const { findById } = require('../utils/userHelpers');
const { createNotification } = require('../utils/notificationHelpers');
const { buildProfileViewModel } = require('../utils/profileViewModel');
const { deleteReviewData } = require('../utils/reviewSocialHelpers');
const { syncUserProgress, setUserLevel } = require('../utils/progressHelpers');
const { clearMessages, deleteConversation } = require('../utils/chatHelpers');
const { getGamesByIds, getGameById } = require('../utils/gameCatalog');
const { enrichReviews } = require('../utils/reviewStatsHelpers');
const { buildPagerLinks } = require('../utils/gameListing');
const {
  logAdminAction,
  getSetting,
  setSetting,
  getDashboardStats,
} = require('../utils/adminHelpers');
const { getModeration, saveModeration, PROFANITY_MODES, MAX_EXTRA_WORDS_LENGTH } = require('../utils/moderationSettings');
const { getRules, getStats: getRateLimitStats } = require('../middleware/rateLimit');
const backup = require('../utils/backupHelpers');
const { sanitizeImage } = require('../utils/imageSafety');
const { checkUploadToken, verifyAfterUpload, reject: rejectCsrf, isValid: csrfValid } = require('../middleware/csrf');
const gameForm = require('../utils/gameFormOptions');
const gameLookup = require('../utils/igdbLookup');
const totp = require('../utils/totp');
const roles = require('../utils/adminRoles');
const status = require('../utils/moderationStatus');
const { TYPE_LABELS } = require('../utils/reportReasons');
const SiteSetting = require('../models/SiteSetting');
const AdminIdea = require('../models/AdminIdea');
const { IDEAS, AREAS, DECISIONS, findIdea } = require('../utils/adminIdeas');
const { getPosts: getBlogPosts, removePost: removeBlogPost } = require('../utils/blogHelpers');

const PAGE_SIZE = 15;

router.use(ensureAuthenticated, ensureAdmin);

// Wymóg 2FA dla administratorów (Ustawienia -> Bezpieczeństwo) oraz plakietka zgłoszeń w menu bocznym.
router.use(async (req, res, next) => {
  try {
    // Rolę sprawdzamy w bazie przy każdym wejściu, więc odebrane uprawnienia działają od razu (nie po minucie odświeżenia sesji).
    const me = await User.findByPk(req.session.user.id, { attributes: ['role', 'isBanned', 'bannedUntil', 'twoFactorEnabled'] });
    if (!me || me.role !== 'admin' || status.isBanActive(me)) {
      if (req.session.user) req.session.user.role = me ? me.role : 'user';
      req.flash('error', 'Nie masz już uprawnień administratora.');
      return res.redirect('/');
    }
    res.locals.adminHasTwoFactor = !!me.twoFactorEnabled;

    if (getModeration().require2fa && !res.locals.adminHasTwoFactor) {
      req.flash('error', 'Panel admina wymaga włączonej weryfikacji dwuetapowej (2FA). Skonfiguruj ją poniżej.');
      return res.redirect('/profile/settings?tab=account');
    }

    const [pendingReviewReports, pendingContentReports] = await Promise.all([
      ReviewReport.count({ where: { status: 'pending' } }),
      ContentReport.count({ where: { status: 'pending' } }),
    ]);
    res.locals.pendingReportsCount = pendingReviewReports + pendingContentReports;

    res.locals.pendingIdeasCount = (await loadAllIdeas()).filter((idea) => !idea.decision).length;
    next();
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ narzędzia ------------------------------ */

const IDEA_ORDER = { pending: 0, accepted: 1, later: 2, rejected: 3, done: 4 };
const IDEA_EFFORTS = ['mały', 'średni', 'duży'];
const IDEA_IMPACTS = ['niski', 'średni', 'wysoki'];

/** Decyzje administratora w sprawie propozycji: Map id -> accepted | later | rejected. */
async function loadIdeaDecisions() {
  const rows = await SiteSetting.findAll({ where: { key: { [Op.like]: 'idea:%' } } });
  return new Map(rows.filter((r) => r.value).map((r) => [r.key.slice('idea:'.length), r.value]));
}

/** Propozycje dodane przez administratorów (najnowsze) i wbudowane, każda z decyzją lub null. */
async function loadAllIdeas() {
  const [decided, customRows] = await Promise.all([
    loadIdeaDecisions(),
    AdminIdea.findAll({ order: [['createdAt', 'DESC']] }),
  ]);
  const custom = customRows.map((row) => ({ ...row.get({ plain: true }), custom: true }));
  // Propozycje już wdrożone w kodzie (implemented) są domyślnie "Zrealizowane", chyba że administrator zdecydował inaczej.
  return [...custom, ...IDEAS].map((idea) => ({
    ...idea,
    decision: decided.get(idea.id) || (idea.implemented ? 'done' : null),
  }));
}

async function findAnyIdea(id) {
  const builtIn = findIdea(id);
  if (builtIn) return builtIn;
  const row = await AdminIdea.findByPk(id);
  return row ? { ...row.get({ plain: true }), custom: true } : null;
}

function pageOf(req, total, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
  return { page, pages, offset: (page - 1) * size, limit: size };
}

/** Wraca na stronę, z której wysłano formularz (tylko w obrębie /admin). */
function backTo(req, fallback) {
  try {
    const url = new URL(req.get('Referer') || '', `http://${req.get('host')}`);
    if (url.pathname.startsWith('/admin')) return url.pathname + url.search;
  } catch (err) {
    // niepoprawny nagłówek Referer - użyj adresu domyślnego
  }
  return fallback;
}

function render(res, view, active, title, data = {}) {
  res.render(`admin/${view}`, { title: `Panel admina - ${title}`, active, pageTitle: title, ...data });
}

function likeFilter(value) {
  return { [Op.like]: `%${value}%` };
}

/** Zabezpieczenia przed pomyłkami: własne konto i inni administratorzy. */
function guardTarget(req, res, target, { allowAdmin = false } = {}) {
  if (!target) {
    req.flash('error', 'Nie znaleziono użytkownika.');
    res.redirect(backTo(req, '/admin/users'));
    return false;
  }
  if (target.id === req.session.user.id) {
    req.flash('error', 'Tej operacji nie możesz wykonać na własnym koncie.');
    res.redirect(backTo(req, '/admin/users'));
    return false;
  }
  if (!allowAdmin && target.role === 'admin') {
    req.flash('error', 'Najpierw odbierz temu użytkownikowi uprawnienia administratora.');
    res.redirect(backTo(req, '/admin/users'));
    return false;
  }
  return true;
}

/** Usuwa recenzję razem z jej danymi i odświeża PD autora. */
async function removeReview(review) {
  await deleteReviewData(review.id);
  await review.destroy();
  await syncUserProgress(review.userId);
}

/* ------------------------------ pulpit ------------------------------ */

router.get('/', async (req, res, next) => {
  try {
    const [stats, latestUsers, latestReviewRows, pendingRows] = await Promise.all([
      getDashboardStats(),
      User.findAll({ order: [['createdAt', 'DESC']], limit: 5 }),
      Review.findAll({ order: [['createdAt', 'DESC']], limit: 5 }),
      ReviewReport.findAll({ where: { status: 'pending' }, order: [['createdAt', 'DESC']], limit: 5 }),
    ]);

    const latestReviews = await enrichReviews(latestReviewRows.map((r) => r.get({ plain: true })));
    const reportReviews = await Review.findAll({ where: { id: pendingRows.map((r) => r.reviewId) } });
    const reviewById = new Map(reportReviews.map((r) => [r.id, r]));

    render(res, 'dashboard', 'dashboard', 'Pulpit', {
      stats,
      latestUsers: latestUsers.map((u) => u.get({ plain: true })),
      latestReviews,
      pendingReports: pendingRows.map((r) => ({
        ...r.get({ plain: true }),
        review: reviewById.get(r.reviewId) ? reviewById.get(r.reviewId).get({ plain: true }) : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ użytkownicy ------------------------------ */

router.get('/users', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = ['admin', 'banned', 'muted'].includes(req.query.filter) ? req.query.filter : '';

    const where = {};
    if (q) where[Op.or] = [{ username: likeFilter(q) }, { email: likeFilter(q) }];
    if (filter === 'admin') where.role = 'admin';
    if (filter === 'banned') Object.assign(where, status.activeBanWhere());
    if (filter === 'muted') where.mutedUntil = { [Op.gt]: new Date() };

    const total = await User.count({ where });
    const { page, pages, offset, limit } = pageOf(req, total);
    const rows = await User.findAll({ where, order: [['createdAt', 'DESC']], limit, offset });

    const counts = await Review.findAll({
      attributes: ['userId', [fn('COUNT', col('id')), 'total']],
      where: { userId: rows.map((u) => u.id) },
      group: ['userId'],
      raw: true,
    });
    const reviewCounts = new Map(counts.map((c) => [c.userId, Number(c.total)]));

    const viewer = await User.findByPk(req.session.user.id);
    const probation = roles.probationEndsAt(viewer);

    render(res, 'users', 'users', 'Użytkownicy', {
      durations: status.DURATIONS,
      formatUntil: status.formatUntil,
      probationEnds: probation,
      probationDays: roles.PROBATION_DAYS,
      users: rows.map((u) => {
        const plain = u.get({ plain: true });
        return {
          ...plain,
          reviewCount: reviewCounts.get(u.id) || 0,
          banActive: status.isBanActive(plain),
          muteActive: status.isMuted(plain),
          muteForever: status.isPermanentMute(plain),
          roleChange: roles.evaluateRoleChange(viewer, plain, plain.role === 'admin' ? 'user' : 'admin'),
        };
      }),
      q,
      filter,
      total,
      pager: buildPagerLinks(req, page, page < pages, pages),
      page,
      pages,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/role', async (req, res, next) => {
  try {
    const back = backTo(req, '/admin/users');
    const actor = await User.findByPk(req.session.user.id);
    const target = await User.findByPk(req.params.id);
    if (!target) {
      req.flash('error', 'Nie znaleziono użytkownika.');
      return res.redirect(back);
    }

    const newRole = req.body.role === 'admin' ? 'admin' : 'user';
    const rule = roles.evaluateRoleChange(actor, target, newRole);
    if (!rule.ok) {
      req.flash('error', rule.reason);
      return res.redirect(back);
    }

    // Ponowne potwierdzenie: nazwa użytkownika, hasło i (przy włączonym 2FA) kod.
    const lockedMinutes = roles.lockedFor(actor.id);
    if (lockedMinutes > 0) {
      req.flash('error', `Za dużo nieudanych potwierdzeń. Spróbuj za ${lockedMinutes} min.`);
      return res.redirect(back);
    }

    const nameOk = String(req.body.confirmName || '').trim().toLowerCase() === target.username.toLowerCase();
    const passwordOk = await bcrypt.compare(String(req.body.password || ''), actor.passwordHash);
    const codeOk = !actor.twoFactorEnabled || totp.verifyCode(actor.twoFactorSecret, req.body.code, `role:${actor.id}`);

    if (!nameOk || !passwordOk || !codeOk) {
      roles.registerFailure(actor.id);
      await logAdminAction(req, 'user.role-denied', 'user', target.username, 'Nieudane potwierdzenie zmiany uprawnień');
      req.flash(
        'error',
        !nameOk
          ? 'Wpisana nazwa użytkownika nie zgadza się z wybranym kontem - zmiana nie została wykonana.'
          : 'Hasło lub kod 2FA jest nieprawidłowy - zmiana nie została wykonana.'
      );
      return res.redirect(back);
    }
    roles.clearFailures(actor.id);

    if (newRole === 'admin') {
      await target.update({ role: 'admin', adminSince: new Date() });
    } else {
      // Odebranie uprawnień czyści też 2FA konta administratora - nie jest już potrzebne.
      await target.update({ role: 'user', adminSince: null, twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecovery: null });
    }

    await logAdminAction(req, 'user.role', 'user', target.username, `Nowa rola: ${newRole}`);

    // Wszyscy administratorzy oraz zainteresowany dowiadują się o zmianie.
    const verb = newRole === 'admin' ? 'nadał(a) uprawnienia administratora' : 'odebrał(a) uprawnienia administratora';
    const admins = await User.findAll({ where: { role: 'admin', id: { [Op.ne]: actor.id } }, attributes: ['id'] });
    const recipients = new Set(admins.map((a) => a.id));
    recipients.add(target.id);
    for (const userId of recipients) {
      await createNotification({
        userId,
        type: 'admin-role',
        actorId: actor.id,
        message: userId === target.id
          ? `${actor.username} ${verb} Twojemu kontu.`
          : `${actor.username} ${verb} użytkownikowi ${target.username}.`,
        link: userId === target.id && newRole === 'user' ? null : '/admin/users?filter=admin',
      });
    }

    req.flash('success', `Rola użytkownika ${target.username}: ${newRole === 'admin' ? 'administrator' : 'użytkownik'}.`);
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/ban', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target)) return;

    const reason = String(req.body.reason || '').trim().slice(0, 200) || null;
    const duration = status.findDuration(req.body.duration);
    const until = status.banUntil(req.body.duration);
    await target.update({ isBanned: true, banReason: reason, bannedUntil: until });
    await logAdminAction(
      req, 'user.ban', 'user', target.username,
      `${duration.label}${reason ? ` - ${reason}` : ''}`
    );
    req.flash(
      'success',
      until
        ? `Konto ${target.username} zostało zablokowane do ${status.formatUntil(until)}.`
        : `Konto ${target.username} zostało zablokowane bezterminowo.`
    );
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/unban', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target, { allowAdmin: true })) return;

    await target.update({ isBanned: false, banReason: null, bannedUntil: null });
    await logAdminAction(req, 'user.unban', 'user', target.username);
    req.flash('success', `Konto ${target.username} zostało odblokowane.`);
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/mute', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target)) return;

    const reason = String(req.body.reason || '').trim().slice(0, 200) || null;
    const duration = status.findDuration(req.body.duration);
    const until = status.muteUntil(req.body.duration);
    await target.update({ mutedUntil: until, muteReason: reason });
    await logAdminAction(req, 'user.mute', 'user', target.username, `${duration.label}${reason ? ` - ${reason}` : ''}`);

    await createNotification({
      userId: target.id,
      type: 'moderation',
      actorId: req.session.user.id,
      message: `Twoje konto zostało wyciszone ${duration.ms ? `do ${status.formatUntil(until)}` : 'bezterminowo'} - możesz czytać serwis, ale nie możesz pisać recenzji, komentarzy ani wiadomości.${reason ? ` Powód: ${reason}` : ''}`,
      link: null,
    });
    req.flash('success', `Konto ${target.username} zostało wyciszone (${duration.label.toLowerCase()}).`);
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/unmute', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target, { allowAdmin: true })) return;

    await target.update({ mutedUntil: null, muteReason: null });
    await logAdminAction(req, 'user.unmute', 'user', target.username);
    await createNotification({
      userId: target.id,
      type: 'moderation',
      actorId: req.session.user.id,
      message: 'Wyciszenie Twojego konta zostało zdjęte - możesz znowu pisać.',
      link: null,
    });
    req.flash('success', `Wyciszenie konta ${target.username} zostało zdjęte.`);
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/level', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!target) {
      req.flash('error', 'Nie znaleziono użytkownika.');
      return res.redirect(backTo(req, '/admin/users'));
    }

    const reset = req.body.level === 'reset';
    const level = Number(req.body.level);
    if (!reset && (!Number.isInteger(level) || level < 1 || level > 100)) {
      req.flash('error', 'Poziom musi być liczbą od 1 do 100.');
      return res.redirect(backTo(req, '/admin/users'));
    }

    const result = await setUserLevel(target.id, reset ? null : level);
    await logAdminAction(req, 'user.level', 'user', target.username, reset ? 'Reset poziomu' : `Poziom ${result.level}`);
    req.flash('success', `${target.username}: poziom ${result.level} (${result.points} PD).`);
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/unlock', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!target) {
      req.flash('error', 'Nie znaleziono użytkownika.');
      return res.redirect(backTo(req, '/admin/users'));
    }

    const unlockAll = req.body.value === '1';
    await target.update({ unlockAll });

    // Po cofnięciu odblokowania zdejmujemy ramkę, tło i trofeum, do których użytkownik nie ma już dostępu.
    if (!unlockAll) {
      const vm = await buildProfileViewModel(await findById(target.id));
      const lockedIds = new Set([...vm.allFrames, ...vm.allBackgrounds, ...vm.allBadges].filter((i) => i.locked).map((i) => i.id));
      const reset = {};
      if (lockedIds.has(target.activeFrame)) reset.activeFrame = 'frame-basic';
      if (lockedIds.has(target.activeBackground)) reset.activeBackground = 'bg-default';
      if (lockedIds.has(target.activeTrophy)) reset.activeTrophy = null;
      if (Object.keys(reset).length > 0) await target.update(reset);
    }
    await logAdminAction(req, 'user.unlock', 'user', target.username, unlockAll ? 'Odblokowano wszystko' : 'Cofnięto odblokowanie wszystkiego');
    req.flash(
      'success',
      unlockAll
        ? `${target.username} ma teraz odblokowane wszystkie ramki, tła i odznaki.`
        : `${target.username} wraca do odblokowań wynikających z poziomu i aktywności.`
    );
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/2fa-reset', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target, { allowAdmin: true })) return;

    // Wyłączenie 2FA osłabia konto, więc obowiązują te same zasady co przy odbieraniu uprawnień (okres próbny, starszeństwo).
    if (target.role === 'admin') {
      const rule = roles.evaluateRoleChange(await User.findByPk(req.session.user.id), target, 'user');
      if (!rule.ok) {
        req.flash('error', rule.reason);
        return res.redirect(backTo(req, '/admin/users'));
      }
    }

    await target.update({ twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecovery: null });
    await logAdminAction(req, 'user.2fa-reset', 'user', target.username, 'Wyłączono 2FA (np. zgubiony telefon)');
    req.flash('success', `Weryfikacja dwuetapowa dla ${target.username} została wyłączona.`);
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/delete', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target)) return;

    const username = target.username;
    await deleteUser(target.id);
    await logAdminAction(req, 'user.delete', 'user', username, 'Konto usunięte razem z aktywnością');
    req.flash('success', `Konto ${username} zostało usunięte razem z całą aktywnością.`);
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ recenzje ------------------------------ */

router.get('/reviews', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const rating = Number(req.query.rating);

    const where = {};
    if (q) where[Op.or] = [{ text: likeFilter(q) }, { username: likeFilter(q) }];
    if (rating >= 1 && rating <= 5) where.rating = { [Op.gte]: rating, [Op.lt]: rating + 1 };

    const total = await Review.count({ where });
    const { page, pages, offset, limit } = pageOf(req, total);
    const rows = await Review.findAll({ where, order: [['createdAt', 'DESC']], limit, offset });

    render(res, 'reviews', 'reviews', 'Recenzje', {
      reviews: await enrichReviews(rows.map((r) => r.get({ plain: true }))),
      q,
      rating: rating >= 1 && rating <= 5 ? rating : '',
      total,
      pager: buildPagerLinks(req, page, page < pages, pages),
      page,
      pages,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reviews/:id/delete', async (req, res, next) => {
  try {
    const review = await Review.findByPk(req.params.id);
    if (!review) {
      req.flash('error', 'Nie znaleziono recenzji.');
      return res.redirect(backTo(req, '/admin/reviews'));
    }

    const games = await getGamesByIds([review.gameId]);
    const game = games.get(String(review.gameId));
    await logAdminAction(req, 'review.delete', 'review', `${review.username}: ${game ? game.title : review.gameId}`, review.text.slice(0, 120));
    await removeReview(review);
    req.flash('success', 'Recenzja została usunięta.');
    res.redirect(backTo(req, '/admin/reviews'));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ zgłoszenia ------------------------------ */

const REPORT_TYPES = ['review', 'comment', 'user', 'message'];

router.get('/reports', async (req, res, next) => {
  try {
    const statusFilter = req.query.status === 'all' ? 'all' : 'pending';
    const type = REPORT_TYPES.includes(req.query.type) ? req.query.type : '';
    const where = statusFilter === 'pending' ? { status: 'pending' } : {};

    // Recenzje mają własną tabelę zgłoszeń, reszta (komentarze, użytkownicy, wiadomości) - wspólną.
    const [reviewRows, contentRows] = await Promise.all([
      type && type !== 'review'
        ? []
        : ReviewReport.findAll({ where, order: [['createdAt', 'DESC']], limit: 300 }),
      type === 'review'
        ? []
        : ContentReport.findAll({
          where: type ? { ...where, targetType: type } : where,
          order: [['createdAt', 'DESC']],
          limit: 300,
        }),
    ]);

    const merged = [
      ...reviewRows.map((r) => ({ ...r.get({ plain: true }), kind: 'review' })),
      ...contentRows.map((r) => ({ ...r.get({ plain: true }), kind: r.targetType })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = merged.length;
    const { page, pages, offset, limit } = pageOf(req, total);
    const rows = merged.slice(offset, offset + limit);

    const reviewIds = rows.filter((r) => r.kind === 'review').map((r) => r.reviewId);
    const reviews = reviewIds.length ? await Review.findAll({ where: { id: reviewIds } }) : [];
    const reporters = await User.findAll({
      where: { id: [...new Set(rows.map((r) => r.reporterId))] },
      attributes: ['id', 'username'],
    });
    const enriched = await enrichReviews(reviews.map((r) => r.get({ plain: true })));
    const reviewById = new Map(enriched.map((r) => [r.id, r]));
    const reporterById = new Map(reporters.map((u) => [u.id, u.username]));

    // Liczniki oczekujących zgłoszeń przy zakładkach rodzajów.
    const [pendingReview, ...pendingByType] = await Promise.all([
      ReviewReport.count({ where: { status: 'pending' } }),
      ...['comment', 'user', 'message'].map((t) => ContentReport.count({ where: { status: 'pending', targetType: t } })),
    ]);
    const typeCounts = { review: pendingReview, comment: pendingByType[0], user: pendingByType[1], message: pendingByType[2] };

    render(res, 'reports', 'reports', 'Zgłoszenia', {
      reports: rows.map((r) => ({
        ...r,
        review: r.kind === 'review' ? reviewById.get(r.reviewId) || null : null,
        reporterName: reporterById.get(r.reporterId) || 'usunięty użytkownik',
      })),
      status: statusFilter,
      type,
      typeCounts,
      typeLabels: TYPE_LABELS,
      durations: status.DURATIONS,
      total,
      pager: buildPagerLinks(req, page, page < pages, pages),
      page,
      pages,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reports/:id/delete-review', async (req, res, next) => {
  try {
    const report = await ReviewReport.findByPk(req.params.id);
    const review = report ? await Review.findByPk(report.reviewId) : null;
    if (!review) {
      req.flash('error', 'Nie znaleziono zgłoszonej recenzji (mogła zostać już usunięta).');
      return res.redirect(backTo(req, '/admin/reports'));
    }

    const note = String(req.body.reason || '').trim().slice(0, 300);
    const game = await getGameById(review.gameId);
    const gameLabel = game ? ` gry „${game.title}”` : '';

    // Zgłaszający i autor dowiadują się o decyzji - lista zgłaszających jest zbierana przed usunięciem.
    const reporterIds = (await ReviewReport.findAll({ where: { reviewId: review.id }, attributes: ['reporterId'] }))
      .map((r) => r.reporterId);

    await logAdminAction(req, 'report.delete-review', 'review', `${review.username}`, note || review.text.slice(0, 120));
    await removeReview(review); // usuwa też wszystkie zgłoszenia tej recenzji

    await createNotification({
      userId: review.userId,
      type: 'moderation',
      actorId: req.session.user.id,
      message: `Twoja recenzja${gameLabel} została usunięta przez moderatora${note ? `. Powód: ${note}` : '.'}`,
      link: game ? `/games/${game.id}` : null,
    });
    for (const reporterId of new Set(reporterIds)) {
      await createNotification({
        userId: reporterId,
        type: 'report-result',
        actorId: req.session.user.id,
        message: `Dziękujemy za zgłoszenie - recenzja${gameLabel} została usunięta.`,
        link: game ? `/games/${game.id}` : null,
      });
    }

    req.flash('success', 'Recenzja została usunięta, a zgłoszenia rozpatrzone.');
    res.redirect(backTo(req, '/admin/reports'));
  } catch (err) {
    next(err);
  }
});

router.post('/reports/:id/dismiss', async (req, res, next) => {
  try {
    const report = await ReviewReport.findByPk(req.params.id);
    if (!report) {
      req.flash('error', 'Nie znaleziono zgłoszenia.');
      return res.redirect(backTo(req, '/admin/reports'));
    }

    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (reason.length < 3) {
      req.flash('error', 'Podaj powód odrzucenia zgłoszenia (min. 3 znaki).');
      return res.redirect(backTo(req, '/admin/reports'));
    }

    await report.update({
      status: 'dismissed',
      resolution: reason,
      resolvedBy: req.session.user.username,
      resolvedAt: new Date(),
    });
    await logAdminAction(req, 'report.dismiss', 'report', report.id.slice(0, 8), reason);

    const review = await Review.findByPk(report.reviewId);
    const game = review ? await getGameById(review.gameId) : null;
    await createNotification({
      userId: report.reporterId,
      type: 'report-result',
      actorId: req.session.user.id,
      message: `Twoje zgłoszenie zostało odrzucone. Powód: ${reason}`,
      link: review && game ? `/games/${game.id}#review-${review.id}` : null,
    });

    req.flash('success', 'Zgłoszenie zostało odrzucone, a zgłaszający dostał uzasadnienie.');
    res.redirect(backTo(req, '/admin/reports'));
  } catch (err) {
    next(err);
  }
});

/* ----------- zgłoszenia komentarzy, użytkowników i wiadomości ----------- */

router.post('/reports/content/:id/dismiss', async (req, res, next) => {
  try {
    const report = await ContentReport.findByPk(req.params.id);
    if (!report) {
      req.flash('error', 'Nie znaleziono zgłoszenia.');
      return res.redirect(backTo(req, '/admin/reports'));
    }

    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (reason.length < 3) {
      req.flash('error', 'Podaj powód odrzucenia zgłoszenia (min. 3 znaki).');
      return res.redirect(backTo(req, '/admin/reports'));
    }

    await report.update({ status: 'dismissed', resolution: reason, resolvedBy: req.session.user.username, resolvedAt: new Date() });
    await logAdminAction(req, 'report.dismiss', 'report', `${report.targetType}:${report.id.slice(0, 8)}`, reason);
    await createNotification({
      userId: report.reporterId,
      type: 'report-result',
      actorId: req.session.user.id,
      message: `Twoje zgłoszenie zostało odrzucone. Powód: ${reason}`,
      link: null,
    });

    req.flash('success', 'Zgłoszenie zostało odrzucone, a zgłaszający dostał uzasadnienie.');
    res.redirect(backTo(req, '/admin/reports'));
  } catch (err) {
    next(err);
  }
});

const CONTENT_ACTIONS = {
  comment: ['delete-comment', 'mute', 'ban'],
  message: ['delete-message', 'mute', 'ban'],
  user: ['mute', 'ban'],
};

router.post('/reports/content/:id/resolve', async (req, res, next) => {
  try {
    const back = backTo(req, '/admin/reports');
    const report = await ContentReport.findByPk(req.params.id);
    if (!report || report.status !== 'pending') {
      req.flash('error', 'Nie znaleziono zgłoszenia albo zostało już rozpatrzone.');
      return res.redirect(back);
    }

    const action = String(req.body.action || '');
    if (!(CONTENT_ACTIONS[report.targetType] || []).includes(action)) {
      req.flash('error', 'Wybierz działanie.');
      return res.redirect(back);
    }

    const reason = String(req.body.reason || '').trim().slice(0, 200);
    const durationKey = req.body.duration;
    const target = report.targetUserId ? await User.findByPk(report.targetUserId) : null;
    let outcome;

    if (action === 'delete-comment') {
      const comment = await ReviewComment.findByPk(report.targetId);
      if (comment) {
        await CommentLike.destroy({ where: { commentId: comment.id } });
        await comment.destroy();
      }
      outcome = 'Usunięto komentarz';
      if (target) {
        await createNotification({
          userId: target.id, type: 'moderation', actorId: req.session.user.id,
          message: `Twój komentarz został usunięty przez moderatora${reason ? `. Powód: ${reason}` : '.'}`, link: null,
        });
      }
    } else if (action === 'delete-message') {
      const message = await Message.findByPk(report.targetId);
      if (message) await message.destroy();
      outcome = 'Usunięto wiadomość';
      if (target) {
        await createNotification({
          userId: target.id, type: 'moderation', actorId: req.session.user.id,
          message: `Twoja wiadomość na czacie została usunięta przez moderatora${reason ? `. Powód: ${reason}` : '.'}`, link: null,
        });
      }
    } else {
      // Wyciszenie albo blokada autora - nie dotyczą administratorów ani własnego konta.
      if (!target) {
        req.flash('error', 'Konto autora już nie istnieje.');
        return res.redirect(back);
      }
      if (target.id === req.session.user.id) {
        req.flash('error', 'Tej operacji nie możesz wykonać na własnym koncie.');
        return res.redirect(back);
      }
      if (target.role === 'admin') {
        req.flash('error', 'Najpierw odbierz temu użytkownikowi uprawnienia administratora.');
        return res.redirect(back);
      }

      const duration = status.findDuration(durationKey);
      if (action === 'ban') {
        await target.update({ isBanned: true, banReason: reason || null, bannedUntil: status.banUntil(durationKey) });
        outcome = `Zablokowano konto (${duration.label.toLowerCase()})`;
      } else {
        const until = status.muteUntil(durationKey);
        await target.update({ mutedUntil: until, muteReason: reason || null });
        await createNotification({
          userId: target.id, type: 'moderation', actorId: req.session.user.id,
          message: `Twoje konto zostało wyciszone ${duration.ms ? `do ${status.formatUntil(until)}` : 'bezterminowo'}.${reason ? ` Powód: ${reason}` : ''}`, link: null,
        });
        outcome = `Wyciszono konto (${duration.label.toLowerCase()})`;
      }
    }

    // Ta sama treść mogła zostać zgłoszona przez kilka osób - wszystkie zgłoszenia zamykamy razem.
    const related = await ContentReport.findAll({
      where: { targetType: report.targetType, targetId: report.targetId, status: 'pending' },
    });
    for (const item of related) {
      await item.update({
        status: 'reviewed',
        resolution: `${outcome}${reason ? `. ${reason}` : ''}`.slice(0, 300),
        resolvedBy: req.session.user.username,
        resolvedAt: new Date(),
      });
      await createNotification({
        userId: item.reporterId, type: 'report-result', actorId: req.session.user.id,
        message: 'Dziękujemy za zgłoszenie - moderator podjął działania wobec zgłoszonej treści.', link: null,
      });
    }

    await logAdminAction(req, 'report.resolve', 'report', `${report.targetType}: ${report.targetUsername || report.targetId}`, `${outcome}${reason ? ` - ${reason}` : ''}`);
    req.flash('success', `${outcome}. Zgłoszenia rozpatrzone (${related.length}).`);
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ komentarze ------------------------------ */

router.get('/comments', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = q ? { [Op.or]: [{ text: likeFilter(q) }, { username: likeFilter(q) }] } : {};

    const total = await ReviewComment.count({ where });
    const { page, pages, offset, limit } = pageOf(req, total);
    const rows = (await ReviewComment.findAll({ where, order: [['createdAt', 'DESC']], limit, offset }))
      .map((c) => c.get({ plain: true }));

    const reviews = await Review.findAll({ where: { id: rows.map((c) => c.reviewId) }, attributes: ['id', 'gameId'] });
    const gameByReview = new Map(reviews.map((r) => [r.id, r.gameId]));

    render(res, 'comments', 'comments', 'Komentarze', {
      comments: rows.map((c) => ({ ...c, gameId: gameByReview.get(c.reviewId) || null })),
      q,
      total,
      pager: buildPagerLinks(req, page, page < pages, pages),
      page,
      pages,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/comments/:id/delete', async (req, res, next) => {
  try {
    const comment = await ReviewComment.findByPk(req.params.id);
    if (!comment) {
      req.flash('error', 'Nie znaleziono komentarza.');
      return res.redirect(backTo(req, '/admin/comments'));
    }
    await logAdminAction(req, 'comment.delete', 'comment', comment.username, comment.text.slice(0, 120));
    await CommentLike.destroy({ where: { commentId: comment.id } });
    await comment.destroy();
    req.flash('success', 'Komentarz został usunięty.');
    res.redirect(backTo(req, '/admin/comments'));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ gry dodane ręcznie ------------------------------ */

router.get('/games', async (req, res, next) => {
  try {
    const games = (await CustomGame.findAll({ order: [['createdAt', 'DESC']] })).map((g) => g.get({ plain: true }));

    const counts = await Review.findAll({
      attributes: ['gameId', [fn('COUNT', col('id')), 'total']],
      where: { gameId: games.map((g) => g.id) },
      group: ['gameId'],
      raw: true,
    });
    const reviewCounts = new Map(counts.map((c) => [c.gameId, Number(c.total)]));

    render(res, 'games', 'games', 'Gry', {
      games: games.map((g) => ({ ...g, reviewCount: reviewCounts.get(g.id) || 0 })),
    });
  } catch (err) {
    next(err);
  }
});

/* ---- formularz gry: okładka wgrywana jako plik, platformy i rok do wyboru ---- */

const GAME_COVER_DIR = path.join(__dirname, '..', 'public', 'images', 'games', 'uploads');
const GAME_COVER_URL = '/images/games/uploads/';
const COVER_PLACEHOLDER = '/images/game-placeholder.svg';
fs.mkdirSync(GAME_COVER_DIR, { recursive: true });

const gameCoverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    // Pole _csrf jest w formularzu przed plikiem - zły token nie zapisuje niczego.
    if (!checkUploadToken(req)) return cb(new Error('csrf'));
    cb(null, true);
  },
}).single('cover');

function removeStoredGameCover(coverImage) {
  if (coverImage && String(coverImage).startsWith(GAME_COVER_URL)) {
    fs.unlink(path.join(GAME_COVER_DIR, path.basename(coverImage)), () => {});
  }
}

/** Wgrywa okładkę (sprawdzenie sygnatury, zmniejszenie, WebP); błąd zapamiętuje do wyświetlenia w formularzu. */
function handleGameCover(req, res, next) {
  gameCoverUpload(req, res, async (err) => {
    req.body = req.body || {};
    if (err && err.message === 'csrf') return rejectCsrf(req, res);
    if (!err && !csrfValid(req)) return verifyAfterUpload(req, res, () => {});

    if (err) {
      req.coverError = err.code === 'LIMIT_FILE_SIZE' ? 'Okładka jest za duża (maksymalnie 3 MB).' : 'Nie udało się wgrać okładki.';
    } else if (req.file) {
      try {
        const image = await sanitizeImage(req.file.buffer, { maxSize: 900 });
        req.file.filename = `${uuidv4()}${image.ext}`;
        await fs.promises.writeFile(path.join(GAME_COVER_DIR, req.file.filename), image.buffer);
      } catch (imageError) {
        req.coverError = imageError.userFacing ? imageError.message : 'Nie udało się przetworzyć okładki.';
        req.file = undefined;
      }
    }
    next();
  });
}

async function renderGameForm(res, { existing, formData = {}, error = null, status = 200 }) {
  const game = existing ? existing.get({ plain: true }) : null;
  res.status(status);
  render(res, 'game-form', 'games', existing ? 'Edytuj grę' : 'Dodaj grę', {
    game,
    formData,
    formError: error,
    genres: await gameForm.genreOptions(),
    platformChoices: gameForm.PLATFORM_CHOICES,
    years: gameForm.yearOptions(),
    selectedPlatforms: formData.platforms !== undefined
      ? gameForm.parsePlatforms(formData.platforms)
      : gameForm.splitStoredPlatforms(game && game.platform),
  });
}

router.get('/games/new', async (req, res, next) => {
  try {
    await renderGameForm(res, { existing: null, formData: {} });
  } catch (err) {
    next(err);
  }
});

// Podpowiedzi z IGDB do formularza: po wpisaniu tytułu zwraca platformy, rok, kategorię, opis i okładkę.
router.get('/games/lookup', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
    return res.json({ ok: false, reason: 'no-keys', results: [] });
  }
  try {
    res.json({ ok: true, results: await gameLookup.searchGames(req.query.q) });
  } catch (err) {
    console.error('[ADMIN] BŁĄD: wyszukiwanie gry w IGDB nie powiodło się:', err.message);
    res.json({ ok: false, reason: 'error', results: [] });
  }
});

/** Pobiera okładkę z IGDB, sprawdza ją i zapisuje lokalnie jako WebP. Zwraca nazwę pliku. */
async function storeIgdbCover(imageId) {
  const image = await sanitizeImage(await gameLookup.downloadCover(imageId), { maxSize: 900 });
  const filename = `${uuidv4()}${image.ext}`;
  await fs.promises.writeFile(path.join(GAME_COVER_DIR, filename), image.buffer);
  return filename;
}

async function saveGame(req, res, next, existing) {
  try {
    const { title, description, releaseYear } = req.body;
    const category = String(req.body.category === '__other' ? req.body.categoryOther : req.body.category || '').trim();
    const platforms = gameForm.parsePlatforms(req.body.platforms);
    const year = parseInt(releaseYear, 10);

    let error = req.coverError || null;
    if (!error && !String(title || '').trim()) error = 'Podaj tytuł gry.';
    if (!error && !category) error = 'Wybierz kategorię.';
    if (!error && platforms.length === 0) error = 'Zaznacz co najmniej jedną platformę.';
    if (!error && !(year >= gameForm.MIN_YEAR && year <= new Date().getFullYear() + 2)) error = 'Wybierz rok wydania.';
    if (!error && String(description || '').trim().length < 10) error = 'Opis powinien mieć co najmniej 10 znaków.';

    if (error) {
      if (req.file) removeStoredGameCover(`${GAME_COVER_URL}${req.file.filename}`);
      return renderGameForm(res, { existing, formData: req.body, error, status: 400 });
    }

    // Okładka wybrana z podpowiedzi IGDB (własny plik ma pierwszeństwo).
    let igdbCover = null;
    if (!req.file && req.body.removeCover !== '1' && gameLookup.isValidCoverId(req.body.coverIgdbId)) {
      try {
        igdbCover = await storeIgdbCover(req.body.coverIgdbId);
      } catch (coverErr) {
        console.error('[ADMIN] BŁĄD: nie udało się pobrać okładki z IGDB:', coverErr.message);
        return renderGameForm(res, {
          existing,
          formData: req.body,
          error: 'Nie udało się pobrać okładki z IGDB. Spróbuj ponownie albo wgraj własny plik.',
          status: 502,
        });
      }
    }

    // Okładka: nowy plik > okładka z IGDB > zaznaczone "usuń" > dotychczasowa (przy dodawaniu brak = obrazek zastępczy).
    let coverImage = existing ? existing.coverImage : COVER_PLACEHOLDER;
    if (req.file) coverImage = `${GAME_COVER_URL}${req.file.filename}`;
    else if (igdbCover) coverImage = `${GAME_COVER_URL}${igdbCover}`;
    else if (req.body.removeCover === '1') coverImage = COVER_PLACEHOLDER;
    if (existing && coverImage !== existing.coverImage) removeStoredGameCover(existing.coverImage);

    const data = {
      title: String(title).trim(),
      category: category.slice(0, 60),
      platform: platforms.join(', '),
      releaseYear: year,
      coverImage: coverImage || COVER_PLACEHOLDER,
      description: String(description).trim(),
    };

    if (existing) {
      await existing.update(data);
      await logAdminAction(req, 'game.edit', 'game', data.title);
      req.flash('success', `Zapisano zmiany w grze „${data.title}”.`);
    } else {
      await CustomGame.create(data);
      await logAdminAction(req, 'game.create', 'game', data.title);
      req.flash('success', `Dodano grę „${data.title}”.`);
    }
    res.redirect('/admin/games');
  } catch (err) {
    next(err);
  }
}

router.post('/games/new', handleGameCover, (req, res, next) => saveGame(req, res, next, null));

router.get('/games/:id/edit', async (req, res, next) => {
  try {
    const game = await CustomGame.findByPk(req.params.id);
    if (!game) return next();
    await renderGameForm(res, { existing: game, formData: {} });
  } catch (err) {
    next(err);
  }
});

router.post('/games/:id/edit', handleGameCover, async (req, res, next) => {
  const game = await CustomGame.findByPk(req.params.id);
  if (!game) return next();
  saveGame(req, res, next, game);
});

router.post('/games/:id/delete', async (req, res, next) => {
  try {
    const game = await CustomGame.findByPk(req.params.id);
    if (!game) {
      req.flash('error', 'Nie znaleziono gry.');
      return res.redirect('/admin/games');
    }

    // Recenzje usuwanej gry nie miałyby już do czego się odnosić - usuwamy je razem z grą.
    const reviews = await Review.findAll({ where: { gameId: game.id } });
    for (const review of reviews) await removeReview(review);

    await logAdminAction(req, 'game.delete', 'game', game.title, `Usunięto też ${reviews.length} recenzji`);
    removeStoredGameCover(game.coverImage);
    await game.destroy();
    req.flash('success', `Gra „${game.title}” została usunięta (razem z ${reviews.length} recenzjami).`);
    res.redirect('/admin/games');
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ blog ------------------------------ */

router.get('/blog', (req, res) => {
  render(res, 'blog', 'blog', 'Blog', { posts: getBlogPosts() });
});

router.post('/blog/:id/delete', async (req, res) => {
  const post = removeBlogPost(req.params.id);
  if (!post) {
    req.flash('error', 'Nie znaleziono wpisu.');
    return res.redirect('/admin/blog');
  }
  await logAdminAction(req, 'blog.delete', 'blog', post.title);
  req.flash('success', 'Wpis został usunięty.');
  res.redirect('/admin/blog');
});

/* ------------------------------ czat (moderacja) ------------------------------ */

router.get('/chat', async (req, res, next) => {
  try {
    const total = await Conversation.count();
    const { page, pages, offset, limit } = pageOf(req, total);
    const rows = (await Conversation.findAll({ order: [['createdAt', 'DESC']], limit, offset }))
      .map((c) => c.get({ plain: true }));

    const counts = await Message.findAll({
      attributes: ['conversationId', [fn('COUNT', col('id')), 'total']],
      where: { conversationId: rows.map((c) => c.id) },
      group: ['conversationId'],
      raw: true,
    });
    const messageCounts = new Map(counts.map((c) => [c.conversationId, Number(c.total)]));

    render(res, 'chat', 'chat', 'Czat', {
      conversations: rows.map((c) => {
        const names = Object.values(JSON.parse(c.memberNames || '{}'));
        return {
          ...c,
          label: c.type === 'dm' ? names.join(' i ') || 'Rozmowa prywatna' : c.name,
          memberList: names,
          messageCount: messageCounts.get(c.id) || 0,
        };
      }),
      total,
      pager: buildPagerLinks(req, page, page < pages, pages),
      page,
      pages,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/chat/:id/clear', async (req, res, next) => {
  try {
    await clearMessages(req.params.id);
    await logAdminAction(req, 'chat.clear', 'conversation', req.params.id.slice(0, 8));
    req.flash('success', 'Wiadomości w rozmowie zostały wyczyszczone.');
    res.redirect(backTo(req, '/admin/chat'));
  } catch (err) {
    next(err);
  }
});

router.post('/chat/:id/delete', async (req, res, next) => {
  try {
    await deleteConversation(req.params.id);
    await logAdminAction(req, 'chat.delete', 'conversation', req.params.id.slice(0, 8));
    req.flash('success', 'Rozmowa została usunięta.');
    res.redirect(backTo(req, '/admin/chat'));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ dziennik działań ------------------------------ */

router.get('/log', async (req, res, next) => {
  try {
    const total = await AdminLog.count();
    const { page, pages, offset, limit } = pageOf(req, total, 25);
    const entries = (await AdminLog.findAll({ order: [['createdAt', 'DESC']], limit, offset }))
      .map((e) => e.get({ plain: true }));

    render(res, 'log', 'log', 'Dziennik działań', {
      entries,
      total,
      pager: buildPagerLinks(req, page, page < pages, pages),
      page,
      pages,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ propozycje funkcji ------------------------------ */

router.get('/ideas', async (req, res, next) => {
  try {
    const all = await loadAllIdeas();
    const adminCount = await User.count({ where: { role: 'admin' } });

    const counts = {
      all: all.length,
      pending: all.filter((i) => !i.decision).length,
      security: all.filter((i) => i.area === 'security').length,
      usability: all.filter((i) => i.area === 'usability').length,
      accepted: all.filter((i) => i.decision === 'accepted').length,
      done: all.filter((i) => i.decision === 'done').length,
      later: all.filter((i) => i.decision === 'later').length,
      rejected: all.filter((i) => i.decision === 'rejected').length,
    };

    const allowed = ['pending', 'security', 'usability', 'accepted', 'done', 'later', 'rejected'];
    const filter = allowed.includes(req.query.filter) ? req.query.filter : '';
    const ideas = all
      .filter((idea) => {
        if (!filter) return true;
        if (filter === 'pending') return !idea.decision;
        if (filter === 'security' || filter === 'usability') return idea.area === filter;
        return idea.decision === filter;
      })
      // Zrealizowane lądują na końcu listy; reszta w kolejności: czeka na decyzję, przyjęte, odłożone, odrzucone.
      .sort((a, b) => IDEA_ORDER[a.decision || 'pending'] - IDEA_ORDER[b.decision || 'pending'])
      // Własną propozycję rozpatrują inni administratorzy - o ile są (przy jednym adminie decyduje on sam).
      .map((idea) => ({
        ...idea,
        mine: !!idea.custom && idea.authorId === req.session.user.id,
        canDecide: !(idea.custom && idea.authorId === req.session.user.id && adminCount > 1),
      }));

    render(res, 'ideas', 'ideas', 'Propozycje funkcji', {
      ideas,
      filter,
      counts,
      areas: AREAS,
      decisions: DECISIONS,
      efforts: IDEA_EFFORTS,
      impacts: IDEA_IMPACTS,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/ideas', async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 120);
    const description = String(req.body.description || '').trim().slice(0, 800);
    const area = AREAS[req.body.area] ? req.body.area : 'usability';
    const effort = IDEA_EFFORTS.includes(req.body.effort) ? req.body.effort : 'średni';
    const impact = IDEA_IMPACTS.includes(req.body.impact) ? req.body.impact : 'średni';

    if (title.length < 5 || description.length < 15) {
      req.flash('error', 'Podaj tytuł (min. 5 znaków) i opis propozycji (min. 15 znaków).');
      return res.redirect('/admin/ideas');
    }

    const idea = await AdminIdea.create({
      title,
      description,
      area,
      effort,
      impact,
      authorId: req.session.user.id,
      authorName: req.session.user.username,
    });
    await logAdminAction(req, 'idea.create', 'idea', title, `${AREAS[area].label}, nakład: ${effort}, korzyść: ${impact}`);

    // Pozostali administratorzy dostają powiadomienie z prośbą o decyzję.
    const others = await User.findAll({
      where: { role: 'admin', id: { [Op.ne]: req.session.user.id } },
      attributes: ['id'],
    });
    for (const other of others) {
      await createNotification({
        userId: other.id,
        type: 'admin-idea',
        actorId: req.session.user.id,
        message: `${req.session.user.username} proponuje nową funkcję: „${title}”. Czeka na Twoją decyzję.`,
        link: '/admin/ideas?filter=pending',
      });
    }

    req.flash(
      'success',
      others.length > 0
        ? `Propozycja „${idea.title}” została dodana - inni administratorzy dostali powiadomienie.`
        : `Propozycja „${idea.title}” została dodana.`
    );
    res.redirect('/admin/ideas');
  } catch (err) {
    next(err);
  }
});

router.post('/ideas/:id/delete', async (req, res, next) => {
  try {
    const row = await AdminIdea.findByPk(req.params.id);
    if (!row) {
      req.flash('error', 'Nie znaleziono propozycji.');
      return res.redirect('/admin/ideas');
    }
    if (row.authorId !== req.session.user.id) {
      req.flash('error', 'Propozycję może usunąć tylko jej autor.');
      return res.redirect('/admin/ideas');
    }

    await setSetting(`idea:${row.id}`, '');
    await row.destroy();
    await logAdminAction(req, 'idea.delete', 'idea', row.title);
    req.flash('success', 'Propozycja została usunięta.');
    res.redirect('/admin/ideas');
  } catch (err) {
    next(err);
  }
});

router.post('/ideas/:id', async (req, res, next) => {
  try {
    const idea = await findAnyIdea(req.params.id);
    if (!idea) {
      req.flash('error', 'Nie znaleziono propozycji.');
      return res.redirect('/admin/ideas');
    }

    if (idea.custom && idea.authorId === req.session.user.id && (await User.count({ where: { role: 'admin' } })) > 1) {
      req.flash('error', 'Własną propozycję rozpatrują inni administratorzy.');
      return res.redirect(backTo(req, '/admin/ideas'));
    }

    const decision = req.body.decision;
    if (decision === 'reset') {
      await setSetting(`idea:${idea.id}`, '');
      await logAdminAction(req, 'idea.reset', 'idea', idea.title, 'Cofnięto decyzję');
      req.flash('success', `Propozycja „${idea.title}” wraca do rozpatrzenia.`);
    } else if (DECISIONS[decision]) {
      await setSetting(`idea:${idea.id}`, decision);
      await logAdminAction(req, 'idea.decide', 'idea', idea.title, DECISIONS[decision].label);
      req.flash('success', `„${idea.title}”: ${DECISIONS[decision].label.toLowerCase()}.`);
    } else {
      req.flash('error', 'Nieznana decyzja.');
    }
    res.redirect(backTo(req, '/admin/ideas'));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ dane: eksport CSV i kopie zapasowe ------------------------------ */

router.get('/data', (req, res) => {
  render(res, 'data', 'data', 'Dane i kopie zapasowe', {
    exportsList: Object.entries(backup.EXPORTS).map(([key, spec]) => ({
      key,
      label: spec.label,
      description: spec.description,
    })),
    canBackupSqlite: backup.canBackupSqliteFile(),
  });
});

router.get('/export/:kind.csv', async (req, res, next) => {
  try {
    const result = await backup.buildCsvExport(req.params.kind);
    if (!result) return next();

    await logAdminAction(req, 'data.export', 'data', req.params.kind, `Wiersze: ${result.count}`);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (err) {
    next(err);
  }
});

router.post('/backup/json', async (req, res, next) => {
  try {
    const result = await backup.buildJsonBackup();
    const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
    await logAdminAction(req, 'data.backup', 'data', 'JSON', `Tabel: ${Object.keys(result.counts).length}, rekordów: ${total}`);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (err) {
    next(err);
  }
});

router.post('/backup/sqlite', async (req, res, next) => {
  try {
    if (!backup.canBackupSqliteFile()) {
      req.flash('error', 'Kopia pliku bazy jest dostępna tylko dla SQLite (środowisko developerskie).');
      return res.redirect('/admin/data');
    }

    const result = await backup.buildSqliteBackup();
    await logAdminAction(req, 'data.backup', 'data', 'SQLite', result.filename);
    res.download(result.filePath, result.filename, () => backup.removeFile(result.filePath));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ ustawienia ------------------------------ */

router.get('/settings', async (req, res, next) => {
  try {
    const [enabled, text, type] = await Promise.all([
      getSetting('announcement_enabled', '0'),
      getSetting('announcement_text', ''),
      getSetting('announcement_type', 'info'),
    ]);
    render(res, 'settings', 'settings', 'Ustawienia', {
      announcementForm: { enabled: enabled === '1', text, type },
      moderation: getModeration(),
      maxExtraWords: MAX_EXTRA_WORDS_LENGTH,
      rules: getRules(),
      rateStats: getRateLimitStats(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/settings/announcement', async (req, res, next) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, 300);
    const type = ['info', 'warning'].includes(req.body.type) ? req.body.type : 'info';
    const enabled = req.body.enabled === '1' && text ? '1' : '0';

    await Promise.all([
      setSetting('announcement_text', text),
      setSetting('announcement_type', type),
      setSetting('announcement_enabled', enabled),
    ]);
    await logAdminAction(req, 'settings.announcement', 'settings', enabled === '1' ? 'włączone' : 'wyłączone', text);
    req.flash('success', enabled === '1' ? 'Ogłoszenie zostało opublikowane.' : 'Ogłoszenie jest wyłączone.');
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
});

router.post('/settings/moderation', async (req, res, next) => {
  try {
    const profanityMode = PROFANITY_MODES.includes(req.body.profanityMode) ? req.body.profanityMode : 'mask';
    const patch = {
      rateLimitEnabled: req.body.rateLimitEnabled === '1',
      antispamEnabled: req.body.antispamEnabled === '1',
      profanityMode,
      profanityWords: String(req.body.profanityWords || '').trim(),
    };

    await saveModeration(patch);
    await logAdminAction(
      req,
      'settings.moderation',
      'settings',
      `wulgaryzmy: ${profanityMode}`,
      `limity: ${patch.rateLimitEnabled ? 'wł.' : 'wył.'}, antyspam: ${patch.antispamEnabled ? 'wł.' : 'wył.'}`
    );
    req.flash('success', 'Ustawienia moderacji zostały zapisane.');
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
});

router.post('/settings/security', async (req, res, next) => {
  try {
    const require2fa = req.body.require2fa === '1';

    // Żeby nie odciąć samego siebie od panelu: wymóg można włączyć dopiero z własnym 2FA.
    if (require2fa && !res.locals.adminHasTwoFactor) {
      req.flash('error', 'Najpierw włącz 2FA na własnym koncie (Edytuj profil -> Konto i bezpieczeństwo).');
      return res.redirect('/admin/settings');
    }

    await saveModeration({ require2fa });
    await logAdminAction(req, 'settings.security', 'settings', require2fa ? 'wymagane 2FA' : '2FA opcjonalne');
    req.flash('success', require2fa ? 'Od teraz administratorzy muszą mieć włączone 2FA.' : 'Wymóg 2FA został wyłączony.');
    res.redirect('/admin/settings');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
