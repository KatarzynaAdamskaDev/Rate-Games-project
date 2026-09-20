/**
 * Strony informacyjne: "O GameVerse" (/aboutus) i "Pomoc" (/help). Treść bierzemy z utils/siteFacts.js - tam
 * jest jedno źródło prawdy o serwisie, z którego korzystają też dane strukturalne i pliki dla modeli językowych.
 */
const express = require('express');
const router = express.Router();

const { SITE, FEATURES, FAQ, getSiteStats } = require('../utils/siteFacts');
const { organizationLd, breadcrumbLd } = require('../utils/seo');

router.get('/aboutus', async (req, res, next) => {
  try {
    const base = res.locals.siteUrl;
    const stats = await getSiteStats();
    const url = `${base}/aboutus`;

    res.render('pages/about', {
      title: 'O GameVerse',
      site: SITE,
      features: FEATURES,
      stats,
      seo: {
        title: 'O GameVerse - serwis dla graczy z ocenami i recenzjami gier',
        description: SITE.description,
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'AboutPage',
            name: 'O GameVerse',
            url,
            inLanguage: SITE.language,
            description: SITE.description,
            about: { '@id': `${base}/#organization` },
          },
          organizationLd(base, SITE),
          breadcrumbLd(base, [
            { name: 'GameVerse', path: '/' },
            { name: 'O GameVerse', path: '/aboutus' },
          ]),
        ],
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/help', (req, res) => {
  const base = res.locals.siteUrl;

  res.render('pages/help', {
    title: 'Pomoc i najczęstsze pytania',
    faq: FAQ,
    seo: {
      title: 'Pomoc i najczęstsze pytania (FAQ) - GameVerse',
      description:
        'Jak oceniać gry, pisać recenzje, szukać tytułów, zdobywać poziomy i odznaki oraz jak GameVerse dba o jakość opinii - odpowiedzi na najczęstsze pytania.',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          inLanguage: SITE.language,
          mainEntity: FAQ.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        },
        breadcrumbLd(base, [
          { name: 'GameVerse', path: '/' },
          { name: 'Pomoc', path: '/help' },
        ]),
      ],
    },
  });
});

module.exports = router;
