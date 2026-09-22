/**
 * Wpisy bloga (tabele blog_posts i blog_post_tags): odczyt, zapis, kategorie, tagi, szkice i zaplanowana publikacja
 * oraz bezpieczne renderowanie treści z prostym formatowaniem.
 *
 * Stan wpisu: "draft" (szkic, widzi go tylko administrator), "scheduled" (opublikowany z datą w przyszłości -
 * czeka na termin) i "published". Zaplanowany wpis pojawia się sam, gdy nadejdzie jego data - stan liczymy
 * przy każdym odczycie, więc nie potrzeba żadnego zadania w tle.
 *
 * Formatowanie w treści wpisu:
 *   pusta linia rozdziela akapity, "## Tytuł" to śródtytuł, "- punkt" to lista,
 *   "1. punkt" to lista numerowana, "> tekst" to cytat, **pogrubienie**, *kursywa*,
 *   [tekst](https://adres) to link.
 */
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const BlogPost = require('../models/BlogPost');
const BlogPostTag = require('../models/BlogPostTag');
const BlogComment = require('../models/BlogComment');
const { BLOG_COVER_DIR } = require('../config/storage');

const COVER_PLACEHOLDER = '/images/game-placeholder.svg';
const UPLOAD_URL_PREFIX = '/images/blog/uploads/';
const UPLOAD_DIR = BLOG_COVER_DIR;

const CATEGORIES = ['Aktualności', 'Poradniki', 'Zestawienia', 'Recenzje', 'Społeczność', 'Inne'];
const DEFAULT_CATEGORY = 'Aktualności';

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 24;

