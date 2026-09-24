# Testy

Ten projekt ma dwa rodzaje testów, oba uruchamiane przez [Jest](https://jestjs.io/):

- **`tests/unit/`** - testy jednostkowe. Sprawdzają pojedyncze funkcje z `utils/` (np. formatowanie treści
  wpisu, ocenę SEO, wyszukiwarkę, kopiowanie baz danych) bez uruchamiania serwera ani bazy danych. Szybkie
  (całość liczy się w ułamku sekundy) i najłatwiejsze do czytania - dobry punkt startowy, jeśli chcesz
  zobaczyć, jak coś działa.
- **`tests/integration/`** - testy integracyjne. Uruchamiają całą aplikację (Express) na odizolowanej,
  tymczasowej bazie SQLite i wysyłają do niej prawdziwe żądania HTTP (przez
  [supertest](https://github.com/ladjs/supertest)) - tak, jak robiłaby to przeglądarka: rejestracja,
  logowanie, dodanie recenzji, utworzenie wpisu na blogu, akcje administratora, ochrona przed CSRF i XSS.

## Uruchamianie

```bash
npm test                  # wszystkie testy, raz
npm run test:watch        # tryb ciągły - odpala się ponownie po zapisaniu pliku
npm run test:coverage     # jak npm test, plus raport pokrycia w coverage/index.html
```

Jeden plik albo tylko pasujące nazwy testów:

```bash
npx jest tests/unit/seoAssistant.test.js
npx jest -t "nazwa testu albo jego fragment"
```

## Zasady, które tu obowiązują (i dlaczego)

- **Żaden test nie dotyka prawdziwych danych.** `tests/setup/testApp.js` tworzy dla każdego pliku testowego
  własny, tymczasowy plik SQLite i własny katalog na wgrywane pliki (`UPLOADS_DIR`), a na końcu je kasuje.
  Testy nigdy nie czytają ani nie zapisują `data/dev.sqlite3`, `data/blog.json` ani plików w
  `public/images/`. Zobacz `.claude`/pamięć projektu - to była wcześniej prawdziwa awaria (test skasował
  okładki bloga administratora), stąd ta zasada jest tu pilnowana świadomie.
- **Żaden test nie łączy się z internetem ani nie potrzebuje kluczy API.** `testApp.js` czyści zmienne
  środowiskowe kluczy zewnętrznych (IGDB/Twitch, reCAPTCHA, Anthropic, YouTube, e-mail) *zanim* wczyta
  aplikację, a `utils/__mocks__/igdbService.js` udaje pusty katalog IGDB - dokładnie tak, jak aplikacja
  zachowuje się bez skonfigurowanych kluczy (patrz README, sekcja "Uruchomienie"). Dzięki temu testy
  przechodzą tak samo na Twoim komputerze, jak i w GitHub Actions, bez żadnych sekretów w CI.
- **Baza sprzed każdego pliku testowego jest pusta i świeżo utworzona** (`sequelize.sync({ force: true })`),
  więc testy nie zależą od kolejności ani od tego, co zrobił inny plik.

## Jak dodać nowy test

**Jednostkowy** (czysta funkcja, bez bazy/sieci) - `tests/unit/<nazwa>.test.js`:

```js
const { mojaFunkcja } = require('../../utils/mojPlik');

test('opis po polsku, co dokładnie sprawdzamy', () => {
  expect(mojaFunkcja('coś')).toBe('oczekiwany wynik');
});
```

**Integracyjny** (trasa HTTP) - `tests/integration/<nazwa>.test.js`:

```js
const request = require('supertest');
const { createTestApp } = require('../setup/testApp');
const { userAgent, csrfToken } = require('../setup/factories');

describe('coś', () => {
  let ctx;
  beforeAll(async () => { ctx = await createTestApp(); });
  afterAll(async () => { await ctx.teardown(); });

  test('opis', async () => {
    const { agent } = await userAgent(ctx.app); // gotowy, zalogowany użytkownik
    const res = await agent.get('/jakas-strona');
    expect(res.status).toBe(200);
  });
});
```

`tests/setup/factories.js` ma gotowe pomocnicze funkcje: `createUser`, `createAdmin`, `createCustomGame`,
`createBlogPost`, `csrfToken`, `loginAs`, `userAgent`, `adminAgent` - każda działa bezpośrednio na modelach
Sequelize (szybciej niż wypełnianie prawdziwego formularza) albo zakłada gotową, zalogowaną sesję.

Formularze POST wymagają tokenu CSRF - pobierz go przez `csrfToken(agent, '/jakas-strona')` i dołącz jako
pole `_csrf` w wysyłanych danych (patrz istniejące testy).

## Czego te testy nie sprawdzają (świadomie)

- **Prawdziwego IGDB, Anthropic (pomocnik pisania artykułów) ani wyszukiwania zdjęć/filmów w internecie** -
  wymagałyby kluczy API i połączenia z siecią, więc nie nadają się do automatycznego CI. Te elementy trzeba
  sprawdzić ręcznie, w przeglądarce, z ustawionymi kluczami.
- **Wyglądu strony (CSS, układ, urządzenia mobilne)** - testy Jest sprawdzają wygenerowany HTML i kod stanu,
  nie to, jak to wygląda. Układ na różnych ekranach sprawdza osobny zestaw (poniżej); ładny/brzydki nadal
  ocenia się okiem.

## Testy w prawdziwej przeglądarce (Playwright): responsywność i czat na żywo

Osobne od Jest - `npm run test:responsive` (albo `npm run test:responsive:ui`, żeby oglądać przebieg).
Pierwszy raz trzeba pobrać przeglądarkę: `npx playwright install chromium`.

- Serwer startuje sam (`tests/responsive/seed-and-start.js`) z **izolowaną bazą i katalogiem plików**
  (tak jak Jest - nigdy `data/dev.sqlite3` ani `public/images/`) i z dogranymi danymi: gra, recenzja,
  wpis na blogu, rozmowa na czacie i dwa konta (zwykłe i admin).
- Strony sprawdzamy na 6 szerokościach: 375, 480, 768, 980, 1024 i 1440 px (dobrane pod breakpointy z CSS;
  menu-hamburger przełącza się realnie przy 980 px).
- `pages.spec.js` - strony publiczne bez poziomego przewijania; `authenticated.spec.js` - profil, czat,
  panel admina, modal "Napisz recenzję", panel emoji (uwaga: okno czatu ma `overflow: hidden`, więc
  dodatkowo sprawdzamy wprost, że pole wiadomości i przyciski mieszczą się w ekranie); `nav.spec.js` -
  hamburger.
- Logujemy się **raz** (`global-setup.js`, zapisana sesja) - `/auth/signin` ma limit prób z jednego IP.
- Przy błędzie test wskazuje winne elementy (tag, klasa, prawa krawędź), więc od razu wiadomo, co poprawić.
- `chat-live.spec.js` - czat "na żywo": dwie osoby (zwykły użytkownik i admin) w dwóch osobnych kontekstach
  przeglądarki, w jednej rozmowie. Sprawdza, że to, co zrobi jedna, druga widzi BEZ odświeżania strony: nowa
  wiadomość, "pisze...", odpowiedź z cytatem, reakcje, edycja i usunięcie, przycisk "Nowe wiadomości" przy czytaniu
  starszych oraz mini czat w nawigacji (plakietka, emoji, odpowiedź). Testy idą po kolei (jedna wspólna rozmowa).
- `chat-narrow.spec.js` - czat na telefonie i w małym oknie: lista rozmów (wyszukiwarka graczy, nowa grupa) jest dostępna,
  otwarta rozmowa ma przycisk powrotu; na szerokich ekranach lista i rozmowa są obok siebie.
- Nie są częścią `npm test` (potrzebują przeglądarki), ale w CI mają własne zadanie (`responsive` w
  `.github/workflows/main_gameverse.yml`), od którego zależy wdrożenie. Lokalnie uruchamiaj je po zmianach w
  CSS, widokach i skryptach czatu.

## Czat i podsumowania e-mail w testach Jest

- `chatMessageActions.test.js` - odpowiedzi, edycja, usuwanie, reakcje, "pisze...", doczytywanie zmian (`?since=`),
  zdarzenia rozsyłane do uczestników (szpieg na `utils/chatEvents.publish`) i moderacja (miękkie usunięcie z panelu).
- `chatStream.test.js` - prawdziwe połączenie SSE do serwera HTTP na losowym porcie (supertest nie radzi sobie ze
  strumieniami bez końca): nowa wiadomość i "pisze..." docierają do drugiej osoby, wylogowanie zamyka strumień.
- `chatGroupsOwnership.test.js` - kto może usunąć/wyczyścić grupę, opuszczanie, przekazanie własności.
- `chatInvitesAndDeletes.test.js` - link z powiadomienia do zaproszenia (`?invite=`), widok listy/rozmowy, powiadomienia
  o usunięciu rozmowy/grupy i o wyrzuceniu z grupy oraz usuwanie pokojów gier pozostałych w bazie.
- `reviewComments.test.js` - powiadomienia o komentarzach linkują do komentarza (`#comment-ID`), a polubienie,
  zgłoszenie i usunięcie działają tak samo na stronie gry i na listach recenzji.
- `blogExcerpt.test.js` i `tests/unit/seo.test.js` - zajawki wpisów bez znaczników wstawek (`[[game:ID]]` itd.).
- `emailDigest.test.js` - podsumowanie nieprzeczytanych na e-mail; wysyłka jest podstawiona (`mailer`), więc
  żadna prawdziwa poczta nie wychodzi. Sprawdza m.in., że bez zgody nic nie idzie, że nie ma "pustych" listów
  ani powtórek, i że dwie instancje serwera nie wyślą tego samego listu dwa razy.
