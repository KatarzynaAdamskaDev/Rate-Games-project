/**
 * Powody zgłoszeń (użytkownik wybiera dokładnie jeden i może coś dopisać).
 * Każdy rodzaj zgłaszanej treści ma własną listę; trafiają do okna zgłoszenia
 * (views/partials/report-modal.ejs) i do panelu admina.
 * Rodzaje: review (recenzja), comment (komentarz), user (użytkownik), message (wiadomość czatu).
 */
const OTHER = { id: 'other', label: 'Inny powód (opisz poniżej)' };

const REASONS_BY_TYPE = {
  review: [
    { id: 'spam', label: 'Spam lub reklama' },
    { id: 'offensive', label: 'Wulgarne lub obraźliwe treści' },
    { id: 'hate', label: 'Nękanie lub mowa nienawiści' },
    { id: 'spoiler', label: 'Spoilery bez ostrzeżenia' },
    { id: 'offtopic', label: 'Opinia nie dotyczy tej gry' },
    { id: 'fake', label: 'Fałszywa lub nieuczciwa opinia' },
    OTHER,
  ],
  comment: [
    { id: 'spam', label: 'Spam lub reklama' },
    { id: 'offensive', label: 'Wulgarne lub obraźliwe treści' },
    { id: 'hate', label: 'Nękanie lub mowa nienawiści' },
    { id: 'spoiler', label: 'Spoilery bez ostrzeżenia' },
    OTHER,
  ],
  user: [
    { id: 'spam', label: 'Spam, reklama lub bot' },
    { id: 'offensive', label: 'Obraźliwa nazwa, opis lub zdjęcie' },
    { id: 'harassment', label: 'Nękanie lub groźby' },
    { id: 'impersonation', label: 'Podszywanie się pod kogoś' },
    OTHER,
  ],
  message: [
    { id: 'spam', label: 'Spam lub reklama' },
    { id: 'harassment', label: 'Nękanie lub groźby' },
    { id: 'offensive', label: 'Wulgarne lub obraźliwe treści' },
    { id: 'scam', label: 'Oszustwo lub wyłudzanie danych' },
    OTHER,
  ],
};

// Zgodność ze starszym kodem: lista dla recenzji.
const REPORT_REASONS = REASONS_BY_TYPE.review;

const TYPE_LABELS = {
  review: 'Recenzja',
  comment: 'Komentarz',
  user: 'Użytkownik',
  message: 'Wiadomość',
};

const MAX_COMMENT_LENGTH = 300;

/** Powód o danym id dla rodzaju zgłoszenia (domyślnie recenzja). */
function findReason(id, type = 'review') {
  return (REASONS_BY_TYPE[type] || []).find((reason) => reason.id === id) || null;
}

module.exports = { REPORT_REASONS, REASONS_BY_TYPE, TYPE_LABELS, MAX_COMMENT_LENGTH, findReason };
