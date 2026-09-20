/**
 * Biblioteka multimediów bloga: wgrywanie zdjęć i infografik z edytora, lista, edycja opisu i usuwanie.
 * Pliki przechodzą przez sanitizeImage (sprawdzenie sygnatury, limit wymiarów, przekodowanie do WebP), więc
 * na dysk trafia wyłącznie bezpieczny obraz.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const BlogMedia = require('../models/BlogMedia');
const { sanitizeImage } = require('./imageSafety');
const { getAllPosts } = require('./blogHelpers');

const MEDIA_DIR = path.join(__dirname, '..', 'public', 'images', 'blog', 'media');
const MEDIA_URL_PREFIX = '/images/blog/media/';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SIZE = 2400; // dłuższy bok po zmniejszeniu (infografiki bywają wysokie)
const MAX_TEXT = 300;

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/** Podpowiedź tekstu alternatywnego z nazwy pliku ("elden-ring-mapa.png" -> "elden ring mapa"); puste dla nazw aparatu. */
function altFromFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (base.length < 4 || /^(?:img|dsc|dscn|image|photo|screenshot|zrzut|obraz)[\s\d]*$/i.test(base) || /^[\d\s]+$/.test(base)) return '';
  return base.slice(0, MAX_TEXT);
}

const toPlain = (row) => (row ? row.get({ plain: true }) : null);

/** Zapisuje wgrany obraz w bibliotece. @throws {ImageRejectedError} gdy plik nie jest poprawnym obrazem */
async function saveMedia({ buffer, originalName, alt, caption, username }) {
  const image = await sanitizeImage(buffer, { maxSize: MAX_SIZE });
  const filename = `${uuidv4()}${image.ext}`;
  const meta = await sharp(image.buffer).metadata();
  await fs.promises.writeFile(path.join(MEDIA_DIR, filename), image.buffer);

  const row = await BlogMedia.create({
    filename,
    url: `${MEDIA_URL_PREFIX}${filename}`,
    alt: clean(alt) || altFromFilename(originalName),
    caption: clean(caption),
    width: meta.width || null,
    height: meta.pageHeight || meta.height || null,
    sizeBytes: image.buffer.length,
    originalName: String(originalName || '').slice(0, 200) || null,
    uploadedBy: username || null,
  });
  return toPlain(row);
}

async function listMedia(limit = 80) {
  const rows = await BlogMedia.findAll({ order: [['createdAt', 'DESC']], limit });
  return rows.map(toPlain);
}

async function updateMedia(id, { alt, caption }) {
  const row = await BlogMedia.findByPk(id);
  if (!row) return null;
  await row.update({ alt: clean(alt), caption: clean(caption) });
  return toPlain(row);
}

/** Tytuły wpisów (także szkiców), w których użyto obrazu. */
function mediaUsage(url) {
  return getAllPosts()
    .filter((post) => String(post.content || '').includes(url) || post.coverImage === url)
    .map((post) => post.title);
}

async function removeMedia(id) {
  const row = await BlogMedia.findByPk(id);
  if (!row) return false;
  const file = path.join(MEDIA_DIR, path.basename(row.filename));
  await row.destroy();
  fs.unlink(file, () => {});
  return true;
}

module.exports = { MAX_BYTES, MEDIA_URL_PREFIX, altFromFilename, saveMedia, listMedia, updateMedia, mediaUsage, removeMedia };
