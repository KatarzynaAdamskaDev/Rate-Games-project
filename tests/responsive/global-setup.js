const fs = require('fs');
const { chromium } = require('@playwright/test');
const { BASE_URL, AUTH_DIR, USER_STATE, ADMIN_STATE, loadSeedInfo, login } = require('./helpers');

// Loguje się raz jako zwykły użytkownik i raz jako admin, zapisując sesje do plików -
// testy z authenticated.spec.js tylko je wczytują (test.use({ storageState })), zamiast logować się
// w każdym teście osobno i wyczerpywać limit prób logowania z jednego IP.
module.exports = async function globalSetup() {
  const seed = loadSeedInfo();
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const account of [
      { username: seed.username, password: seed.password, file: USER_STATE },
      { username: seed.adminUsername, password: seed.adminPassword, file: ADMIN_STATE },
    ]) {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();
      await login(page, account.username, account.password);
      await context.storageState({ path: account.file });
      await context.close();
    }
  } finally {
    await browser.close();
  }
};
