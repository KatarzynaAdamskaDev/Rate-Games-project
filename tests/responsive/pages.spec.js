const { test, expect } = require('@playwright/test');
const { VIEWPORTS, loadSeedInfo, expectNoHorizontalOverflow } = require('./helpers');

const seed = loadSeedInfo();

// Strony publiczne (bez logowania) - dla każdej sprawdzamy, że się renderuje i nie ma
// poziomego przewijania na żadnej z typowych szerokości ekranu (telefon -> duży desktop).
const PAGES = [
  { name: 'Strona główna', path: '/', heading: 'GameVerse' },
  { name: 'Lista gier', path: '/games' },
  { name: 'Szczegóły gry', path: `/games/${seed.gameId}` },
  { name: 'Recenzje', path: '/reviews' },
  { name: 'Blog', path: '/blog' },
  { name: 'Wpis na blogu', path: `/blog/${seed.blogPostId}` },
  { name: 'Profil publiczny', path: `/${seed.username}` },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const p of PAGES) {
      test(`${p.name}: renderuje się bez poziomego przewijania`, async ({ page }) => {
        const response = await page.goto(p.path);
        expect(response.status(), `${p.path} powinno odpowiedzieć 200`).toBe(200);
        await expectNoHorizontalOverflow(page, `${p.name} (${p.path})`);
      });
    }
  });
}
