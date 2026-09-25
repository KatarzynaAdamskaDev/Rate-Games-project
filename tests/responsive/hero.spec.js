const { test, expect } = require('@playwright/test');

// Baner na stronie głównej (hero): na wąskich ekranach karta ma się mieścić w ekranie, a czcionki maleć razem z nim.
// Wcześniej animacja przesuwała kartę na stałe o 156 px w prawo (poza ekran na telefonie), a reguły ".hero h1"/".hero p"
// wygrywały z zapytaniami @media - czcionka się nie zmniejszała i baner zajmował więcej niż cały ekran.
const WIDTHS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 480, height: 900 },
  { width: 768, height: 1024 },
  { width: 980, height: 900 },
  { width: 1024, height: 800 },
];

async function measureHero(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  // Karta wjeżdża animacją - mierzymy dopiero po jej zakończeniu.
  await page.waitForFunction(() => {
    const card = document.querySelector('.gv-hero-card');
    return card && getComputedStyle(card).opacity === '1' && getComputedStyle(card).animationName !== 'none' && card.getAnimations().every((a) => a.playState === 'finished');
  });
  return page.evaluate(() => {
    const card = document.querySelector('.gv-hero-card').getBoundingClientRect();
    return {
      cardLeft: card.left,
      cardRight: card.right,
      heroHeight: document.querySelector('.gv-hero').getBoundingClientRect().height,
      titleSize: parseFloat(getComputedStyle(document.querySelector('.gv-hero-title')).fontSize),
      textSize: parseFloat(getComputedStyle(document.querySelector('.gv-hero-text')).fontSize),
    };
  });
}

for (const viewport of WIDTHS) {
  test(`${viewport.width}px: karta banera mieści się w ekranie i nie jest wyższa niż ekran`, async ({ page }) => {
    const hero = await measureHero(page, viewport);
    expect(hero.cardLeft, 'lewa krawędź karty').toBeGreaterThanOrEqual(0);
    expect(hero.cardRight, 'prawa krawędź karty').toBeLessThanOrEqual(viewport.width + 1);
    expect(hero.heroHeight, 'wysokość banera').toBeLessThan(viewport.height);
  });
}

test('czcionki banera maleją razem z ekranem (nagłówek i opis)', async ({ page }) => {
  const sizes = [];
  for (const viewport of [WIDTHS[1], WIDTHS[3], WIDTHS[4]]) {
    sizes.push({ width: viewport.width, ...(await measureHero(page, viewport)) });
  }
  const [phone, tablet, laptop] = sizes;
  expect(phone.titleSize).toBeLessThan(tablet.titleSize);
  expect(tablet.titleSize).toBeLessThan(laptop.titleSize);
  expect(phone.textSize).toBeLessThan(laptop.textSize);
  // na telefonie nagłówek jest wyraźnie mniejszy niż dawne 34 px
  expect(phone.titleSize).toBeLessThanOrEqual(16);
});

test('desktop (powyżej 1100 px): karta nadal jest przesunięta, żeby odsłonić okładki po lewej', async ({ page }) => {
  const hero = await measureHero(page, { width: 1280, height: 800 });
  expect(hero.cardLeft).toBeGreaterThan(100);
  expect(hero.cardRight).toBeLessThanOrEqual(1280);
});
