# GameVerse

Strona z opiniami o grach - Node.js + Express + EJS + Bootstrap, dane przechowywane w plikach JSON.

## Struktura katalogów

```
gameverse/
├── bin/www              # skrypt startujący serwer HTTP
├── middleware/          # auth.js, locals.js, errorHandlers.js
├── public/              # CSS, JS, obrazki (pliki statyczne)
├── routes/              # index, auth, games, blog, search, profile, chat, reviews, notifications
├── views/               # szablony EJS (partials, auth, games, blog)
├── models/              # modele Sequelize (użytkownicy, recenzje, czat, powiadomienia...)
├── utils/               # logika aplikacji (katalog gier IGDB, statystyki, profile, czat)
├── data/                # blog.json oraz lokalna baza SQLite (dev.sqlite3)
├── app.js               # konfiguracja aplikacji Express
├── create-admin.js      # skrypt CLI do utworzenia konta administratora
└── package.json
```

## Wymagania

- Node.js 18+ (używany jest wbudowany `fetch` do weryfikacji reCAPTCHA)

## Instalacja

```bash
npm install
cp .env.example .env
```

Uzupełnij plik `.env`:

- `SESSION_SECRET` - dowolny losowy ciąg znaków
- `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` - klucze wygenerowane na
  https://www.google.com/recaptcha/admin/create (typ **reCAPTCHA v2 "Checkbox"**).
  Jeśli zostawisz je puste, formularz rejestracji będzie działał, ale bez
  realnej weryfikacji captchy (zobaczysz komunikat ostrzegawczy zamiast
  widżetu Google).

## Uruchomienie

```bash
npm start        # produkcyjnie
npm run dev      # z nodemon (auto-restart)
```

Aplikacja domyślnie startuje na `http://localhost:3000`.

## Konto administratora

Dodawanie gier (`/games/new`) i wpisów na blogu (`/blog/new`) wymaga roli
`admin`. Utwórz takie konto poleceniem:

```bash
node create-admin.js admin@example.com admin MojeHaslo123
```

## Dane

Użytkownicy, recenzje, komentarze, czat, powiadomienia i pozostałe dane
aplikacji są zapisywane w bazie danych (Sequelize): lokalnie w pliku SQLite
`data/dev.sqlite3`, a na produkcji w Azure SQL. Brakujące tabele i kolumny są
uzupełniane przy starcie serwera.

Gry pochodzą z API IGDB (wymagane `TWITCH_CLIENT_ID` i `TWITCH_CLIENT_SECRET`
w `.env`); gry dodane ręcznie przez administratora trafiają do tabeli
`custom_games`. Jedynie wpisy na blogu są nadal w pliku `data/blog.json`.

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
- Wyszukiwarka (gry + wpisy blogowe)
- Panel dodawania gier / wpisów na blogu dla roli `admin`

## Czego brakuje / co warto dodać dalej

- Realna wysyłka e-maili przy resecie hasła (np. `nodemailer`)
- Upload obrazków (obecnie okładki gier/wpisów to ścieżki do plików w `public/images`)
- Edycja/usuwanie własnych opinii
- Paginacja przy większej liczbie gier/wpisów
- Migracja z plików JSON na prawdziwą bazę danych, gdy liczba użytkowników wzrośnie
  (obecne rozwiązanie nie jest bezpieczne przy równoczesnym zapisie z wielu procesów)
