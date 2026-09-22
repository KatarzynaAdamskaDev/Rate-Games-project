/**
 * Wyszukiwanie darmowych zdjęć i filmów do artykułów pisanych przez pomocnika.
 *
 * Zdjęcia: tylko na wolnych licencjach (CC0, domena publiczna, CC BY, CC BY-SA) z Wikimedia Commons i Openverse -
 * razem z autorem, licencją i adresem źródła (do podpisu i sekcji źródeł). Licencje NC/ND są odrzucane.
 * Opcjonalnie zrzuty ekranu z IGDB (to materiały wydawców, nie wolna licencja - włącza je autor świadomie).
 * Filmy: osadzenia YouTube (odtwarzacz YouTube, tryb prywatności) - najpierw filmy powiązane z grą w IGDB (zwykle
 * oficjalne zwiastuny), a przy kluczu YOUTUBE_API_KEY także wyszukiwanie. Każdy film jest sprawdzany przez oEmbed YouTube
 * (istnieje, jest publiczny i pozwala na osadzanie).
 *
 * Pobieranie plików jest zabezpieczone: tylko https z dozwolonych hostów, limit rozmiaru i czasu, ręczna obsługa
 * przekierowań i odrzucanie adresów prywatnych (SSRF).
 */
const dns = require('dns').promises;
const net = require('net');
const sharp = require('sharp');

const OPENVERSE_URL = () => process.env.OPENVERSE_URL || 'https://api.openverse.org/v1/images/';
const COMMONS_URL = () => process.env.COMMONS_API_URL || 'https://commons.wikimedia.org/w/api.php';
const OEMBED_URL = () => process.env.YOUTUBE_OEMBED_URL || 'https://www.youtube.com/oembed';
const YOUTUBE_SEARCH_URL = () => process.env.YOUTUBE_API_URL || 'https://www.googleapis.com/youtube/v3/search';

const BASE_HOSTS = [
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'api.openverse.org',
  'live.staticflickr.com',
  'images.igdb.com',
];
// Dodatkowe hosty (tylko operator serwera, np. w testach): "host" albo "host:port"; dla nich nie sprawdzamy adresów prywatnych.
const extraHosts = () => String(process.env.MEDIA_EXTRA_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const USER_AGENT = () => `GameVerseBlog/1.0 (${process.env.SITE_URL || 'blog o grach'}; pomocnik pisania)`;
const MIN_WIDTH = 800;

/* ------------------------------ bezpieczne pobieranie ------------------------------ */

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('::ffff:');
}

function isExtraHost(url) {
  const extra = extraHosts();
  return extra.includes(url.host.toLowerCase()) || extra.includes(url.hostname.toLowerCase());
}

function hostAllowed(url) {
  const host = url.hostname.toLowerCase();
  return isExtraHost(url) || BASE_HOSTS.includes(host) || host.endsWith('.staticflickr.com');
}

/** Sprawdza, czy z adresu wolno pobierać: https, dozwolony host, publiczny adres IP. */
async function assertSafeUrl(url) {
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && isExtraHost(url)))) throw new Error('niedozwolony protokół');
  if (!hostAllowed(url)) throw new Error(`niedozwolony host: ${url.hostname}`);
  if (isExtraHost(url)) return;
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw new Error('adres prywatny');
}

/** Pobiera obraz (do 8 MB), z ręczną obsługą przekierowań i sprawdzaniem typu. @returns {Promise<Buffer>} */
async function fetchImageBuffer(rawUrl, { maxBytes = MAX_DOWNLOAD_BYTES, timeoutMs = 20000, hops = 3 } = {}) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= hops; hop += 1) {
    await assertSafeUrl(url);
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT(), Accept: 'image/*,*/*;q=0.5' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!/^image\/(?:jpeg|png|webp|gif)/i.test(response.headers.get('content-type') || '')) throw new Error('nieobsługiwany typ pliku');
    if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('plik za duży');

    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('plik za duży');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('zbyt wiele przekierowań');
}

