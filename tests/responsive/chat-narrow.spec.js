const { test, expect } = require('@playwright/test');
const { USER_STATE, loadSeedInfo } = require('./helpers');

// Czat na wąskich ekranach: albo lista rozmów, albo otwarta rozmowa. Wcześniej lista była na stałe ukryta
// (display: none), więc na telefonie i małym oknie nie dało się ani wybrać rozmowy, ani wyszukać gracza,
// ani założyć grupy, ani zobaczyć zaproszeń.
const NARROW = [
  { name: 'telefon-375', width: 375, height: 812 },
  { name: 'telefon-480', width: 480, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'okno-960', width: 960, height: 900 },
];
const WIDE = [
  { name: 'laptop-1024', width: 1024, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

test.use({ storageState: USER_STATE });

for (const vp of NARROW) {
  test(`${vp.name}: lista rozmów jest dostępna (wyszukiwarka graczy, nowa grupa), rozmowa ma przycisk powrotu`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const seed = loadSeedInfo();

    // Bez wybranej rozmowy widać LISTĘ - to tu pisze się do gracza, zakłada grupy i odpowiada na zaproszenia.
    await page.goto('/chat');
    const search = page.locator('#dmUsername');
    await expect(search).toBeVisible();
    const box = await search.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    await search.fill('ktos');
    await expect(search).toHaveValue('ktos');
    await expect(page.getByRole('button', { name: '+ Nowa grupa' })).toBeVisible();
    await expect(page.locator('#chatBody')).toBeHidden();

    // Wybór rozmowy z listy otwiera ją; lista się chowa, a przycisk powrotu wraca do listy.
    await page.locator(`#dmConversationList a[href="/chat?c=${seed.conversationId}"]`).click();
    await expect(page.locator('#chatText')).toBeVisible();
    await expect(page.locator('#chatListCol')).toBeHidden();
    const back = page.locator('.gv-chat-topbar .gv-chat-back');
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.locator('#dmUsername')).toBeVisible();
    await expect(page.locator('#chatBody')).toBeHidden();
  });
}

for (const vp of WIDE) {
  test(`${vp.name}: lista i rozmowa obok siebie, bez przycisku powrotu`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/chat?c=${loadSeedInfo().conversationId}`);
    await expect(page.locator('#dmUsername')).toBeVisible();
    await expect(page.locator('#chatBody')).toBeVisible();
    await expect(page.locator('.gv-chat-topbar .gv-chat-back')).toBeHidden();
  });
}
