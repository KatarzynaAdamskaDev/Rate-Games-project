/**
 * Zasady nadawania i odbierania uprawnień administratora, tak żeby nikt nie dostał ich
 * przez przypadek i żeby nowy administrator nie mógł łatwo odebrać ich innym:
 *  - zmiana wymaga ponownego potwierdzenia (hasło, nazwa użytkownika, kod 2FA - jeśli włączone),
 *  - nowy administrator ma okres próbny (PROBATION_DAYS), w którym nie zmienia uprawnień innych,
 *  - administrator nie może odebrać uprawnień komuś, kto jest administratorem dłużej niż on
 *    (konta założycielskie, czyli bez daty adminSince, są najstarsze),
 *  - nieudane potwierdzenia są limitowane.
 */
const PROBATION_DAYS = 7;
const PROBATION_MS = PROBATION_DAYS * 24 * 60 * 60 * 1000;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 10 * 60 * 1000;

/** Od kiedy użytkownik jest administratorem: 0 = konto założycielskie (najstarsze). */
function adminRank(user) {
  return user.adminSince ? new Date(user.adminSince).getTime() : 0;
}

function probationEndsAt(user) {
  if (!user.adminSince) return null;
  const ends = new Date(user.adminSince).getTime() + PROBATION_MS;
  return ends > Date.now() ? new Date(ends) : null;
}

/**
 * Czy `actor` może zmienić rolę `target` na `newRole`?
 * @returns {{ ok: boolean, reason?: string }}
 */
function evaluateRoleChange(actor, target, newRole) {
  if (actor.id === target.id) {
    return { ok: false, reason: 'Własnych uprawnień nie zmienisz - zrobi to inny administrator.' };
  }

  const probation = probationEndsAt(actor);
  if (probation) {
    return {
      ok: false,
      reason: `Nowy administrator może zmieniać uprawnienia dopiero po okresie próbnym (do ${probation.toLocaleDateString('pl-PL')}).`,
    };
  }

  if (newRole === 'admin') {
    if (target.role === 'admin') return { ok: false, reason: 'Ten użytkownik jest już administratorem.' };
    if (target.isBanned) return { ok: false, reason: 'Konto jest zablokowane - najpierw je odblokuj.' };
    return { ok: true };
  }

  if (target.role !== 'admin') return { ok: false, reason: 'Ten użytkownik nie jest administratorem.' };
  if (adminRank(actor) > adminRank(target)) {
    return {
      ok: false,
      reason: 'Nie możesz odebrać uprawnień administratorowi, który ma je dłużej niż Ty.',
    };
  }
  return { ok: true };
}

/* ------------------- limit nieudanych potwierdzeń (w pamięci) ------------------- */

const attempts = new Map(); // actorId -> { count, lockedUntil }

function lockedFor(actorId) {
  const entry = attempts.get(actorId);
  if (entry && entry.lockedUntil > Date.now()) return Math.ceil((entry.lockedUntil - Date.now()) / 60000);
  return 0;
}

function registerFailure(actorId) {
  const entry = attempts.get(actorId) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.count = 0;
    entry.lockedUntil = Date.now() + LOCK_MS;
  }
  attempts.set(actorId, entry);
}

function clearFailures(actorId) {
  attempts.delete(actorId);
}

module.exports = {
  PROBATION_DAYS,
  adminRank,
  probationEndsAt,
  evaluateRoleChange,
  lockedFor,
  registerFailure,
  clearFailures,
};
