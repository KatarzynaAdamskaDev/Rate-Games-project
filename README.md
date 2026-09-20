# GameVerse

Strona z opiniami o grach - Node.js + Express + EJS + Bootstrap, dane w bazie SQL (SQLite lokalnie, Azure SQL na produkcji), katalog gier z IGDB.

## Struktura katalogów

```
gameverse/
├── bin/www              # skrypt startujący serwer HTTP
├── middleware/          # auth.js, locals.js, rateLimit.js, errorHandlers.js
├── public/              # CSS, JS, obrazki (pliki statyczne)
├── routes/              # index, auth, games, blog, search, profile, chat, reviews, notifications, admin
├── views/               # szablony EJS (partials, auth, games, blog)
├── models/              # modele Sequelize (użytkownicy, recenzje, czat, powiadomienia...)
├── utils/               # logika aplikacji (katalog gier IGDB, statystyki, profile, czat)
├── data/                # blog.json oraz lokalna baza SQLite (dev.sqlite3)
├── app.js               # konfiguracja aplikacji Express
├── scripts/setup.js     # npm run setup - instalacja wszystkiego jedną komendą
├── create-admin.js      # skrypt CLI do utworzenia konta administratora
└── package.json
```

## Wymagania

- **Node.js 20.17 lub nowszy** (najlepiej 22 LTS - wersja 22+ jest potrzebna do połączenia z Azure SQL na produkcji).
  Pobierzesz go z https://nodejs.org (razem z nim instaluje się `npm`).
- Konto deweloperskie Twitch (darmowe) po klucze do katalogu gier IGDB:
  https://dev.twitch.tv/console - utwórz aplikację i skopiuj `Client ID` oraz `Client Secret`.

Nic więcej nie trzeba: baza SQLite tworzy się sama, a wszystkie biblioteki instalują się jednym poleceniem.

## Instalacja - jedna komenda

```bash
npm run setup
```

Skrypt `scripts/setup.js` sprawdza wersję Node.js, instaluje wszystkie zależności (`npm install`), tworzy
plik `.env` z `.env.example` (z wylosowanym `SESSION_SECRET`) oraz katalogi na wgrywane pliki.
Jeśli wolisz to zrobić ręcznie:

```bash
npm install
cp .env.example .env    # Windows (PowerShell): Copy-Item .env.example .env
```

### Co instaluje `npm install`

Wszystko jest zapisane w `package.json` - nie trzeba instalować pojedynczych pakietów.

| Pakiet | Do czego służy |
| --- | --- |
| `express`, `ejs`, `express-session`, `connect-flash`, `morgan` | serwer, widoki, sesje (w bazie), komunikaty, logi |
| `sequelize`, `sqlite3`, `tedious` | baza danych: SQLite lokalnie, Azure SQL (`tedious`) na produkcji |
| `bcryptjs` | bezpieczne hashowanie haseł |
| `multer`, `sharp` | wgrywanie plików i sprawdzanie / zmniejszanie obrazów (awatary, okładki) |
| `opentype.js` | rysowanie tytułów na automatycznie tworzonych okładkach bloga (czcionka w `assets/fonts`) |
| `qrcode` | kod QR do włączenia 2FA administratorów |
| `axios`, `igdb-api-node` | pobieranie gier z IGDB |
| `nodemailer` | wysyłka maili z resetem hasła |
| `dotenv`, `uuid` | zmienne środowiskowe, identyfikatory |
| `nodemon` (dev) | automatyczny restart serwera w trybie `npm run dev` |

Pakiety `sqlite3` i `sharp` mają gotowe binaria dla Windows, macOS i Linuksa - nie wymagają kompilatora.

### Plik `.env`

Uzupełnij go po instalacji (wzór: `.env.example`):

