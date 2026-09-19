/**
 * Powody zgłoszenia recenzji (użytkownik wybiera dokładnie jeden i może coś dopisać).
 * Lista trafia do okna zgłoszenia na stronie gry i do panelu admina.
 */
const REPORT_REASONS = [
  { id: 'spam', label: 'Spam lub reklama' },
  { id: 'offensive', label: 'Wulgarne lub obraźliwe treści' },
  { id: 'hate', label: 'Nękanie lub mowa nienawiści' },
  { id: 'spoiler', label: 'Spoilery bez ostrzeżenia' },
  { id: 'offtopic', label: 'Opinia nie dotyczy tej gry' },
  { id: 'fake', label: 'Fałszywa lub nieuczciwa opinia' },
  { id: 'other', label: 'Inny powód (opisz poniżej)' },
];

const MAX_COMMENT_LENGTH = 300;

function findReason(id) {
  return REPORT_REASONS.find((reason) => reason.id === id) || null;
}

module.exports = { REPORT_REASONS, MAX_COMMENT_LENGTH, findReason };
