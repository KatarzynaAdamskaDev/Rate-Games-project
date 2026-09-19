/**
 * Wpisy bloga (plik data/blog.json): odczyt, zapis, kategorie oraz bezpieczne
 * renderowanie treści z prostym formatowaniem.
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

/** Dopełnia pola, których nie mają starsze wpisy (kategoria, czas czytania). */
function normalizePost(post) {
  const content = String(post.content || '');
  return {
    ...post,
    category: CATEGORIES.includes(post.category) ? post.category : DEFAULT_CATEGORY,
    coverImage: post.coverImage || COVER_PLACEHOLDER,
    excerpt: post.excerpt || content.slice(0, 140),
    readMinutes: Math.max(1, Math.round(content.split(/\s+/).filter(Boolean).length / 200)),
  };
}

function getPosts() {
  return readCollection('blog')
    .map(normalizePost)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function findPost(id) {
  return getPosts().find((post) => post.id === id) || null;
}

/** Zapisuje nowy albo istniejący wpis (po id). */
function savePost(post) {
  const posts = readCollection('blog');
  const index = posts.findIndex((p) => p.id === post.id);
  // readMinutes liczymy na bieżąco, więc nie zapisujemy go w pliku.
  const { readMinutes, ...toStore } = post;
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

module.exports = {
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
};