/** Tagi z pola formularza (po przecinku, średniku lub w nowych liniach): bez "#", bez powtórzeń, z limitami. */
function parseTags(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,;\n]+/);
  const seen = new Set();
  const tags = [];
  for (const item of raw) {
    // trim() na początku, żeby "#" zostało usunięte, także gdy przed nim jest spacja (np. "rpg, #akcja").
    const tag = String(item).trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** Klucz tagu do porównań i adresów (wielkość liter nie ma znaczenia). */
function tagKey(tag) {
  return String(tag || '').trim().toLowerCase();
}

/** Stan wpisu: draft | scheduled | published. */
function postState(post, now = Date.now()) {
  if (post.status === 'draft') return 'draft';
  if (post.publishAt && new Date(post.publishAt).getTime() > now) return 'scheduled';
  return 'published';
}

const DEFAULT_AUTHOR = 'Redakcja GameVerse';

/** Czas czytania w minutach (ok. 200 słów na minutę). */
function readMinutesOf(content) {
  return Math.max(1, Math.round(String(content || '').split(/\s+/).filter(Boolean).length / 200));
}

/** Dopełnia pola, których nie mają starsze wpisy (kategoria, czas czytania, tagi, stan publikacji). */
function normalizePost(post) {
  const content = String(post.content || '');
  return {
    ...post,
    category: CATEGORIES.includes(post.category) ? post.category : DEFAULT_CATEGORY,
    coverImage: post.coverImage || COVER_PLACEHOLDER,
    excerpt: post.excerpt || content.slice(0, 140),
    tags: parseTags(post.tags),
    status: post.status === 'draft' ? 'draft' : 'published',
    publishAt: post.publishAt || null,
    // Data, od której wpis jest widoczny (i wg której układamy listę).
    publishedAt: post.publishAt || post.createdAt,
    state: postState(post),
    readMinutes: post.readMinutes || readMinutesOf(content),
  };
}

/* ------------------------- zapis i odczyt (baza danych) ------------------------- */

const toIso = (value) => (value ? new Date(value).toISOString() : null);

function parseSpec(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (err) {
    return undefined;
  }
}

function rowToPost(row, tags) {
  const data = row.get ? row.get({ plain: true }) : row;
  return normalizePost({
    id: data.id,
    title: data.title,
    author: data.author,
    category: data.category,
    excerpt: data.excerpt,
    content: data.content,
    readMinutes: data.readMinutes,
    coverImage: data.coverImage || undefined,
    coverAuto: !!data.coverAuto,
    coverSpec: parseSpec(data.coverSpec),
    coverVariant: data.coverVariant,
    status: data.status,
    publishAt: toIso(data.publishAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt) || undefined,
    tags,
  });
}

const TAG_QUERY_CHUNK = 400;

/** Tagi wpisów: Map(id wpisu -> [tag, ...]) w kolejności z formularza. */
async function loadTags(ids) {
  const byPost = new Map();
  for (let i = 0; i < ids.length; i += TAG_QUERY_CHUNK) {
    const rows = await BlogPostTag.findAll({
      where: { postId: ids.slice(i, i + TAG_QUERY_CHUNK) },
      order: [['position', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    rows.forEach((row) => {
      if (!byPost.has(row.postId)) byPost.set(row.postId, []);
      byPost.get(row.postId).push(row.tag);
    });
  }
  return byPost;
}

/** Wpisy od najnowszych; content: false pomija treść (listy jej nie potrzebują, a czas czytania jest zapisany). */
async function loadPosts({ where, limit, content = true } = {}) {
  const rows = await BlogPost.findAll({
    where,
    limit,
    attributes: content ? undefined : { exclude: ['content'] },
    order: [['publishedAt', 'DESC'], ['createdAt', 'DESC']],
  });
  const tags = await loadTags(rows.map((row) => row.id));
  return rows.map((row) => rowToPost(row, tags.get(row.id) || []));
}

/** Warunek "widoczny dla wszystkich": nie szkic i bez terminu w przyszłości. */
function publishedWhere(now = new Date()) {
  return { status: { [Op.ne]: 'draft' }, [Op.or]: [{ publishAt: null }, { publishAt: { [Op.lte]: now } }] };
}

/** Wszystkie wpisy, także szkice i zaplanowane (dla administratora), od najnowszych. */
function getAllPosts(options = {}) {
  return loadPosts(options);
}

/** Wpisy widoczne dla wszystkich: opublikowane i takie, których termin już minął. Opcje: { limit, content }. */
function getPosts(options = {}) {
  return loadPosts({ ...options, where: publishedWhere() });
}

/** Liczba wpisów: wszystkich albo tylko widocznych dla wszystkich ({ published: true }). */
function countPosts({ published = false } = {}) {
  return BlogPost.count({ where: published ? publishedWhere() : undefined });
}

/** Wpis po id w dowolnym stanie (do edycji i podglądu przez administratora). */
async function findPost(id) {
  if (!id) return null;
  const row = await BlogPost.findByPk(String(id).slice(0, 64));
  if (!row) return null;
  return rowToPost(row, (await loadTags([row.id])).get(row.id) || []);
}

/** Tagi z liczbą wpisów, od najczęstszych: [{ tag, key, count }]. */
function countTags(posts) {
  const map = new Map();
  posts.forEach((post) => {
    post.tags.forEach((tag) => {
      const key = tagKey(tag);
      const entry = map.get(key) || { tag, key, count: 0 };
      entry.count += 1;
      map.set(key, entry);
    });
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pl'));
}

// Zapisy wpisów wykonujemy po kolei: dwa równoległe zapisy tego samego wpisu nie pomieszają jego tagów,
// a lokalny SQLite nie zgłasza błędu "database is locked".
let writeQueue = Promise.resolve();
function inWriteQueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

/** Zapisuje nowy albo istniejący wpis (po id); wpis i jego tagi zapisują się razem, w jednej transakcji. */
function savePost(post) {
  return inWriteQueue(() => writePost(post));
}

async function writePost(post) {
  const content = String(post.content || '');
  const createdAt = post.createdAt ? new Date(post.createdAt) : new Date();
  const publishAt = post.publishAt ? new Date(post.publishAt) : null;
  const tags = parseTags(post.tags);
  const values = {
    title: String(post.title || ''),
    author: post.author || DEFAULT_AUTHOR,
    category: CATEGORIES.includes(post.category) ? post.category : DEFAULT_CATEGORY,
    excerpt: String(post.excerpt || content.slice(0, 140)),
    content,
    readMinutes: readMinutesOf(content),
    coverImage: post.coverImage || null,
    coverAuto: !!post.coverAuto,
    coverSpec: post.coverSpec ? JSON.stringify(post.coverSpec) : null,
    coverVariant: Number.isInteger(post.coverVariant) ? post.coverVariant : 0,
    status: post.status === 'draft' ? 'draft' : 'published',
    publishAt,
    publishedAt: publishAt || createdAt,
    updatedAt: post.updatedAt ? new Date(post.updatedAt) : null,
  };

  await sequelize.transaction(async (transaction) => {
    const existing = await BlogPost.findByPk(post.id, { transaction });
    if (existing) await existing.update(values, { transaction });
    else await BlogPost.create({ id: post.id, createdAt, ...values }, { transaction });

    await BlogPostTag.destroy({ where: { postId: post.id }, transaction });
    if (tags.length) {
      await BlogPostTag.bulkCreate(
        tags.map((tag, position) => ({ postId: post.id, tag, tagKey: tagKey(tag), position })),
        { transaction },
      );
    }
  });
}

/** Usuwa wpis razem z tagami i komentarzami oraz wgraną okładką (okładki podane jako adres zostają bez zmian). */
async function removePost(id) {
  const post = await findPost(id);
  if (!post) return null;
  await inWriteQueue(() =>
    sequelize.transaction(async (transaction) => {
      await BlogComment.destroy({ where: { postId: post.id }, transaction });
      await BlogPostTag.destroy({ where: { postId: post.id }, transaction });
      await BlogPost.destroy({ where: { id: post.id }, transaction });
    }),
  );
  removeUploadedCover(post.coverImage);
  return post;
}

function removeUploadedCover(coverImage) {
  if (coverImage && String(coverImage).startsWith(UPLOAD_URL_PREFIX)) {
    const file = path.join(UPLOAD_DIR, path.basename(coverImage));
    fs.unlink(file, () => {});
  }
}

/* ------------------------------ treść wpisu ------------------------------ */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formatowanie w obrębie linii (tekst jest już zabezpieczony przed HTML). */
function inline(escaped) {
  return escaped
    // Obraz w tekście: ![opis](/images/... albo https://...). Tekst jest już zescapowany, więc cudzysłów nie wyjdzie z atrybutu.
    .replace(
      /!\[([^\]]*)\]\((\/(?!\/)[^\s)]*|https:\/\/[^\s)]+)\)/g,
      '<img src="$2" alt="$1" class="gv-inline-img" loading="lazy" decoding="async">',
    )
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // Linki wewnętrzne (np. do gry z katalogu: [Elden Ring](/games/123)) otwierają się w tej samej karcie.
    .replace(/\[([^\]]+)\]\((\/(?!\/)[^\s)]*)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/* --- rozszerzenia edytora (mini CMS): zdjęcia, filmy, karty gier, ramki --- */

// Adres obrazka: własny plik serwisu (/...) albo https - żadnych innych schematów (np. javascript:).
const SAFE_SRC = /^(?:\/(?!\/)[^\s"'<>]*|https:\/\/[^\s"'<>]+)$/;
const IMAGE_BLOCK = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(?:\{([a-z]+)\})?$/;
const IMAGE_ANY = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const IMAGE_LAYOUTS = new Set(['wide', 'small', 'left', 'right']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const GAME_EMBED = /^\[\[game:([A-Za-z0-9-]{1,40})\]\]$/;
const CALLOUTS = {
  INFO: { label: 'Warto wiedzieć', icon: 'bi-info-circle-fill' },
  TIP: { label: 'Wskazówka', icon: 'bi-lightbulb-fill' },
  WARNING: { label: 'Uwaga', icon: 'bi-exclamation-triangle-fill' },
  NOTE: { label: 'Notatka', icon: 'bi-journal-text' },
};

/** Zdjęcia użyte w treści: [{ alt, src }] (do oceny SEO i danych strukturalnych). */
function extractImages(content) {
  return [...String(content || '').matchAll(IMAGE_ANY)]
    .map((match) => ({ alt: match[1].trim(), src: match[2] }))
    .filter((image) => SAFE_SRC.test(image.src));
}

/** Identyfikatory gier wstawionych jako karty ([[game:ID]]). */
function collectGameEmbeds(content) {
  const ids = [];
  String(content || '')
    .split(/\n/)
    .forEach((line) => {
      const match = line.trim().match(GAME_EMBED);
      if (match && !ids.includes(match[1])) ids.push(match[1]);
    });
  return ids;
}

function figureHtml(match) {
  const [, alt, src, caption, layout] = match;
  if (!SAFE_SRC.test(src)) return `<p>${escapeHtml(alt)}</p>`;
  const size = IMAGE_LAYOUTS.has(layout) ? layout : 'center';
  const image = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
  const text = caption ? `<figcaption>${inline(escapeHtml(caption))}</figcaption>` : '';
  return `<figure class="gv-fig gv-fig-${size}"><a href="${escapeHtml(src)}" class="gv-fig-zoom" data-zoom title="Powiększ zdjęcie">${image}</a>${text}</figure>`;
}

function gameCardHtml(id, game) {
  const href = `/games/${encodeURIComponent(id)}`;
  if (!game) return `<p><a href="${href}">Zobacz grę w katalogu GameVerse</a></p>`;
  const rating = game.averageRating ? `Ocena graczy: ${game.averageRating}/5 (${game.reviewCount})` : 'Jeszcze bez ocen graczy';
  const facts = [game.platform, game.releaseYear && game.releaseYear !== 'Brak danych' ? game.releaseYear : null].filter(Boolean).join(' · ');
  return (
    `<a class="gv-gamecard" href="${href}">` +
    `<img src="${escapeHtml(game.coverImage)}" alt="Okładka gry ${escapeHtml(game.title)}" loading="lazy" decoding="async">` +
    `<span class="gv-gamecard-body"><b>${escapeHtml(game.title)}</b><small>${escapeHtml(facts)}</small><em>${escapeHtml(rating)}</em></span>` +
    `<span class="gv-gamecard-cta">Zobacz w katalogu <i class="bi bi-arrow-right"></i></span></a>`
  );
}

/**
 * Zamienia treść wpisu na bezpieczny HTML.
 * @param {string} text treść w Markdownie wpisów
 * @param {{ games?: Map<string, object> }} [options] gry do kart ([[game:ID]]) - wczytuje je trasa przed renderowaniem
 */
function renderContent(text, options = {}) {
  const games = options.games || new Map();
  const blocks = String(text || '').replace(/\r\n/g, '\n').trim().split(/\n{2,}/);

  return blocks
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trimEnd());
      const first = lines[0];
      const single = lines.length === 1 ? first.trim() : '';

      if (single && /^(?:-{3,}|\*{3,}|_{3,})$/.test(single)) return '<hr>';

      const image = single && single.match(IMAGE_BLOCK);
      if (image) return figureHtml(image);

      const video = single && single.match(/^@\[youtube\]\(([^)\s]+)\)$/);
      if (video && YOUTUBE_ID.test(video[1])) {
        return (
          `<div class="gv-embed"><iframe src="https://www.youtube-nocookie.com/embed/${video[1]}" title="Film z YouTube" ` +
          'loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>'
        );
      }

      const embed = single && single.match(GAME_EMBED);
      if (embed) return gameCardHtml(embed[1], games.get(embed[1]));

      if (/^##\s+/.test(first)) {
        const heading = `<h2>${inline(escapeHtml(first.replace(/^##\s+/, '')))}</h2>`;
        const rest = lines.slice(1).join('\n').trim();
        return rest ? `${heading}<p>${inline(escapeHtml(rest)).replace(/\n/g, '<br>')}</p>` : heading;
      }
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inline(escapeHtml(line.replace(/^[-*]\s+/, '')))}</li>`).join('')}</ul>`;
      }
      if (lines.every((line) => /^\d+\.\s+/.test(line))) {
        return `<ol>${lines.map((line) => `<li>${inline(escapeHtml(line.replace(/^\d+\.\s+/, '')))}</li>`).join('')}</ol>`;
      }
      if (lines.every((line) => /^>\s?/.test(line))) {
        const quoted = lines.map((line) => line.replace(/^>\s?/, ''));
        const callout = quoted[0].match(/^\[!(INFO|TIP|WARNING|NOTE)\]\s*(.*)$/i);
        if (callout) {
          const kind = CALLOUTS[callout[1].toUpperCase()];
          const body = [callout[2], ...quoted.slice(1)].join('\n').trim();
          return (
            `<aside class="gv-callout gv-callout-${callout[1].toLowerCase()}"><i class="bi ${kind.icon}"></i>` +
            `<div><b>${kind.label}</b><p>${inline(escapeHtml(body)).replace(/\n/g, '<br>')}</p></div></aside>`
          );
        }
        return `<blockquote>${inline(escapeHtml(quoted.join('\n'))).replace(/\n/g, '<br>')}</blockquote>`;
      }
      return `<p>${inline(escapeHtml(lines.join('\n'))).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

/**
 * Wpis jako czysty Markdown (adres /blog/ID.md) - wygodny dla modeli językowych i czytników:
 * bez menu, skryptów i stylów, za to z metadanymi na górze.
 */
function postToMarkdown(post, url) {
  const date = (value) => new Date(value).toISOString().slice(0, 10);
  const lines = [`# ${post.title}`, ''];
  lines.push(`- Autor: ${post.author}`);
  lines.push(`- Opublikowano: ${date(post.publishedAt)}${post.updatedAt ? ` (aktualizacja: ${date(post.updatedAt)})` : ''}`);
  lines.push(`- Kategoria: ${post.category}`);
  if (post.tags.length) lines.push(`- Tagi: ${post.tags.join(', ')}`);
  lines.push(`- Czas czytania: ok. ${post.readMinutes} min`);
  if (url) lines.push(`- Adres: ${url}`);
  // Linki wewnętrzne w wersji Markdown muszą być bezwzględne, bo plik czyta się poza serwisem.
  const origin = url ? new URL(url).origin : '';
  const body = String(post.content || '').trim().replace(/\]\(\/(?!\/)/g, `](${origin}/`);
  lines.push('', `> ${String(post.excerpt || '').replace(/\s+/g, ' ').trim()}`, '', body, '');
  return lines.join('\n');
}

module.exports = {
  extractImages,
  collectGameEmbeds,
  postToMarkdown,
  CATEGORIES,
  DEFAULT_CATEGORY,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  parseTags,
  tagKey,
  postState,
  countTags,
  getAllPosts,
  countPosts,
  COVER_PLACEHOLDER,
  UPLOAD_DIR,
  UPLOAD_URL_PREFIX,
  getPosts,
  findPost,
  savePost,
  removePost,
  removeUploadedCover,
  renderContent,
};
