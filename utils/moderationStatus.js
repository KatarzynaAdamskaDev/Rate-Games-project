/**
 * Blokady (stałe i czasowe) oraz wyciszenia kont.
 *  - blokada: users.isBanned (+ banReason); czasowa ma dodatkowo users.bannedUntil,
 *    po tej dacie konto jest znowu aktywne (bez czekania na sprzątanie w bazie),
 *  - wyciszenie: users.mutedUntil (+ muteReason) - konto działa, ale nie może pisać
 *    recenzji, komentarzy ani wiadomości.
 */
const { Op } = require('sequelize');
const User = require('../models/User');

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Wyciszenie "bezterminowe" to bardzo odległa data (jedno pole zamiast osobnej flagi).
const PERMANENT_MUTE = new Date('2099-12-31T23:59:59.000Z');

const DURATIONS = [
  { key: '1d', label: '1 dzień', ms: DAY_MS },
  { key: '7d', label: '7 dni', ms: 7 * DAY_MS },
  { key: '30d', label: '30 dni', ms: 30 * DAY_MS },
  { key: 'permanent', label: 'Bezterminowo', ms: null },
];

function findDuration(key) {
  return DURATIONS.find((d) => d.key === key) || DURATIONS[DURATIONS.length - 1];
}

/** Data zakończenia dla podanego czasu trwania; null = blokada stała. */
function banUntil(key) {
  const duration = findDuration(key);
  return duration.ms ? new Date(Date.now() + duration.ms) : null;
}

function muteUntil(key) {
  const duration = findDuration(key);
  return duration.ms ? new Date(Date.now() + duration.ms) : PERMANENT_MUTE;
}

/** Czy konto jest teraz zablokowane (blokada czasowa po terminie już nie obowiązuje). */
function isBanActive(user) {
  if (!user || !user.isBanned) return false;
  if (user.bannedUntil && new Date(user.bannedUntil).getTime() <= Date.now()) return false;
  return true;
}

function isMuted(user) {
  return !!(user && user.mutedUntil && new Date(user.mutedUntil).getTime() > Date.now());
}

function isPermanentMute(user) {
  return isMuted(user) && new Date(user.mutedUntil).getFullYear() >= 2099;
}

function formatUntil(date) {
  return new Date(date).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Warunek Sequelize: aktualnie zablokowani. */
function activeBanWhere() {
  return {
    isBanned: true,
    [Op.or]: [{ bannedUntil: null }, { bannedUntil: { [Op.gt]: new Date() } }],
  };
}

/** Zdejmuje blokady czasowe, którym minął termin. */
async function liftExpiredBans() {
  const [count] = await User.update(
    { isBanned: false, banReason: null, bannedUntil: null },
    { where: { isBanned: true, bannedUntil: { [Op.lt]: new Date() } } }
  );
  return count;
}

/** Sprzątanie w tle (timer nie blokuje zamknięcia procesu). */
function startModerationCleanup() {
  const run = () => liftExpiredBans().catch(() => {});
  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref();
}

/** Komunikat dla zablokowanego użytkownika (logowanie, aktywna sesja). */
function banMessage(user) {
  const until = user.bannedUntil ? ` do ${formatUntil(user.bannedUntil)}` : '';
  const reason = user.banReason ? ` Powód: ${user.banReason}` : '';
  return `Twoje konto zostało zablokowane${until}.${reason}`;
}

module.exports = {
  DURATIONS,
  PERMANENT_MUTE,
  findDuration,
  banUntil,
  muteUntil,
  isBanActive,
  isMuted,
  isPermanentMute,
  formatUntil,
  activeBanWhere,
  liftExpiredBans,
  startModerationCleanup,
  banMessage,
};
