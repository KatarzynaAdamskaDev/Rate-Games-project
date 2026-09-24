const { test, expect } = require('@playwright/test');
const { VIEWPORTS, loadSeedInfo, expectNoHorizontalOverflow } = require('./helpers');

// Strony publiczne (bez logowania) - dla każdej sprawdzamy, że się renderuje i nie ma
// poziomego przewijania na żadnej z typowych szerokości ekranu (telefon -> duży desktop).
// Ścieżki zależą od danych dogranych przez serwer testowy (seed-and-start.js), więc liczymy je w teście.
const PAGES = [
  { name: 'Strona główna', path: () => '/' },
  { name: 'Lista gier', path: () => '/games' },
  { name: 'Szczegóły gry', path: (seed) => `/games/${seed.gameId}` },
  { name: 'Recenzje', path: () => '/reviews' },
  { name: 'Blog', path: () => '/blog' },
  { name: 'Wpis na blogu', path: (seed) => `/blog/${seed.blogPostId}` },
  { name: 'Profil publiczny', path: (seed) => `/${seed.username}` },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const p of PAGES) {
      test(`${p.name}: renderuje się bez poziomego przewijania`, async ({ page }) => {
        const url = p.path(loadSeedInfo());
        const response = await page.goto(url);
        expect(response.status(), `${url} powinno odpowiedzieć 200`).toBe(200);
        await expectNoHorizontalOverflow(page, `${p.name} (${url})`);
      });
    }
  });
}
