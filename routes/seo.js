/**
 * Wyszukiwarki i asystenci AI (SEO + GEO):
 *   /robots.txt      - zasady dla robotów; jawnie wpuszczamy crawlery modeli językowych (ChatGPT, Claude,
 *                      Perplexity, Gemini...), żeby mogły czytać i cytować serwis,
 *   /sitemap.xml     - mapa strony,
 *   /llms.txt        - zwięzły opis serwisu i najważniejszych stron w Markdown (standard llmstxt.org),
 *   /llms-full.txt   - pełniejsza wersja: fakty, FAQ, popularne gry i treść wpisów bloga,
 *   /feed.xml        - kanał RSS bloga.
 * Zawartość wynika z prawdziwych danych serwisu (utils/siteFacts.js, baza, blog) - nic nie jest zmyślone.
 */
const express = require('express');
const { fn, col } = require('sequelize');
const router = express.Router();

const Review = require('../models/Review');
const CustomGame = require('../models/CustomGame');
const { getPosts, renderContent, postToMarkdown } = require('../utils/blogHelpers');
const { getPopularPool } = require('../utils/gamePopularity');
const { formatIGDBGame } = require('../utils/igdbService');
const { SITE, FEATURES, FAQ, PAGES, getSiteStats } = require('../utils/siteFacts');
const { siteBase, isoDate, plainText } = require('../utils/seo');

const CACHE_MS = 10 * 60 * 1000;
const MAX_URLS = 50000;
const LLMS_GAMES = 25;
const LLMS_FULL_GAMES = 60;
const LLMS_FULL_POSTS = 30;
const FEED_ITEMS = 30;

// Strony, których nie ma sensu indeksować (panel, konta, wyniki wyszukiwania).
const DISALLOWED = ['/admin', '/auth', '/profile', '/chat', '/notifications', '/reports', '/search'];

// Crawlery i agenci asystentów AI. Chcemy, żeby serwis był w ich odpowiedziach, więc wpuszczamy je wszystkie
// (poza stronami prywatnymi). Grupa z konkretną nazwą zastępuje grupę "*", stąd powtórzone Disallow.
const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', // OpenAI (ChatGPT)
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai', // Anthropic (Claude)
  'PerplexityBot', 'Perplexity-User', // Perplexity
  'Google-Extended', // Gemini / AI Overviews
  'Applebot-Extended', // Apple Intelligence
  'Meta-ExternalAgent', 'Meta-ExternalFetcher', // Meta AI
  'DuckAssistBot', 'MistralAI-User', 'cohere-ai', 'YouBot', 'Amazonbot', 'CCBot',
];

const cache = new Map(); // klucz -> { value, at }

