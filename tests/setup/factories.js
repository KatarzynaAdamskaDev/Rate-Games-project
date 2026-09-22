/**
 * Tworzenie danych testowych bezpośrednio przez modele Sequelize (szybciej i pewniej niż przez
 * formularze) oraz pomocnicy do rozmowy z aplikacją przez supertest (CSRF, logowanie).
 *
 * Wywołuj dopiero po createTestApp() - modele muszą być już podpięte pod testową bazę.
 */
const bcrypt = require('bcryptjs');
const request = require('supertest');

// Niski koszt bcrypt: w testach liczy się powtarzalność logiki logowania, nie odporność na łamanie hasła.
const BCRYPT_COST = 4;
let counter = 0;
const nextId = () => {
  counter += 1;
  return counter;
};

/** Nowy użytkownik (rola 'user' domyślnie) zapisany w bazie. Hasło jawne wraca do testu, żeby móc się zalogować. */
async function createUser(overrides = {}) {
  const User = require('../../models/User');
  const n = nextId();
  const password = overrides.password || 'HasloTest123';
  const user = await User.create({
    email: overrides.email || `tester${n}@example.test`,
    username: overrides.username || `tester${n}`,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    role: overrides.role || 'user',
    friends: '[]',
    ...overrides.attrs,
  });
  return { user, password };
}

/** Jak createUser, ale z rolą 'admin'. */
function createAdmin(overrides = {}) {
  return createUser({ ...overrides, role: 'admin' });
}

/** Gra dodana "ręcznie" (custom_games) - w przeciwieństwie do gier z IGDB nie wymaga żadnego klucza API. */
async function createCustomGame(overrides = {}) {
  const CustomGame = require('../../models/CustomGame');
  const n = nextId();
  return CustomGame.create({
    title: overrides.title || `Testowa Gra ${n}`,
    category: overrides.category || 'RPG',
    platform: overrides.platform || 'PC',
    releaseYear: overrides.releaseYear || 2024,
    description: overrides.description || 'Opis testowej gry użyty w zestawie testów.',
    ...overrides.attrs,
  });
}

/** Wpis na blogu zapisany bezpośrednio przez warstwę danych (z tagami, jak w prawdziwym zapisie). */
async function createBlogPost(overrides = {}) {
  const { savePost } = require('../../utils/blogHelpers');
  const { v4: uuidv4 } = require('uuid');
  const n = nextId();
  const post = {
    id: overrides.id || uuidv4(),
    title: overrides.title || `Testowy wpis ${n}`,
    author: overrides.author || 'Redakcja GameVerse',
    category: overrides.category || 'Aktualności',
    tags: overrides.tags || ['test'],
    excerpt: overrides.excerpt || 'Krótki opis testowego wpisu.',
    content: overrides.content || 'Treść testowego wpisu z co najmniej kilkoma słowami.',
    coverImage: overrides.coverImage || '/images/game-placeholder.svg',
    status: overrides.status || 'published',
    publishAt: overrides.publishAt || null,
    createdAt: overrides.createdAt || new Date().toISOString(),
  };
  await savePost(post);
  return post;
}

/** Token CSRF sesji agenta - czyta go z <meta name="csrf-token"> na dowolnej wyrenderowanej stronie. */
async function csrfToken(agent, path = '/') {
  const res = await agent.get(path);
  const match = res.text.match(/name="csrf-token" content="([a-f0-9]+)"/);
  if (!match) throw new Error(`Nie znaleziono tokenu CSRF na stronie ${path} (status ${res.status}).`);
  return match[1];
}

/** Nowy agent supertest (własny magazyn ciasteczek = własna sesja) zalogowany jako podany użytkownik. */
async function loginAs(app, { username, password }) {
  const agent = request.agent(app);
  const token = await csrfToken(agent);
  const res = await agent
    .post('/auth/signin')
    .set('Accept', 'application/json')
    .send({ identifier: username, password, _csrf: token });
  if (res.status !== 200 || !res.body.success) {
    throw new Error(`Logowanie nie powiodło się (status ${res.status}): ${JSON.stringify(res.body)}`);
  }
  return agent;
}

/** Tworzy użytkownika i od razu zwraca zalogowanego agenta razem z surowymi danymi konta. */
async function userAgent(app, overrides = {}) {
  const { user, password } = await createUser(overrides);
  const agent = await loginAs(app, { username: user.username, password });
  return { agent, user, password };
}

function adminAgent(app, overrides = {}) {
  return userAgent(app, { ...overrides, role: 'admin' });
}

module.exports = {
  createUser,
  createAdmin,
  createCustomGame,
  createBlogPost,
  csrfToken,
  loginAs,
  userAgent,
  adminAgent,
};
