const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const { blockIfMuted } = require('../middleware/muted');
const { limiters } = require('../middleware/rateLimit');
const { buildPagerLinks } = require('../utils/gameListing');
const { logAdminAction } = require('../utils/adminHelpers');
const { sanitizeImage } = require('../utils/imageSafety');
const { moderateText } = require('../utils/contentFilter');
const { createNotification } = require('../utils/notificationHelpers');
const { REASONS_BY_TYPE, MAX_COMMENT_LENGTH: MAX_REPORT_COMMENT } = require('../utils/reportReasons');
const { plainText, isoDate, breadcrumbLd } = require('../utils/seo');
const { generateBlogCover } = require('../utils/blogCoverGenerator');
const assistant = require('../utils/seoAssistant');
const { getPopularPool } = require('../utils/gamePopularity');
const { getGamesByIds } = require('../utils/gameCatalog');
const { withRatings } = require('../utils/gameHelpers');
const media = require('../utils/blogMedia');
const CustomGame = require('../models/CustomGame');
const { resetSitemapCache } = require('./seo');
const User = require('../models/User');
const { checkUploadToken, verifyAfterUpload, reject, isValid } = require('../middleware/csrf');
const {
  MAX_COMMENT_LENGTH,
  getCommentsForPost,
  countCommentsForPosts,
  addComment,
  deleteComment,
  deleteCommentsForPost,
} = require('../utils/blogCommentHelpers');
const {
  CATEGORIES,
  DEFAULT_CATEGORY,
  COVER_PLACEHOLDER,
  UPLOAD_DIR,
  UPLOAD_URL_PREFIX,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  parseTags,
  tagKey,
  countTags,
  getPosts,
  getAllPosts,
  findPost,
  savePost,
  removePost,
  removeUploadedCover,
  renderContent,
  postToMarkdown,
  extractImages,
  collectGameEmbeds,
} = require('../utils/blogHelpers');

const PAGE_SIZE = 9;
const MAX_TITLE = 120;
const MAX_EXCERPT = 200;
const MAX_CONTENT = 30000;

/* --------------------------- OKŁADKA (UPLOAD) --------------------------- */

// Git nie przechowuje pustych katalogów, a multer sam ich nie tworzy.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Plik trafia najpierw do pamięci; na dysk zapisujemy dopiero zweryfikowany i przekodowany obraz.
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    // Pole _csrf jest w formularzu przed plikiem - zły token nie zapisuje niczego na dysku.
    if (!checkUploadToken(req)) return cb(new Error('csrf'));
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
      const error = new Error('Okładka może być plikiem PNG, JPG, WEBP lub GIF.');
      error.userFacing = true;
      return cb(error);
    }
    cb(null, true);
  },
}).single('cover');

/** Wgrywa okładkę; przy błędzie zapamiętuje komunikat, a formularz wyświetla się ponownie. */
function handleCoverUpload(req, res, next) {
  coverUpload(req, res, async (err) => {
    req.body = req.body || {};
    if (err && err.message === 'csrf') return reject(req, res);
    if (!err && !isValid(req)) return verifyAfterUpload(req, res, () => {});
    if (err) {
      req.coverError =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Okładka jest za duża (maksymalnie 3 MB).'
          : err.userFacing
            ? err.message
            : 'Nie udało się wgrać okładki.';
    }

    // Sygnatura pliku, limit wymiarów i przekodowanie do WebP (utils/imageSafety.js).
    if (!err && req.file) {
      try {
        const image = await sanitizeImage(req.file.buffer, { maxSize: 1600 });
        req.file.filename = `${uuidv4()}${image.ext}`;
        await fs.promises.writeFile(path.join(UPLOAD_DIR, req.file.filename), image.buffer);
      } catch (imageError) {
        if (!imageError.userFacing) console.error('Błąd przetwarzania okładki:', imageError);
        req.coverError = imageError.userFacing ? imageError.message : 'Nie udało się przetworzyć okładki.';
        req.file = undefined;
      }
    }
    next();
  });
}

/* ------------------------------ LISTA ------------------------------ */

