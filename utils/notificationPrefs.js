/**
 * Ustawienia powiadomień użytkownika (Edytuj profil -> Powiadomienia).
 * W bazie (users.notificationPrefs) trzymamy tylko odstępstwa od domyślnych
 * ustawień, czyli wszystko jest włączone, dopóki użytkownik nie wyłączy.
 */
const User = require('../models/User');

const NOTIFICATION_TYPES = [
  {
    id: 'follow',
    icon: 'bi-person-plus-fill',
    label: 'Nowy obserwujący',
    description: 'Ktoś zaczął Cię obserwować.',
  },
  {
    id: 'review-like',
    icon: 'bi-heart-fill',
    label: 'Polubienia recenzji',
    description: 'Ktoś polubił Twoją recenzję.',
  },
  {
    id: 'review-comment',
    icon: 'bi-chat-left-text-fill',
    label: 'Komentarze pod recenzją',
    description: 'Ktoś skomentował Twoją recenzję.',
  },
  {
    id: 'blog-comment',
    icon: 'bi-journal-text',
    label: 'Komentarze pod wpisami bloga',
    description: 'Ktoś skomentował wpis, który napisałeś(-aś).',
  },
  {
    id: 'comment-like',
    icon: 'bi-hand-thumbs-up-fill',
    label: 'Polubienia komentarzy',
    description: 'Ktoś polubił Twój komentarz.',
  },
  {
    id: 'report-result',
    icon: 'bi-flag-fill',
    label: 'Decyzje w sprawie zgłoszeń',
    description: 'Moderator rozpatrzył zgłoszenie, które wysłałeś(-aś).',
  },
  {
    id: 'group-invite',
    icon: 'bi-people-fill',
    label: 'Zaproszenia do grup',
    description: 'Ktoś zaprosił Cię do grupy na czacie.',
  },
];

/** Zamienia zapisany w bazie JSON na komplet ustawień: { muteAll, types: { id: bool } }. */
function parsePrefs(json) {
  let stored = {};
  try {
    stored = JSON.parse(json || '{}') || {};
  } catch (err) {
    stored = {};
  }
  const types = {};
  NOTIFICATION_TYPES.forEach((type) => {
    types[type.id] = stored[type.id] !== false;
  });
  return { muteAll: stored.muteAll === true, types };
}

/** Buduje JSON do zapisu z pól formularza (checkboxy: zaznaczone = włączone). */
function serializePrefs(body) {
  const stored = {};
  if (body.muteAll === '1') stored.muteAll = true;
  NOTIFICATION_TYPES.forEach((type) => {
    if (body[type.id] !== '1') stored[type.id] = false;
  });
  return JSON.stringify(stored);
}

async function isNotificationEnabled(userId, type) {
  const user = await User.findByPk(userId, { attributes: ['notificationPrefs'] });
  if (!user) return false;
  const prefs = parsePrefs(user.notificationPrefs);
  if (prefs.muteAll) return false;
  return prefs.types[type] !== false;
}

module.exports = { NOTIFICATION_TYPES, parsePrefs, serializePrefs, isNotificationEnabled };
