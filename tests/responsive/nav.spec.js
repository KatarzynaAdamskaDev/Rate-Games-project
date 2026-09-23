const { test, expect } = require('@playwright/test');
const { MOBILE_NAV_BREAKPOINT } = require('./helpers');

// Menu w navbarze (views/partials/navbar.ejs) chowa się do hamburgera przy <=980px -
// zob. app-extra.css @media (max-width: 980px) "header.site .hamburger-menu/.main-nav"
// (nadpisuje starszą regułę @768px w style.css wyższą specyficznością selektora).
test.describe('Menu w navbarze', () => {
  test(`powyżej ${MOBILE_NAV_BREAKPOINT}px: pełne menu widoczne, hamburger ukryty`, async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_NAV_BREAKPOINT + 100, height: 900 });
    await page.goto('/');
    await expect(page.locator('#mainNav')).toBeVisible();
    await expect(page.locator('#hamburgerMenu')).toBeHidden();
  });

  test(`${MOBILE_NAV_BREAKPOINT}px i mniej: menu schowane, hamburger widoczny i działa`, async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_NAV_BREAKPOINT, height: 900 });
    await page.goto('/');

    const hamburger = page.locator('#hamburgerMenu');
    const mainNav = page.locator('#mainNav');

    await expect(hamburger).toBeVisible();
    await expect(mainNav).toBeHidden();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');

    await hamburger.click();
    await expect(mainNav).toBeVisible();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'true');

    // Kliknięcie poza menu je zamyka.
    await page.mouse.click(10, 10);
    await expect(mainNav).toBeHidden();
    await expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });

  test('na telefonie (375px) menu też działa i linki są klikalne', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const hamburger = page.locator('#hamburgerMenu');
    await hamburger.click();
    await expect(page.locator('#mainNav')).toBeVisible();

    const gamesLink = page.locator('#mainNav a', { hasText: 'GAMES' });
    await expect(gamesLink).toBeVisible();
    await gamesLink.click();
    await page.waitForURL('**/games');
  });
});