- `SESSION_SECRET` - długi, losowy ciąg znaków (na produkcji obowiązkowy - bez niego serwer się nie uruchomi).
- `SITE_URL` - publiczny adres serwisu bez końcowego ukośnika (np. `https://twoja-domena.pl`). Trafia do `sitemap.xml`,
  `robots.txt` i podglądów linków (Open Graph). Puste = adres brany z żądania.
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` - klucze IGDB. Bez nich aplikacja działa, ale bez katalogu gier.
- `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` - opcjonalnie, klucze reCAPTCHA v2 "Checkbox"
  (https://www.google.com/recaptcha/admin/create). Puste = rejestracja bez realnej weryfikacji captchy.
- `EMAIL_USER` / `EMAIL_PASS` - opcjonalnie, konto Gmail i hasło aplikacji do maili z resetem hasła.
- `AZURE_SQL_*` i `NODE_ENV=production` - tylko na produkcji (baza Azure SQL).

## Uruchomienie

```bash
npm start        # produkcyjnie
npm run dev      # z nodemon (auto-restart)
```

Aplikacja domyślnie startuje na `http://localhost:3000`.

## Konto administratora

Panel administratora, dodawanie gier ręcznie i wpisów na blogu wymagają roli `admin`.
Utwórz takie konto poleceniem:

```bash
npm run create-admin -- admin@example.com admin MojeHaslo123
```

Administrator ma w nawigacji link **ADMIN** (`/admin`): pulpit ze statystykami,
użytkownicy (blokady, role, poziomy, "odblokuj wszystko", reset 2FA), recenzje,
zgłoszenia, komentarze, gry własne, blog, moderacja czatu, eksport CSV i kopie
zapasowe bazy, dziennik działań oraz ustawienia (ogłoszenie, filtr wulgaryzmów,
antyspam, limity zapytań, wymóg 2FA).

### Moderacja: blokady czasowe, wyciszenia, zgłoszenia, blokowanie użytkowników

- Admin blokuje konto na 1 / 7 / 30 dni albo bezterminowo (czasowa blokada wygasa sama) i może
  **wyciszyć** użytkownika: czyta serwis, ale nie pisze recenzji, komentarzy ani wiadomości.
- Zgłosić można recenzję, komentarz, użytkownika i wiadomość na czacie (jedno okno z powodem);
  wszystkie trafiają do kolejki w panelu (Zgłoszenia), a odrzucenie wymaga podania powodu.
- Użytkownik może zablokować inne konto: ukrywa jego komentarze, a tamta osoba nie napisze do niego
  na czacie ani go nie zaobserwuje (Edytuj profil -> Zablokowani użytkownicy).
- Wgrywane obrazy (awatary, okładki bloga) są sprawdzane po sygnaturze pliku, ograniczane wymiarami
  i przekodowywane do WebP (biblioteka `sharp` - po aktualizacji uruchom `npm install`).

### Nadawanie i odbieranie uprawnień administratora

Zmiana roli wymaga potwierdzenia: wpisania nazwy użytkownika, własnego hasła i (przy
włączonym 2FA) kodu. Nowy administrator ma 7 dni okresu próbnego, w którym nie zmienia
uprawnień innym, a administrator nie może odebrać uprawnień komuś, kto jest nim dłużej
(konta założycielskie, np. z `create-admin.js`, są najstarsze). Po 5 błędnych
potwierdzeniach zmiany blokują się na 10 minut, a o każdej zmianie wszyscy administratorzy
dostają powiadomienie i wpis w dzienniku.

### Weryfikacja dwuetapowa (2FA) administratorów

Administrator włącza 2FA w **Edytuj profil -> Konto i bezpieczeństwo** (kod QR do
aplikacji typu Google Authenticator + jednorazowe kody awaryjne). Po włączeniu
logowanie wymaga kodu, a w panelu **Ustawienia** można wymusić 2FA dla wszystkich
administratorów. Zgubiony telefon: inny administrator wyłącza 2FA w
**Użytkownicy -> Akcje**.

### Limity zapytań i antyspam

Limity (logowanie, rejestracja, recenzje, komentarze, czat i inne) trzymane są w
pamięci procesu i można je wyłączyć w panelu. Za serwerem pośredniczącym
(Azure App Service) aplikacja ufa nagłówkowi `X-Forwarded-For` tylko przy
`NODE_ENV=production`.

