/**
 * Udostępnia widokom dane potrzebne do znaczników SEO / Open Graph (views/partials/head.ejs):
 * adres serwisu, adres kanoniczny bieżącej strony i informację, czy strona ma być ukryta przed
 * wyszukiwarkami (panel admina, logowanie, ustawienia, czat, wyniki wyszukiwania).
 */
const { siteBase, absoluteUrl, jsonLd } = require('../utils/seo');

const NOINDEX_PREFIXES = ['/admin', '/auth', '/profile', '/chat', '/notifications', '/reports', '/search'];

function seoLocals(req, res, next) {
  const base = siteBase(req);
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  const page = parseInt(req.query.page, 10);

  res.locals.siteUrl = base;
  res.locals.absoluteUrl = (value) => absoluteUrl(base, value);
  res.locals.jsonLd = jsonLd;
  // Filtry i sortowanie w adresie nie tworzą osobnych stron - kanoniczny jest adres bez nich (poza numerem strony).
  res.locals.canonicalUrl = `${base}${path}${page > 1 ? `?page=${page}` : ''}`;
  res.locals.noindex = NOINDEX_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  next();
}

module.exports = seoLocals;
