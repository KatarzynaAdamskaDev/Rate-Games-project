const express = require('express');
const { Op, fn, col } = require('sequelize');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Review = require('../models/Review');
const ReviewComment = require('../models/ReviewComment');
const CommentLike = require('../models/CommentLike');
const ReviewReport = require('../models/ReviewReport');
const CustomGame = require('../models/CustomGame');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AdminLog = require('../models/AdminLog');

const { readCollection, writeCollection } = require('../utils/dataStore');
const { deleteUser } = require('../utils/profileHelpers');
const { deleteReviewData } = require('../utils/reviewSocialHelpers');
const { syncUserProgress, setUserLevel } = require('../utils/progressHelpers');
const { clearMessages, deleteConversation } = require('../utils/chatHelpers');
const { getGamesByIds } = require('../utils/gameCatalog');
const { enrichReviews } = require('../utils/reviewStatsHelpers');
const { buildPagerLinks } = require('../utils/gameListing');
const {
  logAdminAction,
  getSetting,
  setSetting,
  getDashboardStats,
} = require('../utils/adminHelpers');

const PAGE_SIZE = 15;

router.use(ensureAuthenticated, ensureAdmin);

// Liczba oczekujących zgłoszeń - plakietka w menu bocznym panelu.
router.use(async (req, res, next) => {
  try {
    res.locals.pendingReportsCount = await ReviewReport.count({ where: { status: 'pending' } });
    next();
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ narzędzia ------------------------------ */

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
    const filter = ['admin', 'banned'].includes(req.query.filter) ? req.query.filter : '';

    const where = {};
    if (q) where[Op.or] = [{ username: likeFilter(q) }, { email: likeFilter(q) }];
    if (filter === 'admin') where.role = 'admin';
    if (filter === 'banned') where.isBanned = true;

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

    render(res, 'users', 'users', 'Użytkownicy', {
      users: rows.map((u) => ({ ...u.get({ plain: true }), reviewCount: reviewCounts.get(u.id) || 0 })),
      q,
      filter,
      total,
      pager: buildPagerLinks(req, page, page < pages),
      page,
      pages,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/role', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target, { allowAdmin: true })) return;

    const role = req.body.role === 'admin' ? 'admin' : 'user';
    await target.update({ role });
    await logAdminAction(req, 'user.role', 'user', target.username, `Nowa rola: ${role}`);
    req.flash('success', `Rola użytkownika ${target.username}: ${role === 'admin' ? 'administrator' : 'użytkownik'}.`);
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/ban', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target)) return;

    const reason = String(req.body.reason || '').trim().slice(0, 200) || null;
    await target.update({ isBanned: true, banReason: reason });
    await logAdminAction(req, 'user.ban', 'user', target.username, reason || 'bez podanego powodu');
    req.flash('success', `Konto ${target.username} zostało zablokowane.`);
    res.redirect(backTo(req, '/admin/users'));
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/unban', async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!guardTarget(req, res, target, { allowAdmin: true })) return;

    await target.update({ isBanned: false, banReason: null });
    await logAdminAction(req, 'user.unban', 'user', target.username);
    req.flash('success', `Konto ${target.username} zostało odblokowane.`);
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
      pager: buildPagerLinks(req, page, page < pages),
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

router.get('/reports', async (req, res, next) => {
  try {
    const status = req.query.status === 'all' ? 'all' : 'pending';
    const where = status === 'pending' ? { status: 'pending' } : {};

    const total = await ReviewReport.count({ where });
    const { page, pages, offset, limit } = pageOf(req, total);
    const rows = (await ReviewReport.findAll({ where, order: [['createdAt', 'DESC']], limit, offset }))
      .map((r) => r.get({ plain: true }));

    const reviews = await Review.findAll({ where: { id: rows.map((r) => r.reviewId) } });
    const reporters = await User.findAll({
      where: { id: rows.map((r) => r.reporterId) },
      attributes: ['id', 'username'],
    });
    const enriched = await enrichReviews(reviews.map((r) => r.get({ plain: true })));
    const reviewById = new Map(enriched.map((r) => [r.id, r]));
    const reporterById = new Map(reporters.map((u) => [u.id, u.username]));

    render(res, 'reports', 'reports', 'Zgłoszenia', {
      reports: rows.map((r) => ({
        ...r,
        review: reviewById.get(r.reviewId) || null,
        reporterName: reporterById.get(r.reporterId) || 'usunięty użytkownik',
      })),
      status,
      total,
      pager: buildPagerLinks(req, page, page < pages),
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

    await logAdminAction(req, 'report.delete-review', 'review', `${review.username}`, review.text.slice(0, 120));
    await removeReview(review); // usuwa też wszystkie zgłoszenia tej recenzji
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
    await report.update({ status: 'dismissed' });
    await logAdminAction(req, 'report.dismiss', 'report', report.id.slice(0, 8));
    req.flash('success', 'Zgłoszenie zostało odrzucone.');
    res.redirect(backTo(req, '/admin/reports'));
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
      pager: buildPagerLinks(req, page, page < pages),
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

router.get('/games/new', (req, res) => {
  render(res, 'game-form', 'games', 'Dodaj grę', { game: null, formData: {} });
});

async function saveGame(req, res, next, existing) {
  try {
    const { title, category, platform, releaseYear, coverImage, description } = req.body;
    if (!title || !category || !description) {
      req.flash('error', 'Tytuł, kategoria i opis są wymagane.');
      return res.status(400).render('admin/game-form', {
        title: 'Panel admina - gra',
        active: 'games',
        pageTitle: existing ? 'Edytuj grę' : 'Dodaj grę',
        game: existing ? existing.get({ plain: true }) : null,
        formData: req.body,
      });
    }

    const data = {
      title: title.trim(),
      category: category.trim(),
      platform: (platform || 'PC').trim(),
      releaseYear: Number(releaseYear) || new Date().getFullYear(),
      coverImage: (coverImage || '').trim() || '/images/game-placeholder.svg',
      description: description.trim(),
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

router.post('/games/new', (req, res, next) => saveGame(req, res, next, null));

router.get('/games/:id/edit', async (req, res, next) => {
  try {
    const game = await CustomGame.findByPk(req.params.id);
    if (!game) return next();
    render(res, 'game-form', 'games', 'Edytuj grę', { game: game.get({ plain: true }), formData: {} });
  } catch (err) {
    next(err);
  }
});

router.post('/games/:id/edit', async (req, res, next) => {
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
    await game.destroy();
    req.flash('success', `Gra „${game.title}” została usunięta (razem z ${reviews.length} recenzjami).`);
    res.redirect('/admin/games');
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ blog ------------------------------ */

router.get('/blog', (req, res) => {
  const posts = readCollection('blog').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  render(res, 'blog', 'blog', 'Blog', { posts });
});

router.post('/blog/:id/delete', async (req, res) => {
  const posts = readCollection('blog');
  const post = posts.find((p) => p.id === req.params.id);
  if (!post) {
    req.flash('error', 'Nie znaleziono wpisu.');
    return res.redirect('/admin/blog');
  }
  writeCollection('blog', posts.filter((p) => p.id !== post.id));
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
      pager: buildPagerLinks(req, page, page < pages),
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
      pager: buildPagerLinks(req, page, page < pages),
      page,
      pages,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ ustawienia (ogłoszenie) ------------------------------ */

router.get('/settings', async (req, res, next) => {
  try {
    const [enabled, text, type] = await Promise.all([
      getSetting('announcement_enabled', '0'),
      getSetting('announcement_text', ''),
      getSetting('announcement_type', 'info'),
    ]);
    render(res, 'settings', 'settings', 'Ogłoszenie serwisowe', {
      announcementForm: { enabled: enabled === '1', text, type },
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

module.exports = router;