## Dane

Użytkownicy, recenzje, komentarze, czat, powiadomienia i pozostałe dane
aplikacji są zapisywane w bazie danych (Sequelize): lokalnie w pliku SQLite
`data/dev.sqlite3`, a na produkcji w Azure SQL. Brakujące tabele i kolumny są
uzupełniane przy starcie serwera.

Gry pochodzą z API IGDB (wymagane `TWITCH_CLIENT_ID` i `TWITCH_CLIENT_SECRET`
w `.env`); gry dodane ręcznie przez administratora trafiają do tabeli
`custom_games`. W formularzu ręcznego dodawania gry (Panel admina -> Gry własne) wpisanie tytułu
(np. "CS2") uruchamia podpowiedzi z IGDB: po wybraniu gry formularz sam uzupełnia platformy, rok,
kategorię, opis i okładkę (okładka jest pobierana, sprawdzana i zapisywana lokalnie jako WebP).
Bez kluczy IGDB formularz działa jak dotychczas - dane wpisuje się ręcznie.
Jedynie wpisy na blogu są nadal w pliku `data/blog.json`.

Hasła użytkowników są hashowane przy pomocy `bcryptjs` - nigdy nie są
zapisywane jawnie.

## Funkcje

- Strona główna z sekcją "hero" i najnowszymi grami/wpisami blogowymi
- Rejestracja (e-mail, nazwa użytkownika, hasło, zgody, reCAPTCHA)
- Logowanie (sesja po stronie serwera, opcja "remember me")
- Reset hasła (formularz z komunikatem, bez faktycznej wysyłki e-maila -
  do podłączenia np. przez `nodemailer`)
- Lista gier z filtrowaniem po kategorii i sortowaniem
- Strona szczegółów gry z listą opinii i formularzem dodawania opinii
  (tylko dla zalogowanych użytkowników)
- Kategorie gier
- Blog (lista + pojedynczy wpis)
- Wyszukiwarka (gry + wpisy blogowe) - rozumie skróty i początki nazw ("cs", "cs2", "gta5", "mc", "botw", "minecr"),
  patrz `utils/gameSearch.js`; własne skróty dopisuje się w `utils/gameAliases.js`. Toleruje też inny zapis tytułu
  ("little big planet" = LittleBigPlanet, "spider man" = Spider-Man, "final fantasy 7" = Final Fantasy VII,
  "ratchet and clank" = Ratchet & Clank) oraz literówki w nazwach popularnych gier ("skirym") - `utils/searchText.js`
- SEO i udostępnianie: znaczniki Open Graph / Twitter Card i dane strukturalne (JSON-LD) dla gier, recenzji
  (link `/games/ID?review=ID` ma własny podgląd), wpisów bloga i profili, przyciski "Udostępnij", `robots.txt`
  i `sitemap.xml` (opublikowane wpisy, gry z recenzjami, gry własne i najpopularniejsze gry z IGDB; bez szkiców
  i zaplanowanych wpisów). Kod: `middleware/seo.js`, `utils/seo.js`, `routes/seo.js`, `views/partials/head.ejs`
- GEO (widoczność w odpowiedziach chatbotów i wyszukiwarek AI): `/llms.txt` i `/llms-full.txt` (opis serwisu, fakty,
  FAQ, popularne gry z ocenami graczy i treść wpisów w Markdownie), `robots.txt` z jawnym wpuszczeniem crawlerów
  ChatGPT, Claude, Perplexity, Gemini i innych, dane strukturalne (Organization, WebSite, VideoGame, BlogPosting,
  FAQPage, BreadcrumbList, ItemList), strony `/aboutus` i `/help` (FAQ), kanał RSS `/feed.xml` oraz wpisy bloga jako
  Markdown (`/blog/ID.md`). Wszystkie opisy pochodzą z jednego miejsca - `utils/siteFacts.js` (funkcje, FAQ, liczby) -
  edytuj je tam, gdy zmieni się serwis
