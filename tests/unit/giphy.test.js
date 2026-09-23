const { isGiphyCdnUrl, searchGifs } = require('../../utils/giphy');

describe('isGiphyCdnUrl', () => {
  test('akceptuje adresy z domeny giphy.com i jej subdomen', () => {
    expect(isGiphyCdnUrl('https://media.giphy.com/media/abc/giphy.gif')).toBe(true);
    expect(isGiphyCdnUrl('https://media3.giphy.com/media/abc/giphy.gif')).toBe(true);
    expect(isGiphyCdnUrl('https://i.giphy.com/abc.gif')).toBe(true);
    expect(isGiphyCdnUrl('https://giphy.com/gifs/abc')).toBe(true);
  });

  test('odrzuca domeny udające giphy.com (np. jako poddomenę ataku)', () => {
    expect(isGiphyCdnUrl('https://giphy.com.evil.test/x.gif')).toBe(false);
    expect(isGiphyCdnUrl('https://notgiphy.com/x.gif')).toBe(false);
    expect(isGiphyCdnUrl('https://evilgiphy.com/x.gif')).toBe(false);
  });

  test('odrzuca http (wymaga https) i nieprawidłowe adresy', () => {
    expect(isGiphyCdnUrl('http://media.giphy.com/x.gif')).toBe(false);
    expect(isGiphyCdnUrl('nie jest adresem')).toBe(false);
    expect(isGiphyCdnUrl('')).toBe(false);
  });
});

describe('searchGifs', () => {
  const originalKey = process.env.GIPHY_API_KEY;
  afterEach(() => { process.env.GIPHY_API_KEY = originalKey; });

  test('bez klucza API zwraca pustą listę, nie rzuca błędu', async () => {
    process.env.GIPHY_API_KEY = '';
    expect(await searchGifs('koty')).toEqual([]);
  });

  test('bez zapytania (puste/białe znaki) zwraca pustą listę', async () => {
    process.env.GIPHY_API_KEY = 'dowolny-klucz-testowy';
    expect(await searchGifs('   ')).toEqual([]);
    expect(await searchGifs(undefined)).toEqual([]);
  });
});
