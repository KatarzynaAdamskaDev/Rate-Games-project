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

## Czat

Rozmowy prywatne (tylko wzajemni znajomi), grupy z zaproszeniami i mini czat w nawigacji. 
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
  i przekodowywane do WebP.

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

Kopia zapasowa z panelu admina (JSON) obejmuje tabele bloga razem z resztą bazy.


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
- Panel administratora `/admin` 
