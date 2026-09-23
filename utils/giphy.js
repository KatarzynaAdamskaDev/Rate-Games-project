/**
 * Wyszukiwarka GIF-ów do czatu (Giphy). Host docelowy jest na stałe wpisany w kodzie
 * (api.giphy.com), więc w przeciwieństwie do utils/mediaFinder.js nie ma tu ryzyka SSRF
 * przez sterowanie adresem - jedyne, co pochodzi od użytkownika, to treść wyszukiwania.
 * Adresy zwracanych GIF-ów sprawdzamy dodatkowo przy wysyłaniu wiadomości (routes/chat.js),
 * żeby nikt nie mógł podesłać w wiadomości linku spoza CDN Giphy.
 */
const axios = require('axios');

const SEARCH_URL = () => process.env.GIPHY_API_URL || 'https://api.giphy.com/v1/gifs/search';
const MAX_RESULTS = 24;

/** Adresy CDN Giphy, z których wolno wysyłać GIF-y na czacie. */
function isGiphyCdnUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'giphy.com' || host.endsWith('.giphy.com');
  } catch (err) {
    return false;
  }
}

/** Szuka GIF-ów pasujących do zapytania. Zwraca [] (nigdy nie rzuca), jeśli klucz brakuje albo Giphy nie odpowiada. */
async function searchGifs(query) {
  const q = String(query || '').trim().slice(0, 100);
  const apiKey = process.env.GIPHY_API_KEY;
  if (!q || !apiKey) return [];

  try {
    const response = await axios.get(SEARCH_URL(), {
      params: {
        api_key: apiKey,
        q,
        limit: MAX_RESULTS,
        rating: 'pg-13',
        lang: 'pl',
      },
      timeout: 8000,
    });

    return (response.data && response.data.data ? response.data.data : [])
      .map((item) => {
        const images = item.images || {};
        const send = images.fixed_height || images.original;
        const preview = images.fixed_height_small || images.preview_gif || send;
        if (!send || !send.url || !preview || !preview.url) return null;
        if (!isGiphyCdnUrl(send.url) || !isGiphyCdnUrl(preview.url)) return null;
        return {
          id: String(item.id),
          title: item.title || 'GIF',
          previewUrl: preview.url,
          url: send.url,
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error('[Giphy] BŁĄD: wyszukiwanie GIF-ów nie powiodło się:', error.response ? error.response.data : error.message);
    return [];
  }
}

module.exports = { searchGifs, isGiphyCdnUrl };
