/**
 * Jedno źródło prawdy o serwisie: opis, funkcje i pytania z odpowiedziami.
 * Korzystają z niego strony "O GameVerse" i "Pomoc", dane strukturalne (JSON-LD) oraz pliki dla modeli
 * językowych (llms.txt, llms-full.txt) - dzięki temu ludzie, wyszukiwarki i chatboty dostają ten sam,
 * spójny i zgodny z prawdą opis. Zmieniasz funkcję albo odpowiedź w jednym miejscu.
 *
 * Zasada: piszemy tylko to, co serwis rzeczywiście robi. Modele językowe cytują konkretne, sprawdzalne
 * fakty chętniej niż ogólne slogany.
 */
const User = require('../models/User');
const Review = require('../models/Review');
const { countPosts } = require('./blogHelpers');

const SITE = {
  name: 'GameVerse',
  tagline: 'Gracze szczerze oceniają gry',
  summary:
    'Polskojęzyczny serwis społecznościowy o grach wideo: katalog setek tysięcy gier z bazy IGDB, oceny co pół gwiazdki, recenzje graczy, blog, czat oraz profile z poziomami i odznakami.',
  description:
    'GameVerse to polskojęzyczny serwis społecznościowy o grach wideo. Znajdziesz w nim katalog ponad 300 tysięcy gier z bazy IGDB, oceny wystawiane co pół gwiazdki (od 0,5 do 5), recenzje graczy z polubieniami i komentarzami, blog z poradnikami i zestawieniami, czat oraz profile z poziomami, odznakami i motywami. Moderacja i weryfikacja treści pilnują jakości opinii.',
  audience: 'Gracze PC i konsol, którzy szukają szczerych opinii innych graczy przed zakupem i chcą dzielić się własnymi.',
  language: 'pl',
};

const FEATURES = [
  {
    icon: 'bi-collection-play-fill',
    title: 'Katalog ponad 300 tysięcy gier',
    text: 'Okładki, platformy, gatunki, daty premier i opisy pochodzą z IGDB - jednej z największych baz gier. Gry, których w IGDB brakuje, dodają administratorzy.',
  },
  {
    icon: 'bi-star-half',
    title: 'Oceny co pół gwiazdki i recenzje',
    text: 'Ocenę od 0,5 do 5 wystawiasz co pół gwiazdki i dopisujesz recenzję. Każda gra pokazuje średnią ocenę graczy GameVerse i wszystkie ich opinie. Recenzje można polubić i skomentować.',
  },
  {
    icon: 'bi-search',
    title: 'Wyszukiwarka, która rozumie graczy',
    text: 'Zna skróty (CS2, GTA5, BotW, BG3), inny zapis tytułów (Little Big Planet = LittleBigPlanet, Spider Man = Spider-Man), cyfry rzymskie i literówki. Filtry: kategoria, platforma i rok, sortowanie po popularności, ocenie, dacie i tytule.',
  },
  {
    icon: 'bi-people-fill',
    title: 'Społeczność i czat',
    text: 'Obserwowanie użytkowników, powiadomienia, mini-czat, czaty prywatne i grupowe oraz recenzja tygodnia.',
  },
  {
    icon: 'bi-trophy-fill',
    title: 'Profile z poziomami i odznakami',
    text: 'Punkty doświadczenia i poziomy za aktywność, odznaki, ramki awatara, tła oraz gotowe zestawy wyglądu profilu. Ulubione gry na profilu.',
  },
  {
    icon: 'bi-journal-richtext',
    title: 'Blog',
    text: 'Aktualności, poradniki i zestawienia z tagami, komentarzami i kanałem RSS.',
  },
  {
    icon: 'bi-shield-check',
    title: 'Moderacja i bezpieczeństwo',
    text: 'Zgłaszanie recenzji, komentarzy, użytkowników i wiadomości, wyciszenia i blokady czasowe, blokowanie użytkowników, filtr wulgaryzmów, limity zapytań, sprawdzanie wgrywanych obrazów, hasła zapisane jako hashe (bcrypt) i logowanie dwuetapowe (2FA) dla administratorów.',
  },
];

