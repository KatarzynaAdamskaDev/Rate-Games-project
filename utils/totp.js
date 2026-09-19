/**
 * Dwuetapowe logowanie (2FA) w standardzie TOTP (RFC 6238) - kody z aplikacji
 * typu Google Authenticator, Microsoft Authenticator, Authy czy 1Password.
 * Bez zewnętrznych bibliotek: HMAC-SHA1 z modułu crypto, sekret w formacie base32.
 */
const crypto = require('crypto');
const QRCode = require('qrcode');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = 'GameVerse';
const RECOVERY_CODES_COUNT = 8;

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary =
    ((hmac[offset] & 127) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Ostatnio zaakceptowany krok czasowy każdego konta - ten sam kod nie zadziała dwa razy.
const lastUsedStep = new Map();

/**
 * Sprawdza 6-cyfrowy kod (z tolerancją ±1 krok, czyli ±30 s zegara).
 * @returns {boolean} true, gdy kod jest poprawny i nie był jeszcze użyty
 */
function verifyCode(secret, code, accountKey) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!secret || !/^\d{6}$/.test(clean)) return false;

  const currentStep = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let drift = -1; drift <= 1; drift += 1) {
    const step = currentStep + drift;
    const expected = hotp(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) {
      if (accountKey && (lastUsedStep.get(accountKey) || 0) >= step) return false;
      if (accountKey) lastUsedStep.set(accountKey, step);
      return true;
    }
  }
  return false;
}

function buildOtpAuthUri(secret, account) {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** Kod QR do zeskanowania w aplikacji uwierzytelniającej (data URL obrazka PNG). */
function buildQrDataUrl(secret, account) {
  return QRCode.toDataURL(buildOtpAuthUri(secret, account), { margin: 1, width: 220 });
}

/* ------------------------------ kody awaryjne ------------------------------ */

function hashRecoveryCode(code) {
  return crypto
    .createHash('sha256')
    .update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest('hex');
}

/** Zwraca kody do pokazania użytkownikowi (jednorazowo) i ich hasze do zapisu w bazie. */
function generateRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODES_COUNT }, () => {
    const raw = base32Encode(crypto.randomBytes(6)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/**
 * Sprawdza kod awaryjny na liście zapisanych haszy.
 * @returns {string[]|null} lista haszy po zużyciu kodu albo null, gdy kod nie pasuje
 */
function consumeRecoveryCode(storedHashesJson, code) {
  let hashes;
  try {
    hashes = JSON.parse(storedHashesJson || '[]');
  } catch (err) {
    return null;
  }
  const wanted = hashRecoveryCode(code || '');
  const index = hashes.indexOf(wanted);
  if (index === -1) return null;
  hashes.splice(index, 1);
  return hashes;
}

module.exports = {
  generateSecret,
  verifyCode,
  buildQrDataUrl,
  generateRecoveryCodes,
  consumeRecoveryCode,
  RECOVERY_CODES_COUNT,
};
