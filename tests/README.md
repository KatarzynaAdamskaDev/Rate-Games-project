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
- **Wyglądu strony (CSS, układ, urządzenia mobilne)** - testy sprawdzają wygenerowany HTML i kod stanu, nie
  to, jak to wygląda. Do tego służy ręczny podgląd w przeglądarce.
