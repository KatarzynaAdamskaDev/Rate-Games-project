/**
 * Wspólne narzędzia dla testów responsywności - szerokości ekranu dobrane pod realne breakpointy
 * strony (zob. public/css/style.css i app-extra.css: rdzeń 480/768/1024, a menu hamburgera
 * przełącza się realnie przy 980px - patrz views/partials/navbar.ejs + app-extra.css @980px).
 */
const path = require('path');
const fs = require('fs');

const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;
// Zapisane sesje zalogowanych kont (tests/responsive/global-setup.js) - logujemy się raz na całą serię
// testów, bo /auth/signin ma limit prób z jednego IP (middleware/rateLimit.js, 20/15 min).
const AUTH_DIR = path.join(__dirname, '.auth');
const USER_STATE = path.join(AUTH_DIR, 'user.json');
const ADMIN_STATE = path.join(AUTH_DIR, 'admin.json');

const VIEWPORTS = [
  // Najwęższy telefon: daje zapas na CI (Linux) - tam czcionka pikselowa wychodzi o kilka pikseli szersza niż na Windowsie,
  // więc układ, który mieści się "na styk" przy 375 px, na serwerze CI potrafi się przelać.
  { name: 'telefon-320', width: 320, height: 640 },
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
  // Mierzymy dopiero po załadowaniu czcionek (Press Start 2P jest szeroka) - inaczej wynik zależałby od tego,
  // czy czcionka zdążyła się podmienić przed pomiarem (na CI bywa inaczej niż lokalnie). Limit 4 s na wypadek braku sieci.
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 4000))]));

  const overflow = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const offenders = [];
    const describe = (node) => `${node.tagName.toLowerCase()}${node.className ? '.' + String(node.className).trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    if (scrollWidth > clientWidth + 1) {
      document.querySelectorAll('body *').forEach((el) => {
        const rect = el.getBoundingClientRect();
        // Elementy w przewijanych kontenerach (np. karuzela gier) celowo wychodzą poza ekran - pomijamy je.
        let parent = el.parentElement;
        let scrollable = false;
        while (parent && parent !== document.body) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') { scrollable = true; break; }
          parent = parent.parentElement;
        }
        if (!scrollable && rect.width > 0 && rect.right > clientWidth + 1) {
          // Sam znacznik i klasa nie wystarczają, żeby znaleźć winowajcę w logu CI - dodajemy szerokość, tekst i rodziców.
          const chain = [];
          for (let node = el.parentElement; node && chain.length < 3 && node !== document.body; node = node.parentElement) chain.push(describe(node));
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
          offenders.push(`${describe(el)} "${text}" (szer. ${Math.round(rect.width)}px, prawa krawędź ${Math.round(rect.right)}px, w: ${chain.join(' < ')})`);
        }
      });
    }
    const fontLoaded = document.fonts.check('12px "Press Start 2P"');
    return { scrollWidth, clientWidth, fontLoaded, offenders: offenders.slice(0, 5) };
  });
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(
      `${context || 'Strona'}: poziome przewijanie - scrollWidth=${overflow.scrollWidth}px > clientWidth=${overflow.clientWidth}px ` +
        `(czcionka Press Start 2P załadowana: ${overflow.fontLoaded ? 'tak' : 'NIE'}). ` +
        `Winne elementy: ${overflow.offenders.join('; ') || '(nie udało się wskazać)'}`
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

module.exports = {
  PORT,
  BASE_URL,
  AUTH_DIR,
  USER_STATE,
  ADMIN_STATE,
  VIEWPORTS,
  MOBILE_NAV_BREAKPOINT,
  loadSeedInfo,
  expectNoHorizontalOverflow,
  login,
};
