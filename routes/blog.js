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
const writer = require('../utils/writingAssistant');
const { runWriter } = require('../utils/writerPipeline');
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
    const all = await getPosts({ content: false });
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

async function renderForm(res, { post, formData, error, status = 200 }) {
  const suggestedTags = countTags(await getAllPosts({ content: false })).slice(0, 12).map((item) => item.tag);
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
    suggestedTags,
    writerOptions: writerOptions(),
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

/** Wpis ze znacznikami [UZUPEŁNIJ: ...] (z pomocnika pisania) można zapisać tylko jako szkic. */
function placeholderError(fields, publication) {
  const left = (String(fields.content || '').match(writer.PLACEHOLDER) || []).length;
  if (!left || publication.status === 'draft') return null;
  return `W treści zostały miejsca do uzupełnienia ([UZUPEŁNIJ: ...]): ${left}. Wpisz tam własne informacje albo zapisz wpis jako szkic.`;
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
    const usedIn = await media.mediaUsage(item.url);
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

const existingTagNames = async () => countTags(await getAllPosts({ content: false })).map((item) => item.tag);
const assistantInput = (body) => ({
  title: String(body.title || '').slice(0, MAX_TITLE),
  content: String(body.content || '').slice(0, MAX_CONTENT),
});

// Propozycje tagów z treści i ocena SEO wpisu (edytor odpytuje ten adres podczas pisania).
router.post('/assist', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    const { title, content } = assistantInput(req.body);
    const tags = parseTags(req.body.tags);
    const keywords = assistant.extractKeywords({ title, content, games: await knownGames(), existingTags: await existingTagNames(), tags });

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
    res.json(assistant.autoFormat({ title, content, games: await knownGames(), existingTags: await existingTagNames(), tags: parseTags(req.body.tags) }));
  } catch (err) {
    next(err);
  }
});

// Podgląd okładki tworzonej automatycznie (ta sama funkcja, która zapisze ją przy zapisie wpisu).
/* ------------------------- pomocnik pisania (artykuł z zadania) ------------------------- */

const WRITER_LENGTH_LABELS = { short: 'Krótki', medium: 'Średni', long: 'Długi' };
const WRITER_TONE_LABELS = { neutral: 'Rzeczowy', casual: 'Luźny', expert: 'Ekspercki' };

/** "jest 1 miejsce oznaczone", "są 3 miejsca oznaczone", "jest 5 miejsc oznaczonych". */
function placesPhrase(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) return 'jest 1 miejsce oznaczone';
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `są ${count} miejsca oznaczone`;
  return `jest ${count} miejsc oznaczonych`;
}

/** Dane do okna pomocnika w edytorze (rodzaje artykułów, tony, długości, tryb pracy). */
function writerOptions() {
  return {
    enabled: writer.isConfigured(),
    types: Object.entries(writer.TYPES).map(([key, item]) => ({ key, label: item.label })),
    tones: Object.entries(writer.TONES).map(([key]) => ({ key, label: WRITER_TONE_LABELS[key] })),
    lengths: Object.entries(writer.LENGTHS).map(([key, words]) => ({ key, label: `${WRITER_LENGTH_LABELS[key]} (ok. ${words} słów)` })),
    webSearch: writer.webSearchEnabled(),
  };
}

// Z krótkiego zadania (temat, punkty, gry z katalogu) tworzy kompletny artykuł: tytuł, opis, tagi, treść, a także zdjęcia
// na wolnych licencjach i film (utils/writerPipeline.js). Z kluczem ANTHROPIC_API_KEY pisze Claude; bez klucza (albo gdy AI
// jest niedostępne) powstaje szkielet z danymi z katalogu. Klient wysyłający Accept: application/x-ndjson dostaje postęp
// na żywo (jedna linia JSON na etap, na końcu wynik), pozostali - zwykły JSON z wynikiem.
const flag = (value, fallback) => (value === undefined ? fallback : !(value === false || value === '0' || value === 'false'));

