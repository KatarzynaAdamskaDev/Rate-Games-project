const { plainText, stripEmbeds } = require('../../utils/seo');

// Znaczniki wstawek z treści wpisu ([[game:ID]], film, zdjęcia) nie mogą trafiać do zajawek i opisów -
// wcześniej [[game:242408]] w środku akapitu wyświetlał się na liście wpisów jako surowy tekst.
describe('zajawki i opisy bez znaczników wstawek', () => {
  test('karta gry w środku zdania znika, reszta tekstu zostaje', () => {
    const text = 'czy gracze CS2 w ogóle wiedzą w co grają? [[game:242408]] odpowiadamy że tak! Ale nie zawsze potrafią.';
    expect(stripEmbeds(text)).not.toContain('[[game');
    expect(plainText(text)).toBe('czy gracze CS2 w ogóle wiedzą w co grają? odpowiadamy że tak! Ale nie zawsze potrafią.');
  });

  test('film YouTube, zdjęcie i znaczniki pomocnika pisania też znikają', () => {
    const text = 'Wstęp @[youtube](https://youtu.be/abc) środek ![opis](/img.png){wide} koniec {{img:2}} i {{video}}.';
    expect(plainText(text)).toBe('Wstęp środek koniec i .');
  });

  test('karty gier w osobnych liniach nadal są usuwane', () => {
    expect(plainText('Akapit.\n[[game:abc-123]]\nDrugi akapit.')).toBe('Akapit. Drugi akapit.');
  });

  test('zwykły tekst z nawiasami kwadratowymi nie ginie', () => {
    expect(plainText('Ocena [9/10] i [link](https://x.pl) w tekście')).toBe('Ocena [9/10] i link w tekście');
  });
});
