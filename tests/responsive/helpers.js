/**
 * Wspólne narzędzia dla testów responsywności - szerokości ekranu dobrane pod realne breakpointy
 * strony (zob. public/css/style.css i app-extra.css: rdzeń 480/768/1024, a menu hamburgera
 * przełącza się realnie przy 980px - patrz views/partials/navbar.ejs + app-extra.css @980px).
 */
const path = require('path');
const fs = require('fs');

const VIEWPORTS = [
  { name: 'telefon-375', width: 375, height: 812 },
  { name: 'telefon-480', width: 480, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'tablet-980', width: 980, height: 1024 },
  { name: 'laptop-1024', width: 1024, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

const MOBILE_NAV_BREAKPOINT = 980;

function loadSeedInfo() {
  const seedPath = path.join(__dirname, 'seed-info.json');
  if (!fs.existsSync(seedPath)) {
    throw new Error('Brak seed-info.json - webServer (tests/responsive/seed-and-start.js) jeszcze nie przygotował danych testowych.');
  }
  return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
}

/** Brak poziomego przewijania strony - najczęstszy, ogólny objaw zepsutej responsywności. */
async function expectNoHorizontalOverflow(page, context) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(
      `${context || 'Strona'}: poziome przewijanie - scrollWidth=${overflow.scrollWidth}px > clientWidth=${overflow.clientWidth}px`
    );
  }
}

// Formularz logowania jest obsługiwany przez AJAX (public/js/main.js) - po sukcesie robi
// window.location.reload(), co na /auth/signin przekierowuje dalej (ensureGuest, routes/auth.js).
async function login(page, username, password) {
  await page.goto('/auth/signin');
  const form = page.locator('form[action="/auth/signin"]');
  await form.locator('#identifier').fill(username);
  await form.locator('#password').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/auth')),
    form.locator('button[type="submit"]').click(),
  ]);
}

module.exports = { VIEWPORTS, MOBILE_NAV_BREAKPOINT, loadSeedInfo, expectNoHorizontalOverflow, login };
