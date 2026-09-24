const { test, expect } = require('@playwright/test');
const { VIEWPORTS, USER_STATE, ADMIN_STATE, loadSeedInfo, expectNoHorizontalOverflow } = require('./helpers');

// Strony dostępne tylko po zalogowaniu - własny profil, czat, panel admina.
// Sesje są zapisane raz w global-setup.js (storageState) - nie logujemy się w każdym teście.
for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height} (${viewport.name})`, () => {
    test.describe('zwykły użytkownik', () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, storageState: USER_STATE });

      test('Własny profil: bez poziomego przewijania', async ({ page }) => {
        await page.goto('/profile');
        await expectNoHorizontalOverflow(page, 'Własny profil');
      });

      test('Czat: bez poziomego przewijania', async ({ page }) => {
        await page.goto(`/chat?c=${loadSeedInfo().conversationId}`);
        await expectNoHorizontalOverflow(page, 'Czat');
      });

      // Okno czatu ma overflow:hidden, więc sam test przewijania strony nie wykryje, że coś jest
      // ucięte - dlatego osobno sprawdzamy, że pole wiadomości i przycisk wysyłania są w całości na ekranie.
      test('Czat: pole wiadomości i przycisk wysyłania mieszczą się w ekranie', async ({ page }) => {
        await page.goto(`/chat?c=${loadSeedInfo().conversationId}`);
        for (const selector of ['#chatText', '.gv-chat-send', '#emojiBtn', '#gifBtn']) {
          const box = await page.locator(selector).boundingBox();
          expect(box, `${selector} powinien mieć wymiary`).not.toBeNull();
          expect(box.x, `${selector}: lewa krawędź`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, `${selector}: prawa krawędź`).toBeLessThanOrEqual(viewport.width);
        }
      });
    });

    test.describe('administrator', () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height }, storageState: ADMIN_STATE });

      test('Panel admina (pulpit): bez poziomego przewijania', async ({ page }) => {
        await page.goto('/admin');
        await expectNoHorizontalOverflow(page, 'Panel admina');
      });

      test('Panel admina (opinie): bez poziomego przewijania', async ({ page }) => {
        await page.goto('/admin/survey');
        await expectNoHorizontalOverflow(page, 'Panel admina - Opinie');
      });
    });
  });
}

const MODAL_VIEWPORTS = [
  { name: 'telefon-375', width: 375, height: 812 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

// Modal "Napisz recenzję" - największy/najbardziej złożony modal w serwisie (dwuetapowy,
// wyszukiwarka + gwiazdki), więc sprawdzamy go osobno na telefonie i desktopie.
test.describe('Modal "Napisz recenzję"', () => {
  test.use({ storageState: USER_STATE });

  for (const viewport of MODAL_VIEWPORTS) {
    test(`${viewport.name}: mieści się na ekranie i nie powoduje przewijania`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
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

// Panel emoji w czacie (osobna, niedawno przebudowana karta nad polem wiadomości) - sprawdzamy,
// że na telefonie też mieści się w ekranie, a nie tylko na desktopie.
test.describe('Czat: panel emoji', () => {
  test.use({ storageState: USER_STATE });

  for (const viewport of MODAL_VIEWPORTS) {
    test(`${viewport.name}: panel mieści się w ekranie`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/chat?c=${loadSeedInfo().conversationId}`);

      await page.locator('#emojiBtn').click();
      const picker = page.locator('#emojiPicker');
      await expect(picker).toBeVisible();

      const box = await picker.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      await expectNoHorizontalOverflow(page, `Panel emoji (${viewport.name})`);
    });
  }
});
