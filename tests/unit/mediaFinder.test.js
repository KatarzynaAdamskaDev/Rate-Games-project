/**
 * Część utils/mediaFinder.js, która nie łączy się z siecią: sprawdzanie licencji zdjęć (tylko wolne
 * licencje trafiają do artykułów) i rozpoznawanie prywatnych adresów IP (ochrona przed SSRF przy
 * pobieraniu zdjęć spoza serwisu). Wyszukiwanie i pobieranie mają test integracyjny na żywych,
 * publicznych usługach - patrz tests/integration/media-live.test.js (pomijany bez internetu).
 */
const { licenseAllowed, isPrivateIp } = require('../../utils/mediaFinder');

describe('licenseAllowed', () => {
  test('wolne licencje (CC0, domena publiczna, CC BY, CC BY-SA) są dozwolone', () => {
    expect(licenseAllowed('CC0 1.0')).toBe(true);
    expect(licenseAllowed('Public domain')).toBe(true);
    expect(licenseAllowed('Domena publiczna')).toBe(true);
    expect(licenseAllowed('CC BY 2.0')).toBe(true);
    expect(licenseAllowed('CC BY-SA 4.0')).toBe(true);
  });

  test('licencje z ograniczeniem "użycie niekomercyjne" (NC) są odrzucane', () => {
    expect(licenseAllowed('CC BY-NC 4.0')).toBe(false);
    expect(licenseAllowed('CC BY-NC-SA 3.0')).toBe(false);
  });

  test('licencje "bez utworów zależnych" (ND) są odrzucane', () => {
    expect(licenseAllowed('CC BY-ND 2.0')).toBe(false);
  });

  test('inne/nieznane/puste licencje są odrzucane (domyślnie bezpiecznie)', () => {
    expect(licenseAllowed('GFDL')).toBe(false);
    expect(licenseAllowed('All rights reserved')).toBe(false);
    expect(licenseAllowed('')).toBe(false);
    expect(licenseAllowed(undefined)).toBe(false);
  });
});

describe('isPrivateIp (ochrona przed SSRF)', () => {
  test('rozpoznaje prywatne zakresy IPv4', () => {
    expect(isPrivateIp('10.0.0.5')).toBe(true);
    expect(isPrivateIp('192.168.1.1')).toBe(true);
    expect(isPrivateIp('172.20.1.1')).toBe(true);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
  });

  test('rozpoznaje adres metadanych chmury (169.254.169.254)', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
  });

  test('rozpoznaje prywatne adresy IPv6', () => {
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('fd00::1')).toBe(true);
  });

  test('publiczny adres IP nie jest oznaczony jako prywatny', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
  });

  test('172.x poza zakresem 16-31 (np. 172.32.x) nie jest prywatny', () => {
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('172.15.0.1')).toBe(false);
  });
});
