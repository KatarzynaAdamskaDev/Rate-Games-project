require('dotenv').config();
//test

const path = require('path');
const express = require('express');
const morgan = require('morgan');
const session = require('express-session');
const flash = require('connect-flash');

const exposeLocals = require('./middleware/locals');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandlers');

const indexRouter = require('./routes/index');
const authRouter = require('./routes/auth');
const gamesRouter = require('./routes/games');
const categoryRouter = require('./routes/category');
const blogRouter = require('./routes/blog');
const searchRouter = require('./routes/search');

const app = express();

/* ------------------------- Konfiguracja widoków ------------------------- */
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

/* ------------------------------ Middleware ------------------------------ */
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'gameverse_dev_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 dzień domyślnie
    },
  })
);
app.use(flash());
app.use(exposeLocals);

/* -------------------------------- Trasy -------------------------------- */
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/games', gamesRouter);
app.use('/category', categoryRouter);
app.use('/blog', blogRouter);
app.use('/search', searchRouter);

/* --------------------------- Obsługa błędów --------------------------- */
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
