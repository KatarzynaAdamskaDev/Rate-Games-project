const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const { buildPagerLinks } = require('../utils/gameListing');
const { logAdminAction } = require('../utils/adminHelpers');
const { sanitizeImage } = require('../utils/imageSafety');
const { checkUploadToken, verifyAfterUpload, reject, isValid } = require('../middleware/csrf');
const {
  CATEGORIES,
  DEFAULT_CATEGORY,
  COVER_PLACEHOLDER,
  UPLOAD_DIR,
  UPLOAD_URL_PREFIX,
  getPosts,
  findPost,
  savePost,
  removePost,
  removeUploadedCover,
  renderContent,
} = require('../utils/blogHelpers');

const PAGE_SIZE = 9;
const MAX_TITLE = 120;
const MAX_EXCERPT = 200;

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

router.get('/', (req, res) => {
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : '';
  const all = getPosts();
  const filtered = category ? all.filter((post) => post.category === category) : all;

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  // Najnowszy wpis na pierwszej stronie (bez filtra) jest wyróżniony osobno, reszta idzie do siatki.
  const featured = page === 1 && !category ? filtered[0] || null : null;
  const gridStart = category ? 0 : 1;
  const offset = gridStart + (page - 1) * PAGE_SIZE;
  const posts = filtered.slice(offset, offset + PAGE_SIZE);
  const hasNext = offset + PAGE_SIZE < filtered.length;

  const counts = {};
  all.forEach((post) => {
    counts[post.category] = (counts[post.category] || 0) + 1;
  });

  res.render('blog/list', {
    title: 'Blog',
    featured,
    posts,
    category,
    categories: CATEGORIES.filter((name) => counts[name]),
    counts,
    total: all.length,
    pager: buildPagerLinks(req, page, hasNext, Math.max(1, Math.ceil((filtered.length - gridStart) / PAGE_SIZE))),
  });
});

/* ------------------------------ NOWY WPIS ------------------------------ */

function renderForm(res, { post, formData, error, status = 200 }) {
  res.status(status).render('blog/form', {
    title: post ? 'Edytuj wpis' : 'Nowy wpis na blogu',
    post: post || null,
    formData: formData || {},
    categories: CATEGORIES,
    formError: error || null,
  });
}

/** Wspólna walidacja i złożenie wpisu z pól formularza (nowy i edycja). */
function buildPostFields(req, current) {
  const title = String(req.body.title || '').trim().slice(0, MAX_TITLE);
  const content = String(req.body.content || '').trim();
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : DEFAULT_CATEGORY;
  const excerpt = String(req.body.excerpt || '').trim().slice(0, MAX_EXCERPT) || content.replace(/\s+/g, ' ').slice(0, 140);

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

  return { title, content, category, excerpt, coverImage, uploadedCover };
}

function validate(fields, req) {
  if (req.coverError) return req.coverError;
  if (!fields.title || !fields.content) return 'Tytuł i treść wpisu są wymagane.';
  if (fields.coverImage && !/^(\/|https?:\/\/)/.test(fields.coverImage)) {
    return 'Adres okładki musi zaczynać się od / albo http(s)://.';
  }
  return null;
}

router.get('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  renderForm(res, { formData: { category: DEFAULT_CATEGORY } });
});

router.post('/new', ensureAuthenticated, ensureAdmin, handleCoverUpload, async (req, res) => {
  const fields = buildPostFields(req, null);
  const error = validate(fields, req);
  if (error) {
    if (fields.uploadedCover) removeUploadedCover(fields.uploadedCover);
    return renderForm(res, { formData: req.body, error, status: 400 });
  }

  const post = {
    id: uuidv4(),
    title: fields.title,
    author: req.session.user.username,
    category: fields.category,
    excerpt: fields.excerpt,
    content: fields.content,
    coverImage: fields.coverImage,
    createdAt: new Date().toISOString(),
  };
  savePost(post);
  await logAdminAction(req, 'blog.create', 'blog', post.title);

  req.flash('success', 'Wpis został opublikowany.');
  res.redirect(`/blog/${post.id}`);
});

/* ------------------------------ EDYCJA ------------------------------ */

router.get('/:id/edit', ensureAuthenticated, ensureAdmin, (req, res, next) => {
  const post = findPost(req.params.id);
  if (!post) return next();
  renderForm(res, { post, formData: post });
});

router.post('/:id/edit', ensureAuthenticated, ensureAdmin, handleCoverUpload, async (req, res, next) => {
  const post = findPost(req.params.id);
  if (!post) return next();

  const fields = buildPostFields(req, post);
  const error = validate(fields, req);
  if (error) {
    if (fields.uploadedCover) removeUploadedCover(fields.uploadedCover);
    return renderForm(res, { post, formData: { ...post, ...req.body }, error, status: 400 });
  }

  // Poprzednia wgrana okładka nie jest już potrzebna, gdy wpis dostał inną.
  if (fields.coverImage !== post.coverImage) removeUploadedCover(post.coverImage);

  savePost({
    ...post,
    title: fields.title,
    category: fields.category,
    excerpt: fields.excerpt,
    content: fields.content,
    coverImage: fields.coverImage,
    updatedAt: new Date().toISOString(),
  });
  await logAdminAction(req, 'blog.edit', 'blog', fields.title);

  req.flash('success', 'Zmiany we wpisie zostały zapisane.');
  res.redirect(`/blog/${post.id}`);
});

router.post('/:id/delete', ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  const removed = removePost(req.params.id);
  if (!removed) return next();
  await logAdminAction(req, 'blog.delete', 'blog', removed.title);
  req.flash('success', 'Wpis został usunięty.');
  res.redirect('/blog');
});

/* ------------------------------ WPIS ------------------------------ */

router.get('/:id', (req, res, next) => {
  const posts = getPosts();
  const index = posts.findIndex((p) => p.id === req.params.id);
  if (index === -1) return next();

  const post = posts[index];
  const related = posts
    .filter((p) => p.id !== post.id)
    .sort((a, b) => Number(b.category === post.category) - Number(a.category === post.category))
    .slice(0, 3);

  res.render('blog/detail', {
    title: post.title,
    post,
    contentHtml: renderContent(post.content),
    newer: index > 0 ? posts[index - 1] : null,
    older: index < posts.length - 1 ? posts[index + 1] : null,
    related,
  });
});

module.exports = router;