- Okładki bloga tworzone automatycznie (`utils/blogCoverGenerator.js`): grafika 1200x630 z tytułu, kategorii i tagów -
  kolory zależą od kategorii, wzór tła od tytułu, przycisk "Inny wariant" losuje nowy wygląd. Działa bez zewnętrznych
  usług i tak samo na każdym serwerze (tekst jest zamieniany na krzywe). Własny plik lub adres zastępuje okładkę
- Edytor wpisów jako mini CMS (`/blog/new`): zdjęcia i infografiki z tekstem alternatywnym, podpisem i układem (wgrywane
  z komputera, wklejane ze schowka albo z biblioteki multimediów - `utils/blogMedia.js`, pliki sprawdzane i zapisywane jako
  WebP), okno linków z wyszukiwarką gier z katalogu, karty gier (`[[game:ID]]`), filmy YouTube w trybie prywatności
  (`@[youtube](ID)`), ramki (`> [!TIP] ...`), linia pozioma i powiększanie zdjęć we wpisie. Składnia zdjęcia:
  `![opis](/images/...  "podpis"){wide}` (układy: wide, small, left, right)
- Asystent SEO w edytorze wpisów (`utils/seoAssistant.js`, liczony lokalnie, bez zewnętrznych usług): propozycje tagów
  z treści (tytuły gier z katalogu, platformy, gatunki, nazwy własne, powtarzające się frazy), ocena SEO z listą
  kontrolną i podpowiedziami oraz przycisk "Formatuj pod SEO" - pogrubia pierwsze wystąpienie najważniejszych fraz,
  linkuje gry z katalogu (`/games/ID`), zamienia punktory, krótkie linie i adresy URL na listy, śródtytuły i linki,
  z możliwością cofnięcia. Zmiany widać na liście przed zapisem wpisu
- Edytor wpisów bloga (`/blog/new`): karty jak w formularzu gry, pasek formatowania ze skrótami (Ctrl+B / I / K), podgląd treści
  na żywo, tagi jako chipy z podpowiedziami, okładka przeciągana na pole, podgląd karty na liście, lista kontrolna oraz
  automatyczny zapis kopii roboczej w przeglądarce (z przywracaniem po zamknięciu karty)
- Blog: szkice, zaplanowana publikacja (wpis pojawia się sam o wybranej porze), tagi (`/blog?tag=...`) oraz
  komentarze pod wpisami z tą samą moderacją co komentarze pod recenzjami (wyciszenie, limit, filtr wulgaryzmów,
  zgłaszanie, ukrywanie komentarzy zablokowanych osób, usuwanie przez autora i administratora, panel
  Komentarze -> "Pod wpisami bloga")
- Lista gier ma numerowany pasek stron (pierwsza, ostatnia, okolice bieżącej) i pole "idź do strony" - `views/partials/pager.ejs`
- Sortowanie "Popularne" (lista gier, strona główna, wyniki wyszukiwania) opiera się na danych o graczach z IGDB
  (kto gra teraz, kto zagrał, Steam) - `utils/gamePopularity.js`; ranking odświeża się co kilka godzin
- Panel dodawania gier / wpisów na blogu dla roli `admin`
- Edycja profilu w zakładkach (ogólne, awatar, wygląd, powiadomienia, konto) z wyborem rodzajów powiadomień
- Panel administratora `/admin` (patrz wyżej)

## Czego brakuje / co warto dodać dalej

- Realna wysyłka e-maili przy resecie hasła (np. `nodemailer`)
- Upload obrazków (obecnie okładki gier/wpisów to ścieżki do plików w `public/images`)
- Edycja/usuwanie własnych opinii
- Paginacja przy większej liczbie gier/wpisów
- Migracja z plików JSON na prawdziwą bazę danych, gdy liczba użytkowników wzrośnie
  (obecne rozwiązanie nie jest bezpieczne przy równoczesnym zapisie z wielu procesów)
