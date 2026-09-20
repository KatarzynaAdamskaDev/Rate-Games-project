/**
 * Pomocnicze funkcje SEO i udostępniania: opisy do znaczników Open Graph, adresy bezwzględne.
 * Znaczniki są wypisywane w views/partials/head.ejs na podstawie obiektu `seo` przekazanego do widoku.
 */
const SITE_NAME = 'GameVerse';
const DEFAULT_DESCRIPTION =
  'GameVerse - oceniaj gry, pisz recenzje i odkrywaj tytuły polecane przez społeczność graczy.';
const DEFAULT_IMAGE = '/images/og-default.png';

/** Zwykły tekst do opisu: bez formatowania (Markdown wpisów), w jednej linii, ucięty na granicy słowa. */
function plainText(text, max = 200) {
  const clean = String(text || '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-*]|\d+\.)\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!-]+$/, '')}…`;
}

/** Adres bezwzględny: podany adres http(s) zostaje, ścieżka dostaje przed sobą adres serwisu. */
function absoluteUrl(base, value) {
  const text = String(value || '');
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('//')) return `https:${text}`;
  return `${base}${text.startsWith('/') ? '' : '/'}${text}`;
}

/** Adres serwisu bez końcowego ukośnika: SITE_URL z pliku .env albo adres z bieżącego żądania. */
function siteBase(req) {
  const configured = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

/** Bezpieczny zapis JSON-LD w znaczniku <script> (bez sekwencji, która zamknęłaby znacznik). */
function jsonLd(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/** Znacznik czasu ISO albo undefined dla niepoprawnej daty. */
function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Dane strukturalne organizacji (schema.org) - pomagają wyszukiwarkom i chatbotom rozpoznać serwis jako jedną, spójną całość. */
function organizationLd(base, site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${base}/#organization`,
    name: site.name,
    url: base,
    logo: { '@type': 'ImageObject', url: `${base}/images/Game2.png`, width: 2000, height: 2000 },
    description: site.summary,
    slogan: site.tagline,
    knowsLanguage: site.language,
  };
}

/** Okruszki (BreadcrumbList): items = [{ name, path }] od strony głównej do bieżącej. */
function breadcrumbLd(base, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(base, item.path),
    })),
  };
}

module.exports = {
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  DEFAULT_IMAGE,
  plainText,
  absoluteUrl,
  siteBase,
  jsonLd,
  isoDate,
  organizationLd,
  breadcrumbLd,
};
