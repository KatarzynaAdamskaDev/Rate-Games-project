/**
 * Bezpieczna obsługa wgrywanych obrazów (awatary, okładki bloga).
 * Nie ufamy nazwie ani typowi pliku od klienta:
 *  1. sprawdzamy sygnaturę (pierwsze bajty) - to musi być PNG, JPEG, GIF albo WEBP,
 *  2. odrzucamy zbyt duże obrazy (limit wymiarów i liczby pikseli - ochrona przed "bombami"),
 *  3. dekodujemy i zapisujemy obraz od nowa jako WebP, więc metadane i ewentualnie
 *     doklejone do pliku dane (np. kod skryptu) nie trafiają na serwer.
 */
const sharp = require('sharp');

const MAX_INPUT_DIMENSION = 6000; // px - większych obrazów nie przyjmujemy
const MAX_INPUT_PIXELS = 24 * 1000 * 1000; // limit dekodowania (ochrona pamięci)
const WEBP_QUALITY = 84;

class ImageRejectedError extends Error {
  constructor(message) {
    super(message);
    this.userFacing = true;
  }
}

/** Rozpoznaje format po sygnaturze pliku; null, gdy to nie obraz z listy dozwolonych. */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  const head = buffer.slice(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/**
 * Weryfikuje i przekodowuje obraz.
 * @param {Buffer} input zawartość pliku
 * @param {{ maxSize: number }} options największy dozwolony bok wyniku (px), obraz jest zmniejszany
 * @returns {Promise<{ buffer: Buffer, ext: string }>}
 * @throws {ImageRejectedError} gdy plik nie jest poprawnym, dozwolonym obrazem
 */
async function sanitizeImage(input, { maxSize }) {
  const type = detectImageType(input);
  if (!type) {
    throw new ImageRejectedError('Plik nie jest prawidłowym obrazem PNG, JPG, WEBP lub GIF.');
  }

  try {
    const animated = type === 'gif' || type === 'webp';
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated });
    const meta = await image.metadata();

    // Dla animacji sharp podaje wysokość jednej klatki (pageHeight).
    const height = meta.pageHeight || meta.height;
    if (!meta.width || !height) throw new Error('brak wymiarów');
    if (meta.width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
      throw new ImageRejectedError(`Obraz jest za duży (maksymalnie ${MAX_INPUT_DIMENSION} x ${MAX_INPUT_DIMENSION} px).`);
    }

    const buffer = await image
      .rotate() // uwzględnia orientację z EXIF, a metadane i tak nie zostaną zapisane
      .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    return { buffer, ext: '.webp' };
  } catch (err) {
    if (err instanceof ImageRejectedError) throw err;
    throw new ImageRejectedError('Nie udało się odczytać obrazu - plik jest uszkodzony albo nie jest obrazem.');
  }
}

module.exports = { sanitizeImage, detectImageType, ImageRejectedError, MAX_INPUT_DIMENSION };
