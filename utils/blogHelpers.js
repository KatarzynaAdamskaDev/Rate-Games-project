/**
 * Wpisy bloga (plik data/blog.json): odczyt, zapis, kategorie, tagi, szkice i zaplanowana publikacja
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
const { readCollection, writeCollection } = require('./dataStore');

const COVER_PLACEHOLDER = '/images/game-placeholder.svg';
const UPLOAD_URL_PREFIX = '/images/blog/uploads/';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'images', 'blog', 'uploads');

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
    const tag = String(item).replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
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
    readMinutes: Math.max(1, Math.round(content.split(/\s+/).filter(Boolean).length / 200)),
  };
}

/** Wszystkie wpisy, także szkice i zaplanowane (dla administratora), od najnowszych. */
function getAllPosts() {
  return readCollection('blog')
    .map(normalizePost)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

/** Wpisy widoczne dla wszystkich: opublikowane i takie, których termin już minął. */
function getPosts() {
  return getAllPosts().filter((post) => post.state === 'published');
}

/** Wpis po id w dowolnym stanie (do edycji i podglądu przez administratora). */
function findPost(id) {
  return getAllPosts().find((post) => post.id === id) || null;
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

/** Zapisuje nowy albo istniejący wpis (po id). */
function savePost(post) {
  const posts = readCollection('blog');
  const index = posts.findIndex((p) => p.id === post.id);
  // Pola wyliczane przy odczycie (czas czytania, stan, data publikacji) nie trafiają do pliku.
  const { readMinutes, state, publishedAt, ...toStore } = post;
  if (index === -1) posts.push(toStore);
  else posts[index] = toStore;
  writeCollection('blog', posts);
}

/** Usuwa wpis wraz z wgraną okładką (okładki podane jako adres zostają bez zmian). */
function removePost(id) {
  const posts = readCollection('blog');
  const post = posts.find((p) => p.id === id);
  if (!post) return null;
  writeCollection('blog', posts.filter((p) => p.id !== id));
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
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // Linki wewnętrzne (np. do gry z katalogu: [Elden Ring](/games/123)) otwierają się w tej samej karcie.
    .replace(/\[([^\]]+)\]\((\/(?!\/)[^\s)]*)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/** Zamienia treść wpisu na bezpieczny HTML. */
function renderContent(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').trim().split(/\n{2,}/);

  return blocks
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trimEnd());
      const first = lines[0];

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
        return `<blockquote>${inline(escapeHtml(lines.map((line) => line.replace(/^>\s?/, '')).join('\n'))).replace(/\n/g, '<br>')}</blockquote>`;
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
