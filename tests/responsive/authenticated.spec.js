const { test, expect } = require('@playwright/test');
const { VIEWPORTS, loadSeedInfo, expectNoHorizontalOverflow, login } = require('./helpers');

const seed = loadSeedInfo();

// Strony dostępne tylko po zalogowaniu - własny profil, czat, panel admina.
for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height} (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('Własny profil: bez poziomego przewijania', async ({ page }) => {
      await login(page, seed.username, seed.password);
      await page.goto('/profile');
      await expectNoHorizontalOverflow(page, 'Własny profil');
    });

    test('Czat: bez poziomego przewijania', async ({ page }) => {
      await login(page, seed.username, seed.password);
      await page.goto(`/chat?c=${seed.conversationId}`);
      await expectNoHorizontalOverflow(page, 'Czat');
    });

    test('Panel admina (pulpit): bez poziomego przewijania', async ({ page }) => {
      await login(page, seed.adminUsername, seed.adminPassword);
      await page.goto('/admin');
      await expectNoHorizontalOverflow(page, 'Panel admina');
    });
  });
}

// Modal "Napisz recenzję" (strona główna) - osobno sprawdzamy telefon i desktop, bo to
// największy/najbardziej złożony modal w serwisie (dwuetapowy, wyszukiwarka + gwiazdki).
test.describe('Modal "Napisz recenzję"', () => {
  for (const viewport of [
    { name: 'telefon-375', width: 375, height: 812 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ]) {
    test(`${viewport.name}: mieści się na ekranie i nie powoduje przewijania`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page, seed.username, seed.password);
      await page.goto('/');

      await page.locator('[data-bs-target="#writeReviewModal"]').first().click();
      const modal = page.locator('#writeReviewModal .modal-dialog');
      await expect(modal).toBeVisible();

      const box = await modal.boundingBox();
      expect(box, 'modal powinien mieć wymiary').not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);

      await expectNoHorizontalOverflow(page, `Modal "Napisz recenzję" (${viewport.name})`);
    });
  }
});

// Panel emoji/GIF w czacie - nowy, wcześniej zgłoszony jako "słabo widać" (zob. historia zmian) -
// sprawdzamy, że na telefonie też mieści się w ekranie, a nie tylko na desktopie.
test.describe('Czat: panel GIF/emoji', () => {
  for (const viewport of [
    { name: 'telefon-375', width: 375, height: 812 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ]) {
    test(`${viewport.name}: panel emoji mieści się w ekranie`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page, seed.username, seed.password);
      await page.goto(`/chat?c=${seed.conversationId}`);

      const emojiBtn = page.locator('#emojiBtn');
      await emojiBtn.click();
      const picker = page.locator('#emojiPicker');
      await expect(picker).toBeVisible();

      const box = await picker.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      await expectNoHorizontalOverflow(page, `Panel emoji (${viewport.name})`);
    });
  }
});