router.get('/', async (req, res, next) => {
  try {
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : '';
    const tag = tagKey(req.query.tag);
    const all = getPosts();
    const filtered = all.filter(
      (post) => (!category || post.category === category) && (!tag || post.tags.some((t) => tagKey(t) === tag)),
    );
    const activeTag = tag ? (all.flatMap((post) => post.tags).find((t) => tagKey(t) === tag) || tag) : '';

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    // Najnowszy wpis na pierwszej stronie (bez filtrów) jest wyróżniony osobno, reszta idzie do siatki.
    const unfiltered = !category && !tag;
    const featured = page === 1 && unfiltered ? filtered[0] || null : null;
    const gridStart = unfiltered ? 1 : 0;
    const offset = gridStart + (page - 1) * PAGE_SIZE;
    const posts = filtered.slice(offset, offset + PAGE_SIZE);
    const hasNext = offset + PAGE_SIZE < filtered.length;

    const counts = {};
    all.forEach((post) => {
      counts[post.category] = (counts[post.category] || 0) + 1;
    });

    const commentCounts = await countCommentsForPosts([...posts, ...(featured ? [featured] : [])].map((post) => post.id));

    res.render('blog/list', {
      title: activeTag ? `Wpisy z tagiem #${activeTag}` : category ? `Blog - ${category}` : 'Blog',
      seo: {
        description: 'Aktualności, poradniki i zestawienia od redakcji GameVerse.',
        // Strony filtrowane nie powinny konkurować z główną listą w wynikach wyszukiwania.
        noindex: !unfiltered,
      },
      featured,
      posts,
      category,
      activeTag,
      categories: CATEGORIES.filter((name) => counts[name]),
      counts,
      tags: countTags(all).slice(0, 15),
      commentCounts,
      total: all.length,
      pager: buildPagerLinks(req, page, hasNext, Math.max(1, Math.ceil((filtered.length - gridStart) / PAGE_SIZE))),
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ NOWY WPIS ------------------------------ */

function formatWhen(iso) {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' });
}

function publicationMessage({ status, publishAt }) {
  if (status === 'draft') return 'Szkic został zapisany. Widzisz go tylko Ty - opublikujesz go w edycji wpisu.';
  if (publishAt && new Date(publishAt).getTime() > Date.now()) return `Wpis zaplanowano na ${formatWhen(publishAt)}.`;
  return 'Wpis został opublikowany.';
}

function publicationNote({ status, publishAt }) {
  if (status === 'draft') return 'Szkic';
  if (publishAt && new Date(publishAt).getTime() > Date.now()) return `Zaplanowany na ${formatWhen(publishAt)}`;
  return undefined;
}

function renderForm(res, { post, formData, error, status = 200 }) {
  res.status(status).render('blog/form', {
    title: post ? 'Edytuj wpis' : 'Nowy wpis na blogu',
    post: post || null,
    formData: formData || {},
    categories: CATEGORIES,
    maxTags: MAX_TAGS,
    maxTagLength: MAX_TAG_LENGTH,
    maxContent: MAX_CONTENT,
    maxTitle: MAX_TITLE,
    maxExcerpt: MAX_EXCERPT,
    // Okładka automatyczna: domyślnie włączona dla nowych wpisów i wpisów bez własnej okładki.
    autoCoverDefault: post ? !!post.coverAuto || !post.coverImage || post.coverImage === COVER_PLACEHOLDER : true,
    // Popularne tagi - do szybkiego dodawania w edytorze.
    suggestedTags: countTags(getAllPosts()).slice(0, 12).map((item) => item.tag),
    formError: error || null,
  });
}

/** Dane wpisu do formularza edycji (tagi jako tekst, tryb publikacji wg stanu wpisu). */
function formDataFromPost(post) {
  const mode = post.state === 'draft' ? 'draft' : post.state === 'scheduled' ? 'schedule' : 'now';
  return { ...post, tags: post.tags.join(', '), publishMode: mode, publishAtIso: post.publishAt || '' };
}

const PUBLISH_MODES = ['now', 'draft', 'schedule'];
// Formularz mógł być otwarty chwilę, więc datę sprzed minuty jeszcze akceptujemy.
const SCHEDULE_TOLERANCE_MS = 60 * 1000;

/**
 * Tryb publikacji z formularza: "now" (opublikuj / zostaw opublikowany), "draft" (szkic) albo
 * "schedule" (opublikuj o wskazanej porze). Pole publishAt wypełnia przeglądarka datą w formacie ISO
 * (z jej strefą czasową); bez JavaScriptu przyjmujemy też datę z pola datetime-local.
 * @returns {{ status: string, publishAt: string|null, mode: string, error?: string }}
 */
function parsePublication(req, current) {
  const mode = PUBLISH_MODES.includes(req.body.publishMode) ? req.body.publishMode : 'now';

  if (mode === 'draft') return { mode, status: 'draft', publishAt: null };

  if (mode === 'schedule') {
    const raw = String(req.body.publishAt || req.body.publishAtLocal || '').trim();
    const when = raw ? new Date(raw) : null;
    if (!when || Number.isNaN(when.getTime())) {
      return { mode, error: 'Wybierz datę i godzinę zaplanowanej publikacji.' };
    }
    if (when.getTime() < Date.now() - SCHEDULE_TOLERANCE_MS) {
      return { mode, error: 'Zaplanowana publikacja musi być w przyszłości. Wybierz późniejszą datę albo opublikuj wpis od razu.' };
    }
    return { mode, status: 'published', publishAt: when.toISOString() };
  }

  // "now": już opublikowany wpis zachowuje swoją datę; szkic i zaplanowany dostają datę publikacji z chwili zapisu.
  if (current && current.state === 'published') return { mode, status: 'published', publishAt: current.publishAt || null };
  return { mode, status: 'published', publishAt: current ? new Date().toISOString() : null };
}

/** Wspólna walidacja i złożenie wpisu z pól formularza (nowy i edycja). */
function buildPostFields(req, current) {
  const title = String(req.body.title || '').trim().slice(0, MAX_TITLE);
  const content = String(req.body.content || '').trim();
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : DEFAULT_CATEGORY;
  const excerpt = String(req.body.excerpt || '').trim().slice(0, MAX_EXCERPT) || assistant.makeExcerpt(assistant.toPlain(content).text, 140);

  let coverImage = current ? current.coverImage : COVER_PLACEHOLDER;
  const coverUrl = String(req.body.coverUrl || '').trim();
  let uploadedCover = null;

  if (req.file) {
    uploadedCover = `${UPLOAD_URL_PREFIX}${req.file.filename}`;
    coverImage = uploadedCover;
  } else if (coverUrl) {
    coverImage = coverUrl;
  } else if (req.body.removeCover === '1') {
    coverImage = COVER_PLACEHOLDER;
  }

  const tags = parseTags(req.body.tags);

  // Okładka automatyczna: powstaje z tytułu, kategorii i tagów, o ile nie wybrano własnego pliku ani adresu.
  const manualCover = !!(req.file || coverUrl || req.body.removeCover === '1');
  const wantsAuto = req.body.autoCover === '1' && !manualCover;
  const coverVariant = Math.max(0, Math.min(999, parseInt(req.body.coverVariant, 10) || 0));
  // Znacznik "okładka jest automatyczna" zostaje, dopóki autor nie wybierze własnej.
  const coverAuto = manualCover ? false : current ? !!current.coverAuto : false;

  return { title, content, category, excerpt, coverImage, uploadedCover, tags, wantsAuto, coverVariant, coverAuto };
}

/** Klucz opisujący, z czego powstała okładka - gdy się nie zmienił, nie generujemy jej od nowa. */
function coverSpec(fields) {
  return JSON.stringify([fields.title, fields.category, fields.tags, fields.coverVariant]);
}

/**
 * Tworzy okładkę wpisu (utils/blogCoverGenerator.js), gdy autor tego chce, i zapisuje ją w katalogu wgranych
 * plików. Wywoływane dopiero po walidacji, żeby nie zostawiać osieroconych plików.
 */
async function applyGeneratedCover(fields, current) {
  if (!fields.wantsAuto) return;
  const spec = coverSpec(fields);
  fields.coverSpec = spec;

  // Ta sama okładka, ten sam opis - zostawiamy istniejący plik.
  if (current && current.coverAuto && current.coverSpec === spec && current.coverImage.startsWith(UPLOAD_URL_PREFIX)) {
    fields.coverImage = current.coverImage;
    fields.coverAuto = true;
    return;
  }

  try {
    const image = await generateBlogCover({
      title: fields.title,
      category: fields.category,
      tags: fields.tags,
      variant: fields.coverVariant,
    });
    const filename = `${uuidv4()}.webp`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), image);
    fields.coverImage = `${UPLOAD_URL_PREFIX}${filename}`;
    fields.coverAuto = true;
  } catch (err) {
    console.error('[blog] nie udało się utworzyć okładki:', err.message);
    fields.coverSpec = current ? current.coverSpec : undefined;
  }
}

function validate(fields, req) {
  if (req.coverError) return req.coverError;
  if (!fields.title || !fields.content) return 'Tytuł i treść wpisu są wymagane.';
  if (fields.content.length > MAX_CONTENT) return `Treść jest za długa (maksymalnie ${MAX_CONTENT} znaków).`;
  if (fields.coverImage && !/^(\/|https?:\/\/)/.test(fields.coverImage)) {
    return 'Adres okładki musi zaczynać się od / albo http(s)://.';
  }
  return null;
}

/* ------------------------- treść wpisu: karty gier ------------------------- */

/** HTML treści wpisu; karty gier ([[game:ID]]) wczytują dane z katalogu i średnie oceny graczy. */
async function renderPostContent(content) {
  const ids = collectGameEmbeds(content).slice(0, 12);
  const games = new Map();
  if (ids.length) {
    const found = await getGamesByIds(ids);
    (await withRatings([...found.values()])).forEach((game) => games.set(String(game.id), game));
  }
  return renderContent(content, { games });
}

/* ------------------------- biblioteka multimediów (edytor) ------------------------- */

const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: media.MAX_BYTES, files: 1 } }).single('image');