async function getJson(rawUrl, { timeoutMs = 15000 } = {}) {
  const response = await fetch(rawUrl, { headers: { 'User-Agent': USER_AGENT(), Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/* ------------------------------ licencje ------------------------------ */

const LICENSE_OK = /^(?:CC0|Domena publiczna|Public domain|PD(?:[- ]|$)|CC BY(?:-SA)? \d)/i;

/** Czy licencja pozwala na użycie w artykule (wolne licencje z uznaniem autorstwa; bez NC i ND). */
function licenseAllowed(label) {
  const text = String(label || '').trim();
  return LICENSE_OK.test(text) && !/\b(?:NC|ND)\b/i.test(text);
}

function openverseLicense(code, version) {
  const key = String(code || '').toLowerCase();
  if (key === 'cc0') return 'CC0 1.0';
  if (key === 'pdm') return 'Domena publiczna (PDM 1.0)';
  if (key === 'by') return `CC BY ${version || ''}`.trim();
  if (key === 'by-sa') return `CC BY-SA ${version || ''}`.trim();
  return '';
}

const stripHtml = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/* ------------------------------ zdjęcia: wyszukiwanie ------------------------------ */

async function searchOpenverse(query, limit = 8) {
  const url = new URL(OPENVERSE_URL());
  url.searchParams.set('q', query);
  url.searchParams.set('license', 'cc0,pdm,by,by-sa');
  url.searchParams.set('mature', 'false');
  url.searchParams.set('page_size', String(limit));
  url.searchParams.set('extension', 'jpg,jpeg,png,webp');
  const data = await getJson(url);
  return (data.results || []).map((item) => ({
    provider: 'openverse',
    id: `ov:${item.id}`,
    title: stripHtml(item.title) || 'Bez tytułu',
    thumbUrl: item.thumbnail || item.url,
    downloadUrl: item.url,
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    license: openverseLicense(item.license, item.license_version),
    licenseUrl: item.license_url || '',
    author: stripHtml(item.creator),
    sourceUrl: item.foreign_landing_url || item.url,
    origin: item.source || 'openverse',
  }));
}

async function searchCommons(query, limit = 8) {
  const url = new URL(COMMONS_URL());
  const params = {
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1600',
    format: 'json',
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const data = await getJson(url);
  return Object.values((data.query && data.query.pages) || {})
    .map((page) => {
      const info = page.imageinfo && page.imageinfo[0];
      if (!info || !/^image\/(?:jpeg|png|webp)$/.test(info.mime || '')) return null;
      const meta = info.extmetadata || {};
      const value = (key) => (meta[key] ? stripHtml(meta[key].value) : '');
      if (/^true$/i.test(value('NonFree'))) return null;
      const width = info.width || 0;
      return {
        provider: 'commons',
        id: `wc:${page.pageid || page.title}`,
        title: stripHtml(String(page.title || '').replace(/^File:/i, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ')),
        thumbUrl: info.thumburl || info.url,
        downloadUrl: width > 1600 && info.thumburl ? info.thumburl : info.url,
        width,
        height: info.height || 0,
        license: value('LicenseShortName'),
        licenseUrl: value('LicenseUrl'),
        author: value('Artist') || value('Credit'),
        sourceUrl: info.descriptionurl || info.url,
        origin: 'wikimedia_commons',
      };
    })
    .filter(Boolean);
}

/** Kandydaci zdjęć do jednego zapytania: wolne licencje, dozwolone hosty, sensowny rozmiar i proporcje. */
async function findImageCandidates(query, { limit = 4 } = {}) {
  const settled = await Promise.allSettled([searchOpenverse(query, 8), searchCommons(query, 8)]);
  const lists = settled.map((result) => (result.status === 'fulfilled' ? result.value : []));
  const seen = new Set();
  const merged = [];
  // Na przemian z obu źródeł, żeby wynik nie zależał od jednego z nich.
  for (let i = 0; i < 8; i += 1) {
    lists.forEach((list) => {
      if (list[i]) merged.push(list[i]);
    });
  }
  return merged
    .filter((item) => {
      if (!item.downloadUrl || !item.thumbUrl || seen.has(item.downloadUrl)) return false;
      seen.add(item.downloadUrl);
      let host;
      try { host = new URL(item.downloadUrl); } catch (err) { return false; }
      const ratio = item.height ? item.width / item.height : 0;
      return hostAllowed(host) && licenseAllowed(item.license) && item.width >= MIN_WIDTH && ratio >= 0.55 && ratio <= 2.6;
    })
    .slice(0, limit);
}

/** Miniatura do oceny przez model (JPEG do 512 px, base64). */
async function thumbnailBase64(candidate) {
  const source = await fetchImageBuffer(candidate.thumbUrl, { maxBytes: 6 * 1024 * 1024, timeoutMs: 15000 });
  const jpeg = await sharp(source, { limitInputPixels: 60e6 }).rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  return jpeg.toString('base64');
}

/* ------------------------------ IGDB: zrzuty ekranu i filmy gier ------------------------------ */

/** Filmy i zrzuty ekranu gier z IGDB: Map(id gry -> { name, videos: [{ name, videoId }], screenshots: [{ url, thumbUrl, width, height }] }). */
async function igdbMedia(gameIds) {
  const ids = gameIds.map(String).filter((id) => /^\d{1,12}$/.test(id));
  const result = new Map();
  if (!ids.length) return result;
  try {
    const { fetchIGDBGames } = require('./igdbService');
    const rows = await fetchIGDBGames(`fields name, videos.name, videos.video_id, screenshots.image_id, screenshots.width, screenshots.height; where id = (${ids.join(',')}); limit ${ids.length};`);
    rows.forEach((row) => {
      result.set(String(row.id), {
        name: row.name || '',
        videos: (row.videos || []).filter((video) => /^[A-Za-z0-9_-]{11}$/.test(video.video_id || '')).map((video) => ({ name: video.name || '', videoId: video.video_id })),
        screenshots: (row.screenshots || []).filter((shot) => shot.image_id).map((shot) => ({
          url: `https://images.igdb.com/igdb/image/upload/t_1080p/${shot.image_id}.jpg`,
          thumbUrl: `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${shot.image_id}.jpg`,
          width: shot.width || 1920,
          height: shot.height || 1080,
        })),
      });
    });
  } catch (err) {
    console.error('[pomocnik pisania] IGDB (filmy i zrzuty):', err.message);
  }
  return result;
}

/* ------------------------------ YouTube ------------------------------ */

/** Sprawdza film przez oEmbed: istnieje, jest publiczny i pozwala na osadzanie. @returns {Promise<{ id, title, author }|null>} */
async function checkYoutube(videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const url = new URL(OEMBED_URL());
    url.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
    url.searchParams.set('format', 'json');
    const data = await getJson(url, { timeoutMs: 10000 });
    return { id: videoId, title: String(data.title || '').trim(), author: String(data.author_name || '').trim() };
  } catch (err) {
    return null;
  }
}

/** Wyszukiwanie filmów w YouTube Data API (wymaga YOUTUBE_API_KEY): tylko osadzalne, bezpieczne, publiczne. */
async function searchYoutube(query, { limit = 5 } = {}) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  try {
    const url = new URL(YOUTUBE_SEARCH_URL());
    Object.entries({
      part: 'snippet', type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true', safeSearch: 'strict',
      maxResults: String(limit), q: query, relevanceLanguage: 'pl', key,
    }).forEach(([name, value]) => url.searchParams.set(name, value));
    const data = await getJson(url);
    return (data.items || [])
      .filter((item) => item.id && /^[A-Za-z0-9_-]{11}$/.test(item.id.videoId || ''))
      .map((item) => ({ videoId: item.id.videoId, name: (item.snippet && item.snippet.title) || '' }));
  } catch (err) {
    console.error('[pomocnik pisania] YouTube API:', err.message);
    return [];
  }
}

const TRAILER = /trailer|zwiastun|launch|official|overview|gameplay|reveal/i;

/**
 * Wybiera film do artykułu: najpierw z IGDB (gry z zadania), potem z wyszukiwarki YouTube (jeśli jest klucz).
 * @param {{ media: Map, gameNames: string[], topic: string }} input
 * @returns {Promise<{ id, title, author, source }|null>}
 */
async function pickVideo({ media, gameNames = [], topic = '' }) {
  const candidates = [];
  media.forEach((entry) => {
    const sorted = [...entry.videos].sort((a, b) => Number(TRAILER.test(b.name)) - Number(TRAILER.test(a.name)));
    sorted.slice(0, 3).forEach((video) => candidates.push({ ...video, source: 'igdb' }));
  });
  if (candidates.length < 2) {
    const subject = gameNames[0] || topic;
    if (subject) {
      const tokens = subject.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 4);
      (await searchYoutube(`${subject} official trailer`)).forEach((video) => {
        const title = video.name.toLowerCase();
        if (!tokens.length || tokens.some((token) => title.includes(token))) candidates.push({ ...video, source: 'youtube' });
      });
    }
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.videoId)) continue;
    seen.add(candidate.videoId);
    if (seen.size > 5) break;
    const checked = await checkYoutube(candidate.videoId);
    if (checked) return { ...checked, source: candidate.source };
  }
  return null;
}

module.exports = {
  licenseAllowed,
  isPrivateIp,
  assertSafeUrl,
  fetchImageBuffer,
  searchOpenverse,
  searchCommons,
  findImageCandidates,
  thumbnailBase64,
  igdbMedia,
  checkYoutube,
  searchYoutube,
  pickVideo,
};
