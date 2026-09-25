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
├── config/              # baza danych (database.js) i katalogi wgrywanych plików (storage.js)
├── data/                # lokalna baza SQLite (dev.sqlite3, poza repozytorium) i wpisy startowe bloga (blog.seed.json)
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
| `nodemailer` | wysyłka maili (reset hasła, opcjonalne podsumowania nieprzeczytanych) |
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
- `EMAIL_USER` / `EMAIL_PASS` - opcjonalnie, konto Gmail i hasło aplikacji do maili: reset hasła oraz podsumowania
  nieprzeczytanych (patrz "Czat" niżej). Bez nich poczta po prostu nie działa, reszta serwisu tak.
- `GIPHY_API_KEY` - opcjonalnie, klucz Giphy (https://developers.giphy.com/dashboard) do wyszukiwarki GIF-ów na czacie.
  Bez niego przycisk GIF działa, ale zawsze pokazuje pustą listę.
- `EMAIL_DIGEST=off` - opcjonalnie, wyłącza wysyłanie podsumowań nawet przy skonfigurowanej poczcie;
  `EMAIL_DIGEST_INTERVAL_HOURS` - najkrótszy odstęp między podsumowaniami dla jednej osoby (domyślnie 24).
- `AZURE_SQL_*` i `NODE_ENV=production` - tylko na produkcji (baza Azure SQL).
- `UPLOADS_DIR` - opcjonalnie, katalog na pliki wgrywane przez użytkowników (awatary, okładki, zdjęcia z bloga,
  okładki gier). Puste = `public/images`. Na serwerze wdrażanym paczką ustaw trwały katalog poza aplikacją
  (Azure App Service: `/home/uploads`) - patrz "Wdrożenie na Azure".

## Uruchomienie

```bash
npm start        # produkcyjnie
npm run dev      # z nodemon (auto-restart)
```

Aplikacja domyślnie startuje na `http://localhost:3000`.

## Testy

```bash
npm test                  # wszystkie testy (jednostkowe i integracyjne), ok. 300 testów w kilka sekund
npm run test:coverage     # to samo + raport pokrycia w coverage/index.html
npm run test:responsive   # Playwright, prawdziwa przeglądarka: układ stron na 6 szerokościach ekranu + czat na żywo
```

Testy Playwright wymagają jednorazowo `npx playwright install chromium`; nie są częścią `npm test` (osobna komenda),
ale w CI mają własne zadanie.

Testy uruchamiają się na własnej, tymczasowej bazie SQLite i nie potrzebują żadnych kluczy API ani
internetu - nie dotykają `data/dev.sqlite3` ani prawdziwych danych. GitHub Actions ([workflow
wdrożeniowy](.github/workflows/main_gameverse.yml)) uruchamia oba zestawy (Jest i Playwright, w osobnych zadaniach)
przy każdym pushu do `main` i pull requeście, a wdrożenie na Azure rusza dopiero, gdy oba przejdą. Więcej w [tests/README.md](tests/README.md)
(jak dodać nowy test, czego testy świadomie nie sprawdzają).

## Czat

Rozmowy prywatne (tylko wzajemni znajomi), grupy z zaproszeniami i mini czat w nawigacji. Pokoje gier zlikwidowano -
przy starcie serwer usuwa te, które zostały w bazie po starej wersji.

- **Na żywo (SSE).** Przeglądarka trzyma jedno połączenie `GET /chat/stream` (`utils/chatEvents.js`); przez nie
  płyną nowe wiadomości, edycje, reakcje, "pisze...", zmiany w rozmowach i liczniki w nawigacji. Bez odświeżania
  strony i bez odpytywania co kilka sekund. Rejestr połączeń jest w pamięci procesu (jak limity zapytań), więc przy
  kilku instancjach serwera klient dodatkowo rzadko dociąga zmiany zwykłym zapytaniem (`?since=`) - nic nie ginie,
  najwyżej dociera z opóźnieniem. Gdy strumień nie działa (stary proxy), czat wraca do odpytywania co 4 s.
- **Wiadomości:** odpowiedzi z cytatem (jak w Messengerze), edycja i usuwanie własnych wiadomości (usunięta zostaje
  jako "Wiadomość została usunięta", treść jest czyszczona), 6 reakcji, emoji i GIF-y (Giphy) także w mini czacie.
- **Grupy:** usuwać i czyścić grupę może tylko właściciel; pozostali mogą ją opuścić, a właściciel przekazać
  własność innemu członkowi (albo wyjść - własność przechodzi na najdłużej będącego członka). Powiadomienie o
  zaproszeniu prowadzi do karty zaproszenia (`/chat?invite=ID`) z przyciskami "Dołącz" i "Odrzuć". Usunięcie
  rozmowy prywatnej albo grupy (i wyrzucenie z grupy) wysyła powiadomienie drugiej stronie.
- **Wąskie ekrany (do 980 px):** widać albo listę rozmów (wyszukiwarka graczy, nowa grupa, zaproszenia), albo otwartą
  rozmowę z przyciskiem powrotu do listy - `data-view` na `.gv-chat-shell`.
- **Podsumowanie na e-mail (opcjonalne, domyślnie wyłączone):** w Edytuj profil -> Powiadomienia użytkownik może
  włączyć list z nieprzeczytanymi wiadomościami i powiadomieniami. Wychodzi najwyżej raz na dobę i tylko jeśli od
  poprzedniego listu coś przybyło (`utils/emailDigest.js`); wymaga `EMAIL_USER` / `EMAIL_PASS`.

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
Wpisy na blogu też są w bazie: tabele `blog_posts` (treść, okładka, status, termin publikacji) i `blog_post_tags`
(tagi), a komentarze pod wpisami w `blog_comments`. Usunięcie wpisu kasuje jego tagi, komentarze i wgraną okładkę.
Dawny plik `data/blog.json` nie jest już używany na bieżąco: przy pierwszym starcie z pustą tabelą aplikacja
jednorazowo wczytuje z niego wpisy (a gdy go nie ma - dwa wpisy startowe z `data/blog.seed.json`). Wpisy z innego
pliku, także do bazy produkcyjnej (z `.env` albo zmiennymi `AZURE_SQL_*`), wczytasz ręcznie:

```bash
npm run blog:import -- sciezka/do/blog.json            # pomija wpisy, które już są w bazie
npm run blog:import -- sciezka/do/blog.json --overwrite # nadpisuje wpisy o tych samych id
```

Kopia zapasowa z panelu admina (JSON) obejmuje tabele bloga razem z resztą bazy.

Hasła użytkowników są hashowane przy pomocy `bcryptjs` - nigdy nie są
zapisywane jawnie.

## Pomocnik pisania artykułów (blog)

W edytorze wpisów przycisk **Pomocnik pisania** otwiera okno, w którym podajesz temat, rodzaj artykułu (poradnik,
recenzja, zestawienie, aktualność, porównanie, felieton), punkty, które ma zawierać, gry z katalogu, ton i długość.
Z tego powstaje **kompletny artykuł gotowy do publikacji**: tytuł, krótki opis, tagi, kategoria i treść ułożona pod SEO
i wyszukiwarki AI (fraza kluczowa we wstępie, śródtytuły, część jako pytania, FAQ, linki i karty gier, podsumowanie),
razem ze zdjęciami i filmem. Wynik można obejrzeć, poprawić i wstawić do edytora (Ctrl+Z cofa wstawienie).

Etapy (postęp widać na żywo w oknie): sprawdzenie faktów w internecie -> napisanie tekstu -> dobór zdjęć -> film -> złożenie.

- **Tekst** pisze Claude (klucz `ANTHROPIC_API_KEY`, model z `ANTHROPIC_MODEL`, domyślnie `claude-opus-5`). Model nie zmyśla
  faktów i nie udaje osobistych doświadczeń; przy recenzjach i felietonach pojawia się uwaga, że AI w grę nie grała.
- **Fakty**: przed pisaniem model szuka w internecie (wyszukiwarka Claude; wymaga włączenia web search w ustawieniach
  konta Anthropic). Źródła trafiają do sekcji „Źródła”. Wyłączysz to w oknie albo przez `WRITER_WEB_SEARCH=0`.
- **Zdjęcia** wyłącznie na wolnych licencjach (CC0, domena publiczna, CC BY, CC BY-SA; bez NC i ND) z Wikimedia Commons
  i Openverse. Model ocenia miniatury i wybiera pasujące (odrzuca przypadkowe i nieodpowiednie). Zdjęcia są pobierane do
  biblioteki multimediów (WebP, tekst alternatywny), a autor i licencja trafiają do podpisu i sekcji „Źródła zdjęć”.
  Opcjonalnie zrzuty ekranu z IGDB - to materiały wydawców, a nie wolna licencja, więc opcja jest domyślnie wyłączona.
- **Film**: zwiastun z IGDB dla wskazanej gry, osadzony przez odtwarzacz YouTube (tryb prywatności) po sprawdzeniu przez
  oEmbed, że jest publiczny i pozwala na osadzanie. Bez gry z katalogu film znajdzie wyszukiwarka YouTube, jeśli
  ustawisz `YOUTUBE_API_KEY`.
- **Bez klucza Anthropic** powstaje tylko szkielet artykułu z prawdziwymi danymi z katalogu i miejscami `[UZUPEŁNIJ: ...]`
  (wpisu z takimi znacznikami nie da się opublikować, tylko zapisać jako szkielet/szkic). Kompletny tekst wymaga AI.
- Koszty pilnują limity `WRITER_MAX_PER_HOUR` (na administratora) i `WRITER_MAX_PER_DAY` (cały serwis); każde użycie trafia do
  dziennika działań (tokeny, wyszukiwania, liczba zdjęć). Do API Anthropic trafia treść zadania, dane wybranych gier,
  wyniki wyszukiwania i miniatury kandydatów na zdjęcia - bez danych kont.
- Bezpieczeństwo: wynik jest czyszczony (bez HTML i obcych linków), pobieranie plików ma limity i dopuszcza tylko wskazane
  hosty (ochrona przed SSRF), a wyniki wyszukiwania są dla modelu wyłącznie danymi.

## Kopiowanie danych: lokalna SQLite <-> Azure SQL

Skrypt `scripts/db-sync.js` kopiuje dane w obie strony. Domyślnie tylko pokazuje raport (nic nie zapisuje), a zapis
włącza dopiero `--apply`. Dane są scalane: wiersze, które już są w bazie docelowej, zostają bez zmian, a konflikty
(np. ta sama nazwa użytkownika pod innym id) są pomijane i wypisane w raporcie. Zapis to jedna transakcja, tabela
`sessions` nie jest kopiowana, a przed zapisem powstaje lista zmian w `data/backups/` (przy lokalnej bazie także jej kopia).

```bash
npm run db:push -- --env-file=.env.azure            # podgląd: lokalna SQLite -> Azure SQL
npm run db:push -- --env-file=.env.azure --apply    # zapis w Azure
npm run db:pull -- --env-file=.env.azure            # podgląd: Azure SQL -> lokalna SQLite
npm run db:pull -- --env-file=.env.azure --apply    # zapis w lokalnej bazie
```

Dane logowania do Azure trzymaj w `.env.azure` (`AZURE_SQL_SERVER`, `AZURE_SQL_DATABASE`, `AZURE_SQL_USER`,
`AZURE_SQL_PASSWORD`; plik jest w `.gitignore`), a w portalu Azure dodaj swój adres IP do zapory serwera SQL.
Inne opcje: `--tables=users,reviews`, `--exclude=admin_logs`, `--local=plik.sqlite3` oraz `--replace --confirm=NAZWA`
(zastępuje zawartość wybranych tabel, np. żeby lustrzanie odtworzyć bazę; NAZWA to nazwa bazy docelowej albo pliku).
`npm run db:list` wypisuje tabele. Pliki wgrane przez użytkowników nie są w bazie - kopiuje się je osobno (`UPLOADS_DIR`).
Lista zmian i kopia bazy sprzed zapisu lądują w `data/backups/` - inny katalog wskażesz zmienną `DB_SYNC_BACKUP_DIR`.

## Wdrożenie na Azure (App Service)

Workflow `.github/workflows/main_gameverse.yml` wdraża całą paczkę (kod bez plików z `.gitignore`) po każdym pushu
do `main`. Katalog aplikacji jest przy tym podmieniany (a przy włączonym `WEBSITE_RUN_FROM_PACKAGE` jest tylko do
odczytu), więc **niczego, co ma przetrwać wdrożenie, nie wolno trzymać w plikach aplikacji**. Dlatego:

- dane (użytkownicy, recenzje, wpisy bloga, komentarze, sesje) są w Azure SQL - `NODE_ENV=production` i `AZURE_SQL_*`
  w Ustawieniach aplikacji (Configuration -> Application settings),
- pliki wgrywane przez użytkowników mają trwały katalog poza aplikacją: ustaw `UPLOADS_DIR=/home/uploads`
  (Linux; katalog `/home` App Service jest trwały i wspólny dla instancji). Aplikacja poda te pliki pod tymi samymi
  adresami `/images/...`,
- ustaw też `SESSION_SECRET`, `SITE_URL` oraz klucze IGDB.

Pierwszy start po wdrożeniu tworzy brakujące tabele (także `blog_posts` i `blog_post_tags`) i wczytuje wpisy startowe.
Własne wpisy z komputera przenieś poleceniem `npm run blog:import` (patrz "Dane").

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
- Pliki wgrywane przez użytkowników leżą na dysku serwera (`UPLOADS_DIR`); docelowo warto przenieść je do Azure Blob
  Storage (zapis idzie przez jedno miejsce w kodzie: funkcje zapisujące przekodowany obraz w `routes/` i `utils/blogMedia.js`)
- Edycja/usuwanie własnych opinii
- Paginacja przy większej liczbie gier/wpisów
