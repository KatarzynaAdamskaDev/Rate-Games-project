require('dotenv').config();

const path = require('path');
const express = require('express');
const morgan = require('morgan');
const session = require('express-session');
const flash = require('connect-flash');

const exposeLocals = require('./middleware/locals');
const seoLocals = require('./middleware/seo');
const { csrfProtection } = require('./middleware/csrf');
const DatabaseSessionStore = require('./utils/sessionStore');
const { limiters } = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandlers');

const indexRouter = require('./routes/index');
const authRouter = require('./routes/auth');
const gamesRouter = require('./routes/games');
const categoryRouter = require('./routes/category');
const blogRouter = require('./routes/blog');
const searchRouter = require('./routes/search');
const profileRouter = require('./routes/profile');
const chatRouter = require('./routes/chat');
const notificationsRouter = require('./routes/notifications');
const adminRouter = require('./routes/admin');
const reviewsRouter = require('./routes/reviews');
const reportsRouter = require('./routes/reports');
const seoRouter = require('./routes/seo');
const pagesRouter = require('./routes/pages');
const userProfileRouter = require('./routes/userProfile');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';
const DEV_SESSION_SECRET = 'gameverse_dev_secret';

// Na produkcji sekret sesji jest obowiązkowy - domyślny sekret deweloperski jest publicznie znany.
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === DEV_SESSION_SECRET)) {
  throw new Error('Brak SESSION_SECRET: ustaw długi, losowy ciąg znaków w zmiennych środowiskowych.');
}

/* ------------------------- Konfiguracja widoków ------------------------- */
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Za serwerem pośredniczącym (Azure App Service) prawdziwy adres IP klienta jest w nagłówku
// X-Forwarded-For - potrzebny do limitów zapytań. Lokalnie nagłówka nie ufamy (można go podszyć).
if (isProduction) app.set('trust proxy', 1);

/* ------------------------------ Middleware ------------------------------ */
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    name: 'gv.sid',
    secret: process.env.SESSION_SECRET || DEV_SESSION_SECRET,
    // Sesje w bazie danych: przeżywają restart serwera i działają przy kilku instancjach.
    store: new DatabaseSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax', // ciasteczko nie jest wysyłane z formularzy obcych stron (dodatkowa ochrona przed CSRF)
      secure: isProduction ? 'auto' : false, // na produkcji tylko przez HTTPS
      maxAge: 24 * 60 * 60 * 1000, // 1 dzień domyślnie
    },
  })
);
app.use(flash());
app.use(csrfProtection);
app.use(exposeLocals);
app.use(seoLocals);

// Ogólny limit akcji zmieniających dane (POST) z jednego adresu IP.
app.use((req, res, next) => (req.method === 'POST' ? limiters.writes(req, res, next) : next()));

/* -------------------------------- Trasy -------------------------------- */
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/games', gamesRouter);
app.use('/category', categoryRouter);
app.use('/blog', blogRouter);
app.use('/search', searchRouter);
app.use('/profile', profileRouter);
app.use('/chat', chatRouter);
app.use('/notifications', notificationsRouter);
app.use('/admin', adminRouter);
app.use('/reviews', reviewsRouter);
app.use('/reports', reportsRouter);
app.use('/', seoRouter); // robots.txt, sitemap.xml, llms.txt, feed.xml - przed łapaczem /:username
app.use('/', pagesRouter); // /aboutus i /help - przed łapaczem /:username

// UWAGA: musi być zamontowany na samym końcu (po wszystkich innych trasach),
// bo obsługuje /:username jako "łapacz wszystkiego" - inaczej połknąłby
// żądania do /games, /category, /blog itd.
app.use('/', userProfileRouter);

/* --------------------------- Obsługa błędów --------------------------- */
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;