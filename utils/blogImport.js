/**
 * Przenoszenie wpisów bloga z plików JSON do bazy danych.
 *
 * Dawniej wpisy leżały w pliku data/blog.json. Teraz są w tabeli blog_posts, a przy pierwszym starcie
 * (pusta tabela) aplikacja sama je stamtąd wczytuje:
 *   1. data/blog.json      - dawny magazyn (jeśli jeszcze istnieje na dysku),
 *   2. data/blog.seed.json - dwa wpisy startowe dołączone do projektu (świeża instalacja).
 * Znacznik w site_settings pilnuje, żeby import zrobił się tylko raz: po usunięciu wszystkich wpisów
 * kolejny start nie przywraca ich z pliku.
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const BlogPost = require('../models/BlogPost');
const SiteSetting = require('../models/SiteSetting');
const { savePost, countPosts, parseTags } = require('./blogHelpers');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEGACY_FILE = path.join(DATA_DIR, 'blog.json');
const SEED_FILE = path.join(DATA_DIR, 'blog.seed.json');
const SEEDED_KEY = 'blog:seeded';

/** Wpisy z pliku JSON albo null, gdy pliku nie ma. */
function readPostsFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const parsed = JSON.parse(raw || '[]');
  if (!Array.isArray(parsed)) throw new Error(`Plik ${file} nie zawiera listy wpisów.`);
  return parsed;
}

const validDate = (value) => (value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : null);

/**
 * Zapisuje wpisy z listy do bazy. Wpis o istniejącym id jest pomijany (chyba że overwrite: true),
 * więc import można bezpiecznie powtarzać.
 * @returns {{ imported: number, skipped: number }}
 */
async function importPosts(list, { overwrite = false } = {}) {
  let imported = 0;
  let skipped = 0;
  for (const raw of list) {
    if (!raw || !String(raw.title || '').trim()) {
      skipped += 1;
      continue;
    }
    const id = String(raw.id || uuidv4()).slice(0, 64);
    if (!overwrite && (await BlogPost.findByPk(id, { attributes: ['id'] }))) {
      skipped += 1;
      continue;
    }
    await savePost({
      ...raw,
      id,
      tags: parseTags(raw.tags),
      createdAt: validDate(raw.createdAt) || new Date().toISOString(),
      updatedAt: validDate(raw.updatedAt),
      publishAt: validDate(raw.publishAt),
    });
    imported += 1;
  }
  return { imported, skipped };
}

/** Przy pierwszym starcie z pustą tabelą wczytuje wpisy z pliku (zob. opis na górze). Zwraca liczbę wczytanych. */
async function seedBlogIfEmpty() {
  if (await SiteSetting.findByPk(SEEDED_KEY)) return 0;

  if ((await countPosts()) > 0) {
    await SiteSetting.upsert({ key: SEEDED_KEY, value: '1' });
    return 0;
  }

  for (const file of [LEGACY_FILE, SEED_FILE]) {
    const list = readPostsFile(file);
    if (!list) continue;
    const { imported } = await importPosts(list);
    await SiteSetting.upsert({ key: SEEDED_KEY, value: '1' });
    console.log(`[blog] wczytano ${imported} wpisów z pliku ${path.basename(file)} do bazy danych.`);
    return imported;
  }
  return 0;
}

module.exports = { LEGACY_FILE, SEED_FILE, readPostsFile, importPosts, seedBlogIfEmpty };