router.post('/write', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    const parsed = writer.normalizeBrief(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { brief } = parsed;
    const options = {
      images: flag(req.body.images, true),
      video: flag(req.body.video, true),
      screenshots: flag(req.body.screenshots, false),
      research: flag(req.body.research, true),
    };

    const found = brief.gameIds.length ? await getGamesByIds(brief.gameIds) : new Map();
    const rated = await withRatings([...found.values()]);
    const facts = brief.gameIds
      .map((id) => rated.find((game) => String(game.id) === id))
      .filter(Boolean)
      .map(writer.factOf);

    const existing = await existingTagNames();
    const keywords = assistant
      .extractKeywords({ title: brief.topic, content: brief.points.join('\n'), games: await knownGames(), existingTags: existing, tags: [] })
      .slice(0, 6);

    const notes = [];
    if (facts.length < brief.gameIds.length) notes.push('Nie udało się pobrać części wskazanych gier z katalogu - pominięto je w tekście.');

    let ai = writer.isConfigured();
    if (ai) {
      const quota = writer.takeQuota(req.session.user.id);
      if (!quota.ok) {
        ai = false;
        notes.push(`${quota.message} Wstawiono szkielet bez AI.`);
      }
    }

    const wantsStream = /application\/x-ndjson/.test(req.get('Accept') || '');
    let closed = false;
    res.on('close', () => { if (!res.writableEnded) closed = true; });
    if (wantsStream) {
      res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
    }
    const send = (line) => { if (wantsStream && !closed) res.write(`${JSON.stringify(line)}\n`); };

    let outcome;
    try {
      outcome = await runWriter({
        brief,
        facts,
        keywords: keywords.map((item) => item.text),
        existingTags: existing.slice(0, 30),
        options,
        ai,
        username: req.session.user.username,
        limits: { title: MAX_TITLE, excerpt: MAX_EXCERPT, content: MAX_CONTENT },
        parseTags,
        onStep: (step) => send({ type: 'step', ...step }),
        isAborted: () => closed,
      });
    } catch (err) {
      if (err.aborted) return res.end();
      if (wantsStream && res.headersSent) {
        console.error('[blog] pomocnik pisania:', err);
        send({ type: 'error', error: 'Nie udało się przygotować artykułu. Spróbuj ponownie.' });
        return res.end();
      }
      throw err;
    }

    const { article } = outcome;
    if (!article.content) {
      const failure = 'Nie udało się przygotować treści. Spróbuj ponownie.';
      if (wantsStream) { send({ type: 'error', error: failure }); return res.end(); }
      return res.status(502).json({ error: failure });
    }
    const allNotes = [...notes, ...outcome.notes];
    if (article.placeholders) {
      allNotes.push(`W tekście ${placesPhrase(article.placeholders)} jako [UZUPEŁNIJ: ...] - wpisz tam własne informacje. Wpisu z takimi znacznikami nie da się opublikować, można go zapisać jako szkic.`);
    }
    if (outcome.mode === 'skeleton' && !writer.isConfigured()) {
      allNotes.push('To szkielet bez AI: układ pod SEO i prawdziwe dane o grach z katalogu. Kompletny tekst od początku do końca napisze AI po ustawieniu ANTHROPIC_API_KEY.');
    }

    const analysis = assistant.analyze({ title: article.title, excerpt: article.excerpt, content: article.content, tags: article.tags, hasCover: true, keywords });
    await logAdminAction(
      req,
      'blog.writer',
      'blog',
      brief.topic.slice(0, 80),
      outcome.mode === 'ai'
        ? `AI ${outcome.model}, tokeny: ${outcome.usage.inputTokens} wejście / ${outcome.usage.outputTokens} wyjście, wyszukiwań: ${outcome.usage.searches}, zdjęć: ${outcome.media.images.length}, film: ${outcome.media.video ? 'tak' : 'nie'}`
        : `szkielet bez AI, zdjęć: ${outcome.media.images.length}, film: ${outcome.media.video ? 'tak' : 'nie'}`,
    );

    const payload = {
      mode: outcome.mode,
      title: article.title,
      excerpt: article.excerpt,
      tags: article.tags,
      category: article.category,
      content: article.content,
      words: article.words,
      analysis,
      keywords: keywords.map((item) => ({ text: item.text, kind: item.kind })),
      notes: allNotes,
      usage: outcome.mode === 'ai' ? outcome.usage : null,
      media: outcome.media,
    };
    if (wantsStream) {
      send({ type: 'done', result: payload });
      return res.end();
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

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

router.get('/new', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    await renderForm(res, { formData: { category: DEFAULT_CATEGORY, publishMode: 'now' } });
  } catch (err) {
    next(err);
  }
});

router.post('/new', ensureAuthenticated, ensureAdmin, handleCoverUpload, async (req, res, next) => {
  let fields;
  let saved = false;
  try {
    fields = buildPostFields(req, null);
    const publication = parsePublication(req, null);
    const error = validate(fields, req) || publication.error || placeholderError(fields, publication);
    if (error) {
      if (fields.uploadedCover) removeUploadedCover(fields.uploadedCover);
      return await renderForm(res, { formData: req.body, error, status: 400 });
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
    await savePost(post);
    saved = true;
    resetSitemapCache();
    await logAdminAction(req, 'blog.create', 'blog', post.title, publicationNote(publication));

    req.flash('success', publicationMessage(publication));
    res.redirect(`/blog/${post.id}`);
  } catch (err) {
    // Wpis się nie zapisał - okładka (wgrana albo wygenerowana) nie ma właściciela, więc jej nie zostawiamy na dysku.
    if (!saved && fields) removeUploadedCover(fields.coverImage);
    next(err);
  }
});

/* ------------------------------ EDYCJA ------------------------------ */

router.get('/:id/edit', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    const post = await findPost(req.params.id);
    if (!post) return next();
    await renderForm(res, { post, formData: formDataFromPost(post) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/edit', ensureAuthenticated, ensureAdmin, handleCoverUpload, async (req, res, next) => {
  let fields;
  let post;
  let saved = false;
  try {
    post = await findPost(req.params.id);
    if (!post) {
      if (req.file) removeUploadedCover(`${UPLOAD_URL_PREFIX}${req.file.filename}`);
      return next();
    }

    fields = buildPostFields(req, post);
    const publication = parsePublication(req, post);
    const error = validate(fields, req) || publication.error || placeholderError(fields, publication);
    if (error) {
      if (fields.uploadedCover) removeUploadedCover(fields.uploadedCover);
      return await renderForm(res, { post, formData: { ...formDataFromPost(post), ...req.body }, error, status: 400 });
    }

    await applyGeneratedCover(fields, post);

    await savePost({
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
    saved = true;

    // Poprzednia wgrana okładka nie jest już potrzebna, gdy wpis dostał inną (usuwamy ją dopiero po zapisie).
    if (fields.coverImage !== post.coverImage) removeUploadedCover(post.coverImage);

    resetSitemapCache();
    await logAdminAction(req, 'blog.edit', 'blog', fields.title, publicationNote(publication));

    const changedVisibility = publication.status === 'draft' || post.state !== 'published';
    req.flash('success', changedVisibility ? publicationMessage(publication) : 'Zmiany we wpisie zostały zapisane.');
    res.redirect(`/blog/${post.id}`);
  } catch (err) {
    // Zapis się nie udał: nowa okładka nie jest przypisana do wpisu, stara zostaje.
    if (!saved && fields && post && fields.coverImage !== post.coverImage) removeUploadedCover(fields.coverImage);
    next(err);
  }
});

router.post('/:id/delete', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    // removePost usuwa też tagi i komentarze wpisu.
    const removed = await removePost(req.params.id);
    if (!removed) return next();
    resetSitemapCache();
    await logAdminAction(req, 'blog.delete', 'blog', removed.title);
    req.flash('success', 'Wpis został usunięty.');
    res.redirect('/blog');
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ WPIS ------------------------------ */

// Czysty Markdown wpisu (/blog/ID.md) - dla modeli językowych, czytników i archiwizacji.
router.get('/:id.md', async (req, res, next) => {
  try {
    const post = await findPost(req.params.id);
    if (!post || post.state !== 'published') return next();
    res
      .type('text/markdown; charset=utf-8')
      .set('Cache-Control', 'public, max-age=1800')
      .send(postToMarkdown(post, `${res.locals.siteUrl}/blog/${post.id}`));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const post = await findPost(req.params.id);
    if (!post) return next();

    // Szkic i zaplanowany wpis (jeszcze niepubliczny) widzi tylko administrator.
    const isAdmin = !!(req.session.user && req.session.user.role === 'admin');
    if (post.state !== 'published' && !isAdmin) return next();

    const posts = await getPosts({ content: false });
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
    const post = await findPost(req.params.id);
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
