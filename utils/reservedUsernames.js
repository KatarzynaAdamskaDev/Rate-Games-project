// Nazwy zastrzeżone przez ścieżki URL aplikacji - użytkownik nie może się
// tak nazwać (ani zmienić nazwy na taką), bo /:username jest zamontowane
// jako "łapacz wszystkiego" na końcu app.js i musi ustąpić pierwszeństwa
// wszystkim innym trasom aplikacji.
const RESERVED_USERNAMES = [
  'games',
  'category',
  'blog',
  'search',
  'profile',
  'chat',
  'reviews',
  'auth',
  'friends',
  'users',
  'admin',
  'api',
  'notifications', 'reports',
  // strony informacyjne i pliki dla robotów
  'aboutus', 'help', 'legal', 'contact', 'feed', 'sitemap', 'robots', 'llms',
];

function isReservedUsername(username) {
  return RESERVED_USERNAMES.includes(String(username).trim().toLowerCase());
}

module.exports = { RESERVED_USERNAMES, isReservedUsername };