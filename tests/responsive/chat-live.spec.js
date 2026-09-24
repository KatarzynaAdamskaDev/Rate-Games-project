const { test, expect } = require('@playwright/test');
const { BASE_URL, USER_STATE, ADMIN_STATE, loadSeedInfo } = require('./helpers');

// Czat "na żywo" w prawdziwej przeglądarce: dwie osoby (zwykły użytkownik i administrator) w tej samej
// rozmowie, każda w osobnym kontekście przeglądarki - to, co jedna zrobi, druga ma zobaczyć BEZ odświeżania
// strony (SSE, zob. utils/chatEvents.js i public/js/chat-core.js). Testy idą po kolei, bo dzielą jedną rozmowę.
test.describe.configure({ mode: 'serial' });

test.describe('czat na żywo (dwie osoby)', () => {
  let userCtx;
  let adminCtx;
  let user; // strona zwykłego użytkownika
  let admin; // strona administratora
  const stamp = Date.now().toString(36);

  // Dymek z DOKŁADNIE tą treścią (sam tekst wiadomości - cytat w odpowiedzi też ją zawiera, więc nie szukamy w całym dymku).
  const bubble = (page, text) =>
    page.locator('#chatBody .gv-msg').filter({ has: page.locator('.gv-mc-text', { hasText: text }) });

  async function say(page, text) {
    const input = page.locator('#chatText');
    await input.fill(text);
    await input.press('Enter');
    await expect(bubble(page, text)).toBeVisible();
  }

  test.beforeAll(async ({ browser }) => {
    const seed = loadSeedInfo();
    userCtx = await browser.newContext({ baseURL: BASE_URL, storageState: USER_STATE, viewport: { width: 1280, height: 900 } });
    adminCtx = await browser.newContext({ baseURL: BASE_URL, storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    user = await userCtx.newPage();
    admin = await adminCtx.newPage();
    await Promise.all([user.goto(`/chat?c=${seed.conversationId}`), admin.goto(`/chat?c=${seed.conversationId}`)]);
    // Strumień zdarzeń musi być już otwarty po obu stronach, zanim zaczniemy pisać.
    await Promise.all([
      user.waitForFunction(() => window.GVChat && window.GVChat.Stream.isOpen()),
      admin.waitForFunction(() => window.GVChat && window.GVChat.Stream.isOpen()),
    ]);
  });

  test.afterAll(async () => {
    await userCtx.close();
    await adminCtx.close();
  });

  test('wiadomość od drugiej osoby pojawia się bez odświeżania strony', async () => {
    await say(admin, `Na żywo od admina ${stamp}`);
    await expect(bubble(user, `Na żywo od admina ${stamp}`)).toBeVisible({ timeout: 5000 });
  });

  test('"pisze..." pokazuje się drugiej osobie i znika po wysłaniu', async () => {
    const typing = user.locator('.gv-typing');
    await admin.locator('#chatText').pressSequentially('pisze cos dlugiego', { delay: 30 });
    await expect(typing).toContainText('responsywnyadmin pisze', { timeout: 5000 });

    await admin.locator('#chatText').press('Enter');
    await expect(typing).not.toContainText('pisze', { timeout: 5000 });
  });

  test('odpowiedź jak w Messengerze: cytat pod spodem, klik w cytat przewija do oryginału', async () => {
    const original = `Pytanie ${stamp}`;
    await say(admin, original);
    await expect(bubble(user, original)).toBeVisible({ timeout: 5000 });

    await bubble(user, original).hover();
    await bubble(user, original).locator('.gv-mc-action-reply').click();
    await expect(user.locator('.gv-composer-context')).toContainText('Odpowiadasz: responsywnyadmin');
    await say(user, `Odpowiedź ${stamp}`);

    const reply = bubble(admin, `Odpowiedź ${stamp}`);
    await expect(reply).toBeVisible({ timeout: 5000 });
    await expect(reply.locator('.gv-mc-quote')).toContainText(original);
    await expect(user.locator('.gv-composer-context')).toBeHidden(); // pasek odpowiedzi znika po wysłaniu

    await reply.locator('.gv-mc-quote').click();
    await expect(bubble(admin, original)).toHaveClass(/gv-mc-flash/);
  });

  test('czytanie starszych wiadomości: nowa wiadomość nie przewija widoku, tylko pokazuje przycisk "Nowe wiadomości"', async () => {
    // Trochę treści, żeby lista dało się przewijać.
    for (const i of [1, 2, 3]) await say(admin, `Wypełniacz ${i} ${stamp}`);
    await expect(bubble(user, `Wypełniacz 3 ${stamp}`)).toBeVisible({ timeout: 5000 });

    await admin.locator('#chatBody').evaluate((el) => { el.scrollTop = 0; });
    await say(user, `Nowa poza ekranem ${stamp}`);

    const pill = admin.locator('.gv-new-pill');
    await expect(pill).toBeVisible({ timeout: 5000 });
    await pill.click();
    await expect(pill).toBeHidden();
    await expect(bubble(admin, `Nowa poza ekranem ${stamp}`)).toBeInViewport();
  });

  test('reakcje: dodanie przez okienko, widoczne u drugiej osoby, zdjęcie tą samą', async () => {
    const text = `Reaguj ${stamp}`;
    await say(user, text);
    await expect(bubble(admin, text)).toBeVisible({ timeout: 5000 });

    await bubble(admin, text).hover();
    await bubble(admin, text).locator('.gv-mc-action-react').click();
    await admin.locator('.gv-react-pop-btn[title="Ogień"]').click();

    const chipOnUser = bubble(user, text).locator('.gv-mc-reaction');
    await expect(chipOnUser).toHaveCount(1, { timeout: 5000 });
    await expect(chipOnUser).toHaveAttribute('title', /Ogień: responsywnyadmin/);
    // Każda reakcja ma własny kolor (ogień = pomarańcz), a okienko wyboru ma duże, kolorowe przyciski.
    await expect(chipOnUser.locator('i')).toHaveCSS('color', 'rgb(255, 122, 46)');
    await bubble(admin, text).hover();
    await bubble(admin, text).locator('.gv-mc-action-react').click();
    const firstChoice = admin.locator('.gv-react-pop-btn').first();
    await expect(firstChoice).toHaveCSS('width', '40px');
    await expect(firstChoice).toHaveCSS('color', 'rgb(91, 157, 255)');
    await admin.keyboard.press('Escape');
    await expect(admin.locator('.gv-react-pop')).toHaveCount(0);

    await bubble(admin, text).locator('.gv-mc-reaction').click(); // klik w swoją reakcję ją zdejmuje
    await expect(chipOnUser).toHaveCount(0, { timeout: 5000 });
  });

  test('edycja i usunięcie własnej wiadomości są widoczne na żywo', async () => {
    const original = `Do edycji ${stamp}`;
    await say(user, original);
    await expect(bubble(admin, original)).toBeVisible({ timeout: 5000 });

    await bubble(user, original).hover();
    await bubble(user, original).locator('.gv-mc-action-edit').click();
    await expect(user.locator('.gv-composer-context')).toContainText('Edytujesz wiadomość');
    await expect(user.locator('#chatText')).toHaveValue(original);
    await user.locator('#chatText').fill(`Po edycji ${stamp}`);
    await user.locator('#chatText').press('Enter');

    const editedOnAdmin = bubble(admin, `Po edycji ${stamp}`);
    await expect(editedOnAdmin).toBeVisible({ timeout: 5000 });
    await expect(editedOnAdmin).toContainText('edytowano');
    await expect(bubble(admin, original)).toHaveCount(0);

    user.once('dialog', (dialog) => dialog.accept());
    await bubble(user, `Po edycji ${stamp}`).hover();
    await bubble(user, `Po edycji ${stamp}`).locator('.gv-mc-action-delete').click();

    const gone = admin.locator('#chatBody .gv-msg.gv-mc-gone');
    await expect(gone.last()).toContainText('Wiadomość została usunięta', { timeout: 5000 });
    await expect(admin.locator('#chatBody')).not.toContainText(`Po edycji ${stamp}`);
  });

  test('mini czat w navbarze: wiadomość na żywo, emoji i odpowiedź z dowolnej strony', async () => {
    // Strona czatu użytkownika musi być zamknięta - inaczej sama oznaczałaby nową wiadomość jako przeczytaną
    // i plakietka w navbarze nigdy by się nie pojawiła.
    await user.close();
    const page = await userCtx.newPage();
    await page.goto('/games');
    await page.waitForFunction(() => window.GVChat && window.GVChat.Stream.isOpen());

    // Zamknięty mini czat pokazuje plakietkę z nieprzeczytanymi zaraz po wiadomości drugiej osoby.
    await say(admin, `Do mini czatu ${stamp}`);
    await expect(page.locator('#navChatBadge')).toBeVisible({ timeout: 5000 });

    await page.locator('#navChatBtn').click();
    await page.locator('#navChatList .nav-chat-item').first().click();
    const mini = page.locator('#navChatMessages .nav-msg', { hasText: `Do mini czatu ${stamp}` });
    await expect(mini).toBeVisible();

    // emoji z panelu trafia do pola, a wysłana wiadomość - do drugiej osoby
    await page.locator('#navChatComposer .nav-chat-tool').first().click();
    await page.locator('#navChatComposer .gv-emoji-btn').first().click();
    const input = page.locator('#navChatComposer input[type="text"]');
    await input.pressSequentially(` z mini czatu ${stamp}`);
    await input.press('Enter');
    await expect(bubble(admin, `z mini czatu ${stamp}`)).toBeVisible({ timeout: 5000 });

    // odpowiedź na wiadomość z poziomu mini czatu
    await mini.hover();
    await mini.locator('.gv-mc-action-reply').click();
    await input.fill(`Odp z mini ${stamp}`);
    await input.press('Enter');
    await expect(bubble(admin, `Odp z mini ${stamp}`).locator('.gv-mc-quote')).toContainText(`Do mini czatu ${stamp}`, { timeout: 5000 });
    await page.close();
  });
});