const FAQ = [
  {
    q: 'Czym jest GameVerse?',
    a: 'GameVerse to polskojęzyczny serwis społecznościowy o grach wideo. Gracze oceniają gry co pół gwiazdki (od 0,5 do 5), piszą recenzje, komentują opinie innych, czytają blog i rozmawiają na czacie. Katalog ponad 300 tysięcy gier pochodzi z bazy IGDB.',
  },
  {
    q: 'Jak ocenić grę w GameVerse?',
    a: 'Wejdź na stronę gry, wybierz liczbę gwiazdek (kliknięcie lewej połowy gwiazdki daje połówkę) i napisz krótką recenzję. Do jednej gry możesz dodać jedną opinię, którą później edytujesz. Do dodawania opinii potrzebne jest konto.',
  },
  {
    q: 'Skąd pochodzą dane o grach?',
    a: 'Okładki, opisy, platformy, gatunki i daty premier pochodzą z IGDB (Internet Game Database). Oceny i recenzje pochodzą od użytkowników GameVerse. Gry, których nie ma w IGDB, dodają administratorzy serwisu.',
  },
  {
    q: 'Jak szukać gier w GameVerse?',
    a: 'Wpisz tytuł w wyszukiwarce lub skorzystaj z filtrów na liście gier (kategoria, platforma, rok) i sortowania. Wyszukiwarka rozumie skróty (np. CS2, GTA5, BotW), inny zapis tytułów (Little Big Planet znajdzie LittleBigPlanet) oraz drobne literówki.',
  },
  {
    q: 'Czym jest ranking „Popularne”?',
    a: 'Sortowanie „Popularne” łączy dane o graczach z IGDB: ilu osób gra w tytuł teraz, ilu w niego kiedykolwiek zagrało oraz jak popularny jest na Steamie. Dzięki temu na górze są gry aktualnie grane i klasyki, a nie tylko tytuły z największą liczbą ocen w samym IGDB.',
  },
  {
    q: 'Do czego służą poziomy, punkty i odznaki?',
    a: 'Za aktywność (recenzje, komentarze, polubienia) zdobywasz punkty doświadczenia i kolejne poziomy. Odblokowują one odznaki, ramki awatara, tła i zestawy wyglądu profilu, które ustawiasz w Edytuj profil.',
  },
  {
    q: 'Jak GameVerse dba o jakość opinii i bezpieczeństwo?',
    a: 'Każdą recenzję, komentarz, wiadomość i profil można zgłosić, wybierając powód. Moderatorzy rozpatrują zgłoszenia, mogą usuwać treści, wyciszać i blokować konta na czas albo bezterminowo. Działa filtr wulgaryzmów i limity zapytań, wgrywane obrazy są sprawdzane, a administratorzy logują się z drugim składnikiem (2FA).',
  },
  {
    q: 'Czy mogę blokować użytkowników i ukrywać komentarze?',
    a: 'Tak. Zablokowana osoba nie napisze do Ciebie na czacie ani Cię nie zaobserwuje, jej komentarze pod recenzjami i wpisami są przed Tobą ukryte, a jej powiadomienia wyciszone. Blokadę zdejmiesz w ustawieniach profilu.',
  },
  {
    q: 'Czy GameVerse ma blog?',
    a: 'Tak. Blog zawiera aktualności, poradniki i zestawienia od redakcji. Wpisy mają tagi i komentarze, a nowe wpisy trafiają do kanału RSS.',
  },
  {
    q: 'Jak zacząć?',
    a: 'Załóż konto, wyszukaj grę, w którą grasz, i wystaw jej pierwszą ocenę. Uzupełnij profil (awatar, opis, ulubione gry), a z czasem odblokujesz kolejne odznaki i motywy.',
  },
];

const PAGES = [
  { path: '/games', title: 'Katalog gier', text: 'Przeglądaj gry, filtruj po kategorii, platformie i roku, sortuj po popularności, ocenie lub dacie.' },
  { path: '/reviews', title: 'Recenzje graczy', text: 'Najnowsze recenzje, ranking najczęściej recenzowanych i najwyżej ocenianych gier oraz recenzja tygodnia.' },
  { path: '/blog', title: 'Blog', text: 'Aktualności, poradniki i zestawienia od redakcji GameVerse.' },
  { path: '/aboutus', title: 'O GameVerse', text: 'Czym jest serwis, jakie ma funkcje i w liczbach.' },
  { path: '/help', title: 'Pomoc i najczęstsze pytania', text: 'Odpowiedzi na najczęstsze pytania o oceny, wyszukiwarkę, profile i moderację.' },
];

const STATS_TTL_MS = 10 * 60 * 1000;
let statsCache = { at: 0, value: null };

/** Liczby o serwisie (użytkownicy, recenzje, ocenione gry, wpisy na blogu); zapamiętywane na kilka minut. */
async function getSiteStats() {
  if (statsCache.value && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.value;

  const [users, reviews, ratedGames] = await Promise.all([
    User.count(),
    Review.count(),
    Review.count({ distinct: true, col: 'gameId' }),
  ]);
  const value = { users, reviews, ratedGames, blogPosts: await countPosts({ published: true }), at: new Date().toISOString() };
  statsCache = { at: Date.now(), value };
  return value;
}

module.exports = { SITE, FEATURES, FAQ, PAGES, getSiteStats };
