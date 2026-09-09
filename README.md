# GameVerse

Strona z opiniami o grach - Node.js + Express + EJS + Bootstrap, dane przechowywane w plikach JSON.

## Struktura katalogów

```
gameverse/
├── bin/www              # skrypt startujący serwer HTTP
├── middleware/          # auth.js, locals.js, errorHandlers.js
├── public/              # CSS, JS, obrazki (pliki statyczne)
├── routes/              # index, auth, games, category, blog, search
├── views/               # szablony EJS (partials, auth, games, blog)
├── utils/               # dostęp do danych JSON (dataStore, gameHelpers, userHelpers)
├── data/                # users.json, games.json, reviews.json, blog.json
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

Aplikacja **nie korzysta z bazy danych** - wszystkie dane (użytkownicy, gry,
opinie, wpisy na blogu) są przechowywane w plikach JSON w katalogu `data/`.
Pliki `games.json`, `reviews.json` i `blog.json` są wstępnie wypełnione
przykładowymi danymi.

Hasła użytkowników są hashowane przy pomocy `bcryptjs` - w plikach JSON nigdy
nie są zapisywane jawne hasła.

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
