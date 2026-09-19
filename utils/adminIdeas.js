/**
 * Propozycje kolejnych funkcji do rozpatrzenia przez administratora (panel -> Propozycje).
 * Lista jest w kodzie, a decyzje (przyjęte / odłożone / odrzucone) zapisują się w ustawieniach serwisu
 * pod kluczem "idea:<id>".
 */
const IDEAS = [
  /* ------------------------------ bezpieczeństwo ------------------------------ */
  {
    id: 'csrf',
    implemented: true,
    area: 'security',
    title: 'Ochrona przed CSRF',
    effort: 'średni',
    impact: 'wysoki',
    description:
      'Każda sesja ma losowy token, który muszą przysłać wszystkie formularze i żądania zmieniające dane (POST). Obca strona nie może więc wysłać żądania w imieniu zalogowanego użytkownika (np. usunąć konta). Ciasteczko sesji ma dodatkowo flagę SameSite.',
  },
  {
    id: 'session-store',
    implemented: true,
    area: 'security',
    title: 'Trwałe sesje i bezpieczne ciasteczka',
    effort: 'średni',
    impact: 'wysoki',
    description:
      'Sesje są zapisywane w bazie danych, więc przeżywają restart serwera i działają przy kilku instancjach. Ciasteczko sesji ma flagi httpOnly, sameSite i secure (na produkcji), a bez ustawionego SESSION_SECRET serwer produkcyjny się nie uruchomi.',
  },
  {
    id: 'security-headers',
    area: 'security',
    title: 'Nagłówki bezpieczeństwa (Helmet)',
    effort: 'mały',
    impact: 'średni',
    description:
      'Dodanie nagłówków Content-Security-Policy, X-Frame-Options, X-Content-Type-Options i HSTS chroni przed osadzaniem strony w ramce, podszywaniem się i częścią ataków XSS.',
  },
  {
    id: 'upload-verify',
    area: 'security',
    title: 'Weryfikacja wgrywanych obrazów',
    effort: 'średni',
    impact: 'średni',
    description:
      'Awatary i okładki bloga są sprawdzane tylko po rozszerzeniu pliku. Sprawdzenie zawartości (sygnatury plików), przekodowanie obrazu i limit wymiarów uniemożliwią podsunięcie złośliwego pliku.',
  },
  {
    id: 'email-verify',
    area: 'security',
    title: 'Weryfikacja adresu e-mail',
    effort: 'średni',
    impact: 'wysoki',
    description:
      'Mail z linkiem aktywacyjnym przy rejestracji ogranicza fałszywe konta i boty oraz gwarantuje, że reset hasła trafi do właściciela konta.',
  },
  {
    id: 'password-check',
    area: 'security',
    title: 'Kontrola siły i wycieku hasła',
    effort: 'mały',
    impact: 'średni',
    description:
      'Wskaźnik siły hasła przy rejestracji i zmianie oraz sprawdzenie, czy hasło nie występuje w znanych wyciekach (usługa Have I Been Pwned, bez wysyłania samego hasła).',
  },
  {
    id: 'login-history',
    area: 'security',
    title: 'Historia logowań i wylogowanie z wszystkich urządzeń',
    effort: 'średni',
    impact: 'średni',
    description:
      'W ustawieniach konta lista ostatnich logowań (czas, adres IP, przeglądarka), alert o logowaniu z nowego urządzenia i przycisk "wyloguj wszędzie". Po zmianie hasła stare sesje byłyby unieważniane.',
  },
  {
    id: 'admin-alerts',
    area: 'security',
    title: 'Alerty o podejrzanej aktywności',
    effort: 'średni',
    impact: 'średni',
    description:
      'Powiadomienie administratorów (panel lub e-mail) o serii nieudanych logowań na konto admina, nagłym wzroście blokad limitów zapytań albo masowym zgłaszaniu jednej osoby.',
  },
  {
    id: 'captcha-adaptive',
    area: 'security',
    title: 'reCAPTCHA po nieudanych próbach',
    effort: 'mały',
    impact: 'średni',
    description:
      'Formularz logowania wymagałby reCAPTCHA dopiero po kilku błędnych próbach, a dodawanie recenzji - od nowych kont. Wygodne dla uczciwych użytkowników, uciążliwe dla botów.',
  },

  /* ------------------------------ użyteczność ------------------------------ */
  {
    id: 'warnings',
    area: 'usability',
    title: 'System ostrzeżeń dla użytkowników',
    effort: 'średni',
    impact: 'wysoki',
    description:
      'Moderator wysyła ostrzeżenie z powodem zamiast od razu blokować konto. Kolejne ostrzeżenia (np. trzecie) skutkują automatyczną, czasową blokadą. Użytkownik widzi historię ostrzeżeń w powiadomieniach.',
  },
  {
    id: 'temp-ban',
    area: 'usability',
    title: 'Blokady czasowe i wyciszenie',
    effort: 'średni',
    impact: 'wysoki',
    description:
      'Blokada na określony czas (dzień, tydzień, 30 dni) i tryb "wyciszony": użytkownik może czytać serwis, ale nie może pisać recenzji, komentarzy ani wiadomości.',
  },
  {
    id: 'report-more',
    area: 'usability',
    title: 'Zgłaszanie komentarzy, użytkowników i wiadomości',
    effort: 'średni',
    impact: 'wysoki',
    description:
      'Dziś można zgłosić tylko recenzję. Takie samo okno z powodem można podpiąć pod komentarze, profile użytkowników i wiadomości czatu, a kolejka w panelu obsłuży wszystkie rodzaje zgłoszeń.',
  },
  {
    id: 'review-history',
    area: 'usability',
    title: 'Historia edycji recenzji i kosz',
    effort: 'średni',
    impact: 'średni',
    description:
      'Zapamiętywanie poprzednich wersji recenzji (ślad dla moderatora, gdy ktoś zmieni treść po zgłoszeniu) oraz kosz na usunięte recenzje z możliwością przywrócenia w ciągu 30 dni.',
  },
  {
    id: 'block-users',
    area: 'usability',
    title: 'Blokowanie i ignorowanie użytkowników',
    effort: 'średni',
    impact: 'wysoki',
    description:
      'Użytkownik może zablokować inne konto: ukrywa jego komentarze, a ta osoba nie napisze do niego na czacie ani nie zaobserwuje go.',
  },
  {
    id: 'profile-privacy',
    area: 'usability',
    title: 'Ustawienia prywatności profilu',
    effort: 'średni',
    impact: 'średni',
    description:
      'Nowa zakładka w edycji profilu: kto widzi listę obserwujących i ulubione gry (wszyscy / obserwujący / nikt) oraz kto może zaczynać rozmowę na czacie.',
  },
  {
    id: 'game-lists',
    area: 'usability',
    title: 'Listy gier: chcę zagrać, gram, ukończone',
    effort: 'duży',
    impact: 'wysoki',
    description:
      'Oprócz ulubionych użytkownik prowadzi własne listy gier ze statusem. Statystyki (ile ukończył, ile na liście życzeń) pokazują się na profilu i mogą dawać odznaki.',
  },
  {
    id: 'spoiler-tag',
    area: 'usability',
    title: 'Oznaczanie spoilerów w recenzjach',
    effort: 'mały',
    impact: 'średni',
    description:
      'Przy dodawaniu recenzji pole "zawiera spoilery" zasłania treść do kliknięcia. Zmniejsza liczbę zgłoszeń z powodu spoilerów.',
  },
  {
    id: 'email-digest',
    area: 'usability',
    title: 'Podsumowanie powiadomień e-mailem',
    effort: 'duży',
    impact: 'średni',
    description:
      'Opcjonalny, dzienny lub tygodniowy mail z podsumowaniem powiadomień. Ustawienie dołączyłoby do zakładki Powiadomienia w edycji profilu.',
  },
  {
    id: 'seo-share',
    area: 'usability',
    title: 'SEO i udostępnianie w mediach społecznościowych',
    effort: 'mały',
    impact: 'średni',
    description:
      'Znaczniki Open Graph dla gier, recenzji i wpisów bloga (ładny podgląd linku), plik sitemap.xml i robots.txt - więcej wejść z wyszukiwarek.',
  },
  {
    id: 'blog-plus',
    area: 'usability',
    title: 'Blog: szkice, tagi i komentarze',
    effort: 'średni',
    impact: 'średni',
    description:
      'Szkice i zaplanowana publikacja wpisów, tagi oraz komentarze pod wpisami (z tą samą moderacją co komentarze pod recenzjami).',
  },
  {
    id: 'admin-bulk',
    area: 'usability',
    title: 'Akcje zbiorcze w panelu admina',
    effort: 'średni',
    impact: 'średni',
    description:
      'Zaznaczanie wielu wierszy naraz (usuń komentarze, odrzuć zgłoszenia, zablokuj konta) oraz wyszukiwanie i filtrowanie dziennika działań.',
  },
];

const AREAS = {
  security: { label: 'Bezpieczeństwo', icon: 'bi-shield-lock-fill' },
  usability: { label: 'Użyteczność', icon: 'bi-stars' },
};

const DECISIONS = {
  accepted: { label: 'Przyjęte do realizacji', badge: 'gv-badge-blue' },
  done: { label: 'Zrealizowane', badge: 'gv-badge-ok' },
  later: { label: 'Odłożone na później', badge: 'gv-badge-warn' },
  rejected: { label: 'Odrzucone', badge: 'gv-badge-danger' },
};

function findIdea(id) {
  return IDEAS.find((idea) => idea.id === id) || null;
}

module.exports = { IDEAS, AREAS, DECISIONS, findIdea };