// Wgrywanie zdjęcia lub infografiki. Token CSRF idzie w nagłówku (fetch), więc sprawdzamy go przed odczytem pliku.
router.post(
  '/media',
  ensureAuthenticated,
  ensureAdmin,
  (req, res, next) => (isValid(req) ? next() : reject(req, res)),
  (req, res, next) =>
    mediaUpload(req, res, (err) => {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'Plik jest za duży (maksymalnie 8 MB).' : 'Nie udało się odczytać pliku.';
        return res.status(400).json({ error: message });
      }
      next();
    }),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Wybierz plik ze zdjęciem.' });
    try {
      const saved = await media.saveMedia({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        alt: req.body && req.body.alt,
        caption: req.body && req.body.caption,
        username: req.session.user.username,
      });
      res.json({ media: saved });
    } catch (err) {
      if (err.userFacing) return res.status(400).json({ error: err.message });
      console.error('[blog] błąd zapisu zdjęcia:', err);
      res.status(500).json({ error: 'Nie udało się zapisać zdjęcia.' });
    }
  },
);

router.get('/media', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    res.json({ media: await media.listMedia() });
  } catch (err) {
    next(err);
  }
});

router.post('/media/:id', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    const updated = await media.updateMedia(req.params.id, { alt: req.body.alt, caption: req.body.caption });
    if (!updated) return res.status(404).json({ error: 'Nie znaleziono zdjęcia.' });
    res.json({ media: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/media/:id/delete', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    const items = await media.listMedia(500);
    const item = items.find((entry) => entry.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Nie znaleziono zdjęcia.' });
    const usedIn = media.mediaUsage(item.url);
    if (usedIn.length) {
      return res.status(409).json({ error: `Zdjęcie jest użyte we wpisach: ${usedIn.join(', ')}. Najpierw usuń je z treści.` });
    }
    await media.removeMedia(item.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------- asystent SEO (edytor wpisu) ------------------------- */

/** Gry znane serwisowi (popularne z IGDB i dodane ręcznie) - do rozpoznawania tytułów w treści. */
async function knownGames() {
  const [pool, custom] = await Promise.all([getPopularPool(), CustomGame.findAll({ attributes: ['id', 'title'] })]);
  return [
    ...(pool ? pool.games.map((game) => ({ name: game.name, id: game.id })) : []),
    ...custom.map((game) => ({ name: game.title, id: game.id })),
  ];
}

const existingTagNames = () => countTags(getAllPosts()).map((item) => item.tag);
const assistantInput = (body) => ({
  title: String(body.title || '').slice(0, MAX_TITLE),
  content: String(body.content || '').slice(0, MAX_CONTENT),
});

// Propozycje tagów z treści i ocena SEO wpisu (edytor odpytuje ten adres podczas pisania).
router.post('/assist', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    const { title, content } = assistantInput(req.body);
    const tags = parseTags(req.body.tags);
    const keywords = assistant.extractKeywords({ title, content, games: await knownGames(), existingTags: existingTagNames(), tags });

    res.json({
      tags: assistant.suggestTags({ keywords, taken: tags, maxTagLength: MAX_TAG_LENGTH }),
      keywords: keywords.slice(0, 6).map((item) => ({ text: item.text, kind: item.kind })),
      analysis: assistant.analyze({
        title,
        content,
        excerpt: String(req.body.excerpt || '').slice(0, MAX_EXCERPT * 2),
        tags,
        hasCover: req.body.hasCover === true || req.body.hasCover === '1',
        keywords,
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Automatyczne formatowanie pod SEO: pogrubienie fraz, linki do gier z katalogu, porządkowanie list i nagłówków.
router.post('/autoformat', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    const { title, content } = assistantInput(req.body);
    if (!content.trim()) return res.json({ content, changed: false, changes: [] });
    res.json(assistant.autoFormat({ title, content, games: await knownGames(), existingTags: existingTagNames(), tags: parseTags(req.body.tags) }));
  } catch (err) {
    next(err);
  }
});

// Podgląd okładki tworzonej automatycznie (ta sama funkcja, która zapisze ją przy zapisie wpisu).
router.post('/cover-preview', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const image = await generateBlogCover({
      title: String(req.body.title || '').slice(0, MAX_TITLE),
      category: CATEGORIES.includes(req.body.category) ? req.body.category : DEFAULT_CATEGORY,
      tags: parseTags(req.body.tags),
      variant: req.body.variant,
    });
    res.set('Cache-Control', 'no-store').type('image/webp').send(image);
  } catch (err) {
    console.error('[blog] podgląd okładki nie powiódł się:', err.message);
    res.status(500).json({ error: 'Nie udało się utworzyć okładki.' });
  }
});

// Podgląd treści na żywo w edytorze: ten sam renderer, którego użyje strona wpisu.
router.post('/preview', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    const content = String(req.body.content || '').slice(0, MAX_CONTENT);
    res.json({ html: content.trim() ? await renderPostContent(content) : '' });
  } catch (err) {
    next(err);
  }
});

router.get('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  renderForm(res, { formData: { category: DEFAULT_CATEGORY, publishMode: 'now' } });
});

router.post('/new', ensureAuthenticated, ensureAdmin, handleCoverUpload, async (req, res) => {
  const fields = buildPostFields(req, null);
  const publication = parsePublication(req, null);
  const error = validate(fields, req) || publication.error;
  if (error) {
    if (fields.uploadedCover) removeUploadedCover(fields.uploadedCover);
    return renderForm(res, { formData: req.body, error, status: 400 });
  }

  await applyGeneratedCover(fields, null);

  const post = {
    id: uuidv4(),
    title: fields.title,
    author: req.session.user.username,
    category: fields.category,
    tags: fields.tags,
    excerpt: fields.excerpt,
    content: fields.content,
    coverImage: fields.coverImage,
    coverAuto: fields.coverAuto,
    coverSpec: fields.coverSpec,
    coverVariant: fields.coverVariant,
    status: publication.status,
    publishAt: publication.publishAt,
    createdAt: new Date().toISOString(),
  };
  savePost(post);
  resetSitemapCache();
  await logAdminAction(req, 'blog.create', 'blog', post.title, publicationNote(publication));

  req.flash('success', publicationMessage(publication));
  res.redirect(`/blog/${post.id}`);
});

/* ------------------------------ EDYCJA ------------------------------ */

router.get('/:id/edit', ensureAuthenticated, ensureAdmin, (req, res, next) => {
  const post = findPost(req.params.id);
  if (!post) return next();
  renderForm(res, { post, formData: formDataFromPost(post) });
});

router.post('/:id/edit', ensureAuthenticated, ensureAdmin, handleCoverUpload, async (req, res, next) => {
  const post = findPost(req.params.id);
  if (!post) return next();

  const fields = buildPostFields(req, post);
  const publication = parsePublication(req, post);
  const error = validate(fields, req) || publication.error;
  if (error) {
    if (fields.uploadedCover) removeUploadedCover(fields.uploadedCover);
    return renderForm(res, { post, formData: { ...formDataFromPost(post), ...req.body }, error, status: 400 });
  }

  await applyGeneratedCover(fields, post);

  // Poprzednia wgrana okładka nie jest już potrzebna, gdy wpis dostał inną.
  if (fields.coverImage !== post.coverImage) removeUploadedCover(post.coverImage);

  savePost({
    ...post,
    title: fields.title,
    category: fields.category,
    tags: fields.tags,
    excerpt: fields.excerpt,
    content: fields.content,
    coverImage: fields.coverImage,
    coverAuto: fields.coverAuto,
    coverSpec: fields.wantsAuto ? fields.coverSpec : undefined,
    coverVariant: fields.wantsAuto || fields.coverAuto ? fields.coverVariant : post.coverVariant,
    status: publication.status,
    publishAt: publication.publishAt,
    updatedAt: new Date().toISOString(),
  });
  resetSitemapCache();
  await logAdminAction(req, 'blog.edit', 'blog', fields.title, publicationNote(publication));

  const changedVisibility = publication.status === 'draft' || post.state !== 'published';
  req.flash('success', changedVisibility ? publicationMessage(publication) : 'Zmiany we wpisie zostały zapisane.');
  res.redirect(`/blog/${post.id}`);
});

router.post('/:id/delete', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  const removed = removePost(req.params.id);
  if (!removed) return next();
  await deleteCommentsForPost(removed.id);
  resetSitemapCache();
  await logAdminAction(req, 'blog.delete', 'blog', removed.title);
  req.flash('success', 'Wpis został usunięty.');
  res.redirect('/blog');
});

/* ------------------------------ WPIS ------------------------------ */

// Czysty Markdown wpisu (/blog/ID.md) - dla modeli językowych, czytników i archiwizacji.
router.get('/:id.md', (req, res, next) => {
  const post = findPost(req.params.id);
  if (!post || post.state !== 'published') return next();
  res
    .type('text/markdown; charset=utf-8')
    .set('Cache-Control', 'public, max-age=1800')
    .send(postToMarkdown(post, `${res.locals.siteUrl}/blog/${post.id}`));
});

router.get('/:id', async (req, res, next) => {
  try {
    const post = findPost(req.params.id);
    if (!post) return next();

    // Szkic i zaplanowany wpis (jeszcze niepubliczny) widzi tylko administrator.
    const isAdmin = !!(req.session.user && req.session.user.role === 'admin');
    if (post.state !== 'published' && !isAdmin) return next();

    const posts = getPosts();
    const index = posts.findIndex((p) => p.id === post.id);
    const related = posts
      .filter((p) => p.id !== post.id)
      .sort((a, b) => Number(b.category === post.category) - Number(a.category === post.category))
      .slice(0, 3);

    const meId = req.session.user ? req.session.user.id : null;
    const comments = post.state === 'published' ? await getCommentsForPost(post.id, meId) : [];
    const description = plainText(post.excerpt || post.content, 200);

    res.render('blog/detail', {
      title: post.title,
      seo: {
        type: 'article',
        title: post.title,
        description,
        image: post.coverImage,
        imageAlt: post.title,
        publishedTime: isoDate(post.publishedAt),
        modifiedTime: isoDate(post.updatedAt || post.publishedAt),
        section: post.category,
        tags: post.tags,
        noindex: post.state !== 'published',
        author: post.author,
        alternates: post.state === 'published' ? [{ type: 'text/markdown', href: `${res.locals.siteUrl}/blog/${post.id}.md` }] : [],
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description,
            image: [post.coverImage, ...extractImages(post.content).map((img) => img.src)]
              .slice(0, 4)
              .map((src) => res.locals.absoluteUrl(src)),
            datePublished: isoDate(post.publishedAt),
            dateModified: isoDate(post.updatedAt || post.publishedAt),
            inLanguage: 'pl',
            articleSection: post.category,
            wordCount: String(post.content || '').split(/\s+/).filter(Boolean).length,
            author: { '@type': 'Person', name: post.author },
            publisher: { '@id': `${res.locals.siteUrl}/#organization` },
            mainEntityOfPage: res.locals.canonicalUrl,
            keywords: post.tags.join(', ') || undefined,
          },
          breadcrumbLd(res.locals.siteUrl, [
            { name: 'GameVerse', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: post.title, path: `/blog/${post.id}` },
          ]),
        ],
      },
      post,
      contentHtml: await renderPostContent(post.content),
      newer: index > 0 ? posts[index - 1] : null,
      older: index !== -1 && index < posts.length - 1 ? posts[index + 1] : null,
      related,
      comments,
      commentMax: MAX_COMMENT_LENGTH,
      reportReasonSets: { comment: REASONS_BY_TYPE.comment },
      reportCommentMax: MAX_REPORT_COMMENT,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ KOMENTARZE ------------------------------ */

// Moderacja jak przy komentarzach pod recenzjami: wyciszenie konta, limit komentarzy, filtr wulgaryzmów,
// zgłaszanie (routes/reports.js) oraz usuwanie przez autora i administratora.
router.post('/:id/comments', ensureAuthenticated, blockIfMuted, limiters.comment, async (req, res, next) => {
  try {
    const post = findPost(req.params.id);
    if (!post || post.state !== 'published') return next();

    const back = `/blog/${post.id}#comments`;
    const text = String(req.body.text || '').trim().slice(0, MAX_COMMENT_LENGTH);
    if (!text) {
      req.flash('error', 'Komentarz nie może być pusty.');
      return res.redirect(back);
    }

    const checked = moderateText(text, { userId: req.session.user.id });
    if (!checked.ok) {
      req.flash('error', checked.error);
      return res.redirect(back);
    }

    const created = await addComment({
      postId: post.id,
      userId: req.session.user.id,
      username: req.session.user.username,
      text: checked.text,
    });

    // Autor wpisu (konto administratora) dostaje powiadomienie o nowym komentarzu.
    const author = await User.findOne({ where: { username: post.author }, attributes: ['id'] });
    if (author) {
      await createNotification({
        userId: author.id,
        type: 'blog-comment',
        actorId: req.session.user.id,
        message: `${req.session.user.username} skomentował(a) wpis „${post.title}”`,
        link: `/blog/${post.id}#comment-${created.id}`,
      });
    }

    req.flash('success', 'Komentarz został dodany.');
    res.redirect(`/blog/${post.id}#comment-${created.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments/:commentId/delete', ensureAuthenticated, async (req, res, next) => {
  try {
    const back = `/blog/${req.params.id}#comments`;
    const removed = await deleteComment(req.params.commentId, req.session.user);
    if (!removed || removed.postId !== req.params.id) {
      req.flash('error', 'Możesz usuwać tylko swoje komentarze.');
      return res.redirect(back);
    }

    // Administrator usuwający cudzy komentarz zostawia ślad w dzienniku i uprzedza autora.
    if (removed.userId !== req.session.user.id) {
      await logAdminAction(req, 'comment.delete', 'comment', removed.username, removed.text.slice(0, 120));
      await createNotification({
        userId: removed.userId,
        type: 'moderation',
        actorId: req.session.user.id,
        message: 'Twój komentarz pod wpisem na blogu został usunięty przez moderatora.',
        link: null,
      });
    }
    req.flash('success', 'Komentarz został usunięty.');
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
