/**
 * Magazyn sesji express-session w bazie danych (SQLite lokalnie, Azure SQL na produkcji).
 * Zastępuje domyślny magazyn w pamięci procesu, który gubił wszystkie sesje po restarcie
 * i nie działał przy kilku instancjach.
 */
const session = require('express-session');
const { Op } = require('sequelize');
const Session = require('../models/Session');

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function expiryOf(sess) {
  const cookie = sess && sess.cookie;
  if (cookie && cookie.expires) return new Date(cookie.expires);
  if (cookie && cookie.maxAge) return new Date(Date.now() + cookie.maxAge);
  return new Date(Date.now() + DEFAULT_TTL_MS);
}

class DatabaseSessionStore extends session.Store {
  constructor() {
    super();
    // Sprzątanie wygasłych sesji w tle (timer nie blokuje zamknięcia procesu).
    const timer = setInterval(() => this.clearExpired().catch(() => {}), CLEANUP_INTERVAL_MS);
    timer.unref();
  }

  get(sid, callback) {
    Session.findByPk(sid)
      .then((row) => {
        if (!row || row.expires.getTime() <= Date.now()) return callback(null, null);
        try {
          return callback(null, JSON.parse(row.data));
        } catch (err) {
          return callback(null, null);
        }
      })
      .catch((err) => callback(err));
  }

  set(sid, sess, callback = () => {}) {
    Session.upsert({ sid, data: JSON.stringify(sess), expires: expiryOf(sess) })
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  touch(sid, sess, callback = () => {}) {
    Session.update({ expires: expiryOf(sess) }, { where: { sid } })
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  destroy(sid, callback = () => {}) {
    Session.destroy({ where: { sid } })
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  async clearExpired() {
    return Session.destroy({ where: { expires: { [Op.lt]: new Date() } } });
  }
}

module.exports = DatabaseSessionStore;
