/**
 * Podpowiedzi do formularza ręcznego dodawania gry: wyszukiwanie po tytule w IGDB
 * (platformy, rok, kategoria, opis, miniatura) i bezpieczne pobranie okładki.
 */
const axios = require('axios');
const { GAME_TYPE_FILTER } = require('./igdbService');
const { smartSearch, cleanTerm } = require('./gameSearch');
const { mapIgdbPlatforms } = require('./gameFormOptions');

const RESULT_LIMIT = 8;
const MIN_QUERY = 2;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_HOST = 'https://images.igdb.com/igdb/image/upload';
const COVER_ID_PATTERN = /^[a-z0-9]{5,40}$/;

const FIELDS =
  'fields name, cover.image_id, summary, genres.name, platforms.name, first_release_date, total_rating_count;';

/** Adres okładki budujemy wyłącznie z identyfikatora obrazu - do pobrania trafia tylko host IGDB. */
function coverUrl(imageId, size) {
  return `${COVER_HOST}/${size}/${imageId}.jpg`;
}

function isValidCoverId(value) {
  return typeof value === 'string' && COVER_ID_PATTERN.test(value);
}

/** Identyfikator obrazu okładki: z pola image_id albo z adresu (gry z rankingu popularności mają tylko adres). */
function coverIdOf(game) {
  if (!game.cover) return null;
  const fromUrl = String(game.cover.url || '').match(/\/([a-z0-9]+)\.(?:jpg|png|webp)$/);
  const id = game.cover.image_id || (fromUrl && fromUrl[1]);
  return isValidCoverId(id) ? id : null;
}

function toResult(game) {
  const imageId = coverIdOf(game);
  return {
    id: game.id,
    title: game.name || '',
    year: game.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : null,
    category: game.genres && game.genres.length > 0 ? game.genres[0].name : '',
    platforms: mapIgdbPlatforms(game.platforms),
    description: String(game.summary || '').trim().slice(0, 2000),
    coverId: imageId,
    thumb: imageId ? coverUrl(imageId, 't_cover_small') : null,
    cover: imageId ? coverUrl(imageId, 't_cover_big') : null,
  };
}

/**
 * Szuka gier po tytule - także po skrócie ("CS2", "gta5") i początku nazwy ("minecr"),
 * patrz utils/gameSearch.js.
 * @returns {Promise<object[]>}
 */
async function searchGames(input) {
  const q = cleanTerm(input);
  if (q.length < MIN_QUERY) return [];

  const rows = await smartSearch(q, { fields: FIELDS, where: ['version_parent = null', GAME_TYPE_FILTER] });
  return rows.slice(0, RESULT_LIMIT).map(toResult).filter((game) => game.title);
}

/** Pobiera okładkę z IGDB jako bufor (do sprawdzenia i zmniejszenia przez sanitizeImage). */
async function downloadCover(imageId) {
  if (!isValidCoverId(imageId)) throw new Error('Niepoprawny identyfikator okładki.');
  const response = await axios.get(coverUrl(imageId, 't_cover_big'), {
    responseType: 'arraybuffer',
    timeout: 8000,
    maxRedirects: 0,
    maxContentLength: MAX_COVER_BYTES,
    maxBodyLength: MAX_COVER_BYTES,
  });
  return Buffer.from(response.data);
}

module.exports = { MIN_QUERY, searchGames, downloadCover, isValidCoverId, coverUrl };