async function cached(key, build) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await build();
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Wymusza odbudowanie mapy strony, kanału i plików llms przy następnym żądaniu (np. po opublikowaniu wpisu). */
function resetSitemapCache() {
  cache.clear();
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const dateOnly = (value) => new Date(value).toISOString().slice(0, 10);
const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/* ------------------------------ robots.txt ------------------------------ */

router.get('/robots.txt', (req, res) => {
  const base = siteBase(req);
  const rules = [...DISALLOWED.map((path) => `Disallow: ${path}`), 'Allow: /'];
  const lines = [
    '# GameVerse - polskojęzyczny serwis o grach wideo.',
    '# Roboty wyszukiwarek i asystentów AI są mile widziane: opis serwisu dla modeli językowych jest w /llms.txt.',
    '',
    'User-agent: *',
    ...rules,
    '',
    ...AI_CRAWLERS.flatMap((agent) => [`User-agent: ${agent}`, ...rules, '']),
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ];
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(lines.join('\n'));
});

/* ------------------------------ sitemap.xml ------------------------------ */

async function collectUrls(base) {
  const urls = new Map(); // adres -> { lastmod, changefreq, priority }
  const add = (path, { lastmod, changefreq = 'weekly', priority = '0.5' } = {}) => {
    const loc = `${base}${path}`;
    if (!urls.has(loc)) urls.set(loc, { lastmod: lastmod ? isoDate(lastmod) : undefined, changefreq, priority });
  };

  const posts = getPosts();
  add('/', { changefreq: 'daily', priority: '1.0' });
  add('/games', { changefreq: 'daily', priority: '0.9' });
  add('/reviews', { changefreq: 'daily', priority: '0.8' });
  add('/blog', { lastmod: posts[0] && (posts[0].updatedAt || posts[0].publishedAt), changefreq: 'daily', priority: '0.8' });
  add('/aboutus', { changefreq: 'monthly', priority: '0.7' });
  add('/help', { changefreq: 'monthly', priority: '0.7' });

  posts.forEach((post) => {
    add(`/blog/${encodeURIComponent(post.id)}`, {
      lastmod: post.updatedAt || post.publishedAt,
      changefreq: 'monthly',
      priority: '0.7',
    });
  });

  // Gry, o których napisano recenzje, mają unikalną treść - dajemy im najwyższy priorytet spośród gier.
  const reviewed = await Review.findAll({
    attributes: ['gameId', [fn('MAX', col('createdAt')), 'lastReview']],
    group: ['gameId'],
    raw: true,
  });
  reviewed.forEach((row) => {
    add(`/games/${encodeURIComponent(row.gameId)}`, { lastmod: row.lastReview, changefreq: 'weekly', priority: '0.8' });
  });

  const custom = await CustomGame.findAll({ attributes: ['id', 'updatedAt'] });
  custom.forEach((game) => {
    add(`/games/${encodeURIComponent(game.id)}`, { lastmod: game.updatedAt, changefreq: 'monthly', priority: '0.6' });
  });

  const pool = await getPopularPool();
  if (pool) {
    pool.games.forEach((game) => add(`/games/${game.id}`, { changefreq: 'monthly', priority: '0.6' }));
  }

  return [...urls.entries()].slice(0, MAX_URLS);
}

function buildXml(entries) {
  const items = entries
    .map(([loc, meta]) => {
      const lines = [`    <loc>${escapeXml(loc)}</loc>`];
      if (meta.lastmod) lines.push(`    <lastmod>${meta.lastmod}</lastmod>`);
      lines.push(`    <changefreq>${meta.changefreq}</changefreq>`, `    <priority>${meta.priority}</priority>`);
      return `  <url>\n${lines.join('\n')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = siteBase(req);
    const xml = await cached(`sitemap:${base}`, async () => buildXml(await collectUrls(base)));
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ llms.txt ------------------------------ */

/** Popularne gry z opisem i średnią oceną graczy GameVerse (jeśli ktoś je już ocenił). */
async function popularGamesWithRatings(limit) {
  const pool = await getPopularPool();
  if (!pool) return [];

  const games = pool.games.slice(0, limit).map(formatIGDBGame);
  const ratings = await Review.findAll({
    attributes: ['gameId', [fn('AVG', col('rating')), 'average'], [fn('COUNT', col('id')), 'total']],
    where: { gameId: games.map((game) => String(game.id)) },
    group: ['gameId'],
    raw: true,
  });
  const byGame = new Map(ratings.map((row) => [String(row.gameId), row]));

  return games.map((game) => {
    const row = byGame.get(String(game.id));
    return {
      ...game,
      averageRating: row ? Math.round(Number(row.average) * 10) / 10 : null,
      reviewCount: row ? Number(row.total) : 0,
    };
  });
}

function gameLine(base, game, withDescription) {
  const facts = [game.category, game.platform, game.releaseYear !== 'Brak danych' ? game.releaseYear : null]
    .filter(Boolean)
    .join(', ');
  const rating = game.averageRating ? `; ocena graczy GameVerse: ${game.averageRating}/5 (${game.reviewCount} recenzji)` : '';
  const summary = withDescription && game.description && !/^Brak opisu/.test(game.description)
    ? ` ${plainText(game.description, 220)}`
    : '';
  return `- [${game.title}](${base}/games/${game.id}): ${facts}${rating}.${summary}`;
}

async function buildLlmsTxt(base) {
  const [games, stats] = await Promise.all([popularGamesWithRatings(LLMS_GAMES), getSiteStats()]);
  const posts = getPosts().slice(0, 10);

  const lines = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.summary}`,
    '',
    `${SITE.description}`,
    '',
    `Adres serwisu: ${base}. Język treści: polski. ${SITE.audience}`,
    '',
    '## Najważniejsze strony',
    ...PAGES.map((page) => `- [${page.title}](${base}${page.path}): ${page.text}`),
    '',
    '## Co wyróżnia GameVerse',
    ...FEATURES.map((feature) => `- **${feature.title}.** ${feature.text}`),
    '',
    '## Fakty do zacytowania',
    '- Katalog obejmuje ponad 300 tysięcy gier z bazy IGDB; oceny i recenzje pochodzą od użytkowników GameVerse.',
    '- Oceny wystawia się co pół gwiazdki, w skali od 0,5 do 5; do jednej gry każdy użytkownik dodaje jedną recenzję.',
    `- Stan na ${dateOnly(stats.at)}: ${stats.users} użytkowników, ${stats.reviews} recenzji, ${stats.ratedGames} ocenionych gier, ${stats.blogPosts} wpisów na blogu.`,
    '- Sortowanie „Popularne” opiera się na danych o graczach z IGDB (grają teraz, zagrali, popularność na Steamie).',
    '',
    '## Popularne gry w katalogu',
    ...games.map((game) => gameLine(base, game, false)),
    '',
    '## Najnowsze wpisy na blogu',
    ...(posts.length
      ? posts.map((post) => `- [${post.title}](${base}/blog/${post.id}): ${oneLine(post.excerpt)} (${dateOnly(post.publishedAt)}; wersja Markdown: ${base}/blog/${post.id}.md)`)
      : ['- Brak opublikowanych wpisów.']),
    '',
    '## Dla robotów i agentów',
    `- [Mapa strony](${base}/sitemap.xml)`,
    `- [Kanał RSS bloga](${base}/feed.xml)`,
    `- [Pełniejszy opis dla modeli językowych](${base}/llms-full.txt): fakty, FAQ, popularne gry i treść wpisów.`,
    '- Każdy wpis bloga jest dostępny jako czysty Markdown pod adresem /blog/ID.md.',
    '',
  ];
  return lines.join('\n');
}

async function buildLlmsFullTxt(base) {
  const [games, stats] = await Promise.all([popularGamesWithRatings(LLMS_FULL_GAMES), getSiteStats()]);
  const posts = getPosts().slice(0, LLMS_FULL_POSTS);

  const lines = [
    `# ${SITE.name} - pełny opis dla modeli językowych`,
    '',
    `> ${SITE.summary}`,
    '',
    SITE.description,
    '',
    `Adres: ${base}. Język: polski. Odbiorcy: ${SITE.audience}`,
    '',
    '## Funkcje',
    ...FEATURES.flatMap((feature) => [`### ${feature.title}`, feature.text, '']),
    '## GameVerse w liczbach',
    `Stan na ${dateOnly(stats.at)}:`,
    `- użytkownicy: ${stats.users}`,
    `- recenzje graczy: ${stats.reviews}`,
    `- ocenione gry: ${stats.ratedGames}`,
    `- wpisy na blogu: ${stats.blogPosts}`,
    '- gry w katalogu: ponad 300 tysięcy (IGDB)',
    '',
    '## Najczęstsze pytania',
    ...FAQ.flatMap((item) => [`### ${item.q}`, item.a, '']),
    '## Popularne gry',
    'Kolejność wynika z rankingu popularności (dane o graczach z IGDB). Oceny pochodzą od użytkowników GameVerse.',
    ...games.map((game) => gameLine(base, game, true)),
    '',
    '## Wpisy na blogu',
    ...(posts.length
      ? posts.flatMap((post) => [postToMarkdown(post, `${base}/blog/${post.id}`).replace(/^# /, '### '), '---', ''])
      : ['Brak opublikowanych wpisów.', '']),
  ];
  return lines.join('\n');
}

function sendText(res, text) {
  res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(text);
}

router.get('/llms.txt', async (req, res, next) => {
  try {
    const base = siteBase(req);
    sendText(res, await cached(`llms:${base}`, () => buildLlmsTxt(base)));
  } catch (err) {
    next(err);
  }
});

router.get('/llms-full.txt', async (req, res, next) => {
  try {
    const base = siteBase(req);
    sendText(res, await cached(`llms-full:${base}`, () => buildLlmsFullTxt(base)));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ feed.xml (RSS) ------------------------------ */

function buildFeed(base) {
  const posts = getPosts().slice(0, FEED_ITEMS);
  const cdata = (html) => `<![CDATA[${String(html).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

  const items = posts
    .map((post) => {
      const link = `${base}/blog/${encodeURIComponent(post.id)}`;
      const cover = post.coverImage.startsWith('http') ? post.coverImage : `${base}${post.coverImage}`;
      // W kanale RSS adresy muszą być bezwzględne (czytnik nie zna adresu serwisu).
      const body = renderContent(post.content).replace(/(src|href)="\/(?!\/)/g, `$1="${base}/`);
      const html = `<p><img src="${cover}" alt="${escapeXml(post.title)}"></p>\n${body}`;
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${link}</link>`,
        `      <guid isPermaLink="true">${link}</guid>`,
        `      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>`,
        `      <dc:creator>${escapeXml(post.author)}</dc:creator>`,
        `      <category>${escapeXml(post.category)}</category>`,
        ...post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
        `      <description>${escapeXml(oneLine(post.excerpt))}</description>`,
        `      <content:encoded>${cdata(html)}</content:encoded>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const newest = posts[0] ? new Date(posts[0].updatedAt || posts[0].publishedAt) : new Date();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>GameVerse - Blog</title>
    <link>${base}/blog</link>
    <description>Aktualności, poradniki i zestawienia od redakcji GameVerse.</description>
    <language>pl</language>
    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>
    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

router.get('/feed.xml', async (req, res, next) => {
  try {
    const base = siteBase(req);
    const xml = await cached(`feed:${base}`, async () => buildFeed(base));
    res.type('application/rss+xml; charset=utf-8').set('Cache-Control', 'public, max-age=1800').send(xml);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.resetSitemapCache = resetSitemapCache;
