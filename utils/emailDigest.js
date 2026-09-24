/**
 * Podsumowanie nieprzeczytanych na e-mail (opt-in): raz na dobę, tylko jeśli od ostatniej takiej wiadomości
 * coś Cię ominęło - nieprzeczytane wiadomości na czacie albo nowe powiadomienia. Domyślnie wyłączone; włącza się
 * w Edytuj profil -> Powiadomienia (utils/notificationPrefs.js, pole emailDigest).
 *
 * Zasady, które chronią odbiorcę:
 *  - nic nie wysyłamy bez zgody i nigdy "pustego" listu (brak nowych rzeczy = brak e-maila),
 *  - te same nieprzeczytane wiadomości nie wracają w kolejnym liście (liczymy tylko to, co nowsze od poprzedniego),
 *  - konta zablokowane pomijamy,
 *  - przy kilku instancjach serwera tylko jedna "zajmuje" użytkownika (warunkowa aktualizacja lastDigestEmailAt),
 *    a nieudana wysyłka zwalnia to zajęcie, więc następna próba wypadnie przy kolejnym przebiegu.
 *
 * Sama wysyłka jest wstrzykiwana (opcja mailer), dzięki czemu testy nie potrzebują poczty.
 */
const { Op } = require('sequelize');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { getUnreadCounts, getConversationsForUser } = require('./chatHelpers');
const { parsePrefs } = require('./notificationPrefs');
const { isBanActive } = require('./moderationStatus');
const { sendMail, isMailConfigured } = require('./mailer');

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 24 * HOUR_MS;
const SCAN_EVERY_MS = HOUR_MS;
const FIRST_SCAN_DELAY_MS = 60 * 1000;
const MAX_CONVERSATIONS_LISTED = 5;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function siteUrl() {
  return (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** Polska odmiana: 1 wiadomość, 2-4 wiadomości, 5+ wiadomości (z wyjątkiem 12-14). */
function plural(n, one, few, many) {
  if (n === 1) return one;
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

function conversationLabel(conv, userId) {
  if (conv.type === 'dm') {
    const otherId = conv.memberIds.find((id) => id !== userId);
    return (otherId && conv.memberNames[otherId]) || 'Rozmowa prywatna';
  }
  return conv.name || 'Rozmowa';
}

/** Co ominęło użytkownika od chwili since (null = od zawsze). */
async function collectDigest(user, since) {
  const unread = await getUnreadCounts(user.id, { since });

  let conversations = [];
  if (unread.total > 0) {
    conversations = (await getConversationsForUser(user.id))
      .filter((c) => unread.byConversation[c.id])
      .map((c) => ({ name: conversationLabel(c, user.id), count: unread.byConversation[c.id] }))
      .sort((a, b) => b.count - a.count);
  }

  const notifications = await Notification.count({
    where: { userId: user.id, isRead: false, ...(since ? { createdAt: { [Op.gt]: since } } : {}) },
  });

  return { messages: unread.total, conversations, notifications };
}

function buildEmail(user, digest) {
  const base = siteUrl();
  const parts = [];
  if (digest.messages > 0) {
    parts.push(`${digest.messages} ${plural(digest.messages, 'nieprzeczytana wiadomość', 'nieprzeczytane wiadomości', 'nieprzeczytanych wiadomości')} na czacie`);
  }
  if (digest.notifications > 0) {
    parts.push(`${digest.notifications} ${plural(digest.notifications, 'nowe powiadomienie', 'nowe powiadomienia', 'nowych powiadomień')}`);
  }
  const summary = parts.join(' i ');

  const listed = digest.conversations.slice(0, MAX_CONVERSATIONS_LISTED);
  const more = digest.conversations.length - listed.length;
  const conversationItemsHtml = listed
    .map((c) => `<li><b>${escapeHtml(c.name)}</b> - ${c.count}</li>`)
    .join('');
  const conversationItemsText = listed.map((c) => `  - ${c.name}: ${c.count}`).join('\n');

  const settingsLink = `${base}/profile/settings?tab=notifications`;
  const subject = `GameVerse: ${summary}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
      <h2 style="color: #333;">Cześć ${escapeHtml(user.username)}!</h2>
      <p>Od ostatniego razu czeka na Ciebie: <b>${escapeHtml(summary)}</b>.</p>
      ${listed.length > 0 ? `<ul>${conversationItemsHtml}</ul>${more > 0 ? `<p style="color:#777;">...i ${more} ${plural(more, 'inna rozmowa', 'inne rozmowy', 'innych rozmów')}.</p>` : ''}` : ''}
      <p style="text-align: center; margin: 28px 0;">
        <a href="${base}/chat" style="background-color: #5c67f2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Otwórz czat</a>
      </p>
      <p style="color: #777; font-size: 12px;">
        Dostajesz tę wiadomość, bo włączyłeś(-aś) podsumowania na e-mail. Możesz je wyłączyć w
        <a href="${settingsLink}">ustawieniach powiadomień</a>.
      </p>
    </div>
  `;

  const textLines = [`Cześć ${user.username}!`, '', `Od ostatniego razu czeka na Ciebie: ${summary}.`];
  if (listed.length > 0) textLines.push(conversationItemsText);
  if (more > 0) textLines.push(`  ...i ${more} ${plural(more, 'inna rozmowa', 'inne rozmowy', 'innych rozmów')}.`);
  textLines.push('', `Otwórz czat: ${base}/chat`, `Wyłączysz podsumowania w ustawieniach powiadomień: ${settingsLink}`);
  const text = textLines.join('\n');

  return { subject, html, text };
}

function digestIntervalMs() {
  const hours = Number(process.env.EMAIL_DIGEST_INTERVAL_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours * HOUR_MS : DEFAULT_MIN_INTERVAL_MS;
}

/**
 * Jeden przebieg: wysyła podsumowania wszystkim uprawnionym.
 * @param {{ mailer?: Function, now?: Date, minIntervalMs?: number }} [options]
 * @returns {Promise<{ checked: number, sent: number, skipped: number, failed: number }>}
 */
async function runDigest({ mailer = sendMail, now = new Date(), minIntervalMs = digestIntervalMs() } = {}) {
  const threshold = new Date(now.getTime() - minIntervalMs);
  const notDueYet = { [Op.or]: [{ lastDigestEmailAt: null }, { lastDigestEmailAt: { [Op.lt]: threshold } }] };

  const candidates = await User.findAll({
    where: {
      notificationPrefs: { [Op.like]: '%"emailDigest":true%' },
      email: { [Op.ne]: null },
      ...notDueYet,
    },
  });

  const result = { checked: candidates.length, sent: 0, skipped: 0, failed: 0 };

  for (const user of candidates) {
    if (!parsePrefs(user.notificationPrefs).emailDigest || !user.email || isBanActive(user)) {
      result.skipped += 1;
      continue;
    }

    const previous = user.lastDigestEmailAt;
    const digest = await collectDigest(user, previous);
    if (digest.messages === 0 && digest.notifications === 0) {
      result.skipped += 1;
      continue;
    }

    // "Zajęcie" użytkownika: gdy inna instancja zrobiła to pierwsza, aktualizacja nie zmieni żadnego wiersza.
    const [claimed] = await User.update({ lastDigestEmailAt: now }, { where: { id: user.id, ...notDueYet } });
    if (claimed === 0) {
      result.skipped += 1;
      continue;
    }

    try {
      await mailer({ to: user.email, ...buildEmail(user, digest) });
      result.sent += 1;
    } catch (err) {
      // Nie wyszło - oddajemy zajęcie, żeby kolejny przebieg spróbował jeszcze raz.
      await User.update({ lastDigestEmailAt: previous }, { where: { id: user.id } });
      result.failed += 1;
      console.error(`[podsumowania e-mail] nie udało się wysłać do użytkownika ${user.id}:`, err.message);
    }
  }

  return result;
}

/** Uruchamia okresowe sprawdzanie (co godzinę). Bez skonfigurowanej poczty nic nie robi. */
function startEmailDigest({ mailer } = {}) {
  if (process.env.EMAIL_DIGEST === 'off') return null;
  if (!mailer && !isMailConfigured()) {
    console.log('[podsumowania e-mail] pominięte - brak EMAIL_USER/EMAIL_PASS w środowisku.');
    return null;
  }

  const tick = () =>
    runDigest({ mailer })
      .then((r) => {
        if (r.sent > 0 || r.failed > 0) {
          console.log(`[podsumowania e-mail] wysłano: ${r.sent}, błędy: ${r.failed}, pominięto: ${r.skipped}.`);
        }
      })
      .catch((err) => console.error('[podsumowania e-mail] błąd przebiegu:', err.message));

  const timer = setInterval(tick, SCAN_EVERY_MS);
  timer.unref();
  setTimeout(tick, FIRST_SCAN_DELAY_MS).unref();
  return timer;
}

module.exports = { runDigest, startEmailDigest, collectDigest, buildEmail, plural, DEFAULT_MIN_INTERVAL_MS };
