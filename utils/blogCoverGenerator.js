/**
 * Automatyczne okładki wpisów na blogu (1200x630, dobre też jako podgląd linku w mediach społecznościowych).
 *
 * Grafika powstaje z samych danych wpisu - kategorii, tytułu i tagów - bez zewnętrznych usług:
 *   - kolorystyka zależy od kategorii,
 *   - wzór tła (kule, siatka, piksele, promienie, trójkąty) i położenie dekoracji są losowane deterministycznie
 *     z tytułu, więc ten sam wpis zawsze wygląda tak samo, a różne wpisy różnią się od siebie,
 *   - "wariant" pozwala wylosować inny wygląd dla tego samego wpisu.
 * Teksty zamieniamy na krzywe (opentype.js + czcionka Space Grotesk z assets/fonts), więc wynik jest identyczny
 * na każdym serwerze - niezależnie od zainstalowanych czcionek. Rysowanie robi sharp (SVG -> WebP).
 */
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');
const sharp = require('sharp');
const ICONS = require('./coverIcons');

const WIDTH = 1200;
const HEIGHT = 630;
const PAD = 72;
const TEXT_WIDTH = 700;

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const LOGO_FILE = path.join(__dirname, '..', 'public', 'images', 'Game2.png');

const THEMES = {
  'Aktualności': { from: '#231a5c', to: '#7c5cff', accent: '#3fe0c5', icon: 'newspaper' },
  'Poradniki': { from: '#06333f', to: '#16a5b9', accent: '#ffd166', icon: 'compass-fill' },
  'Zestawienia': { from: '#4d1440', to: '#f0458f', accent: '#ffb238', icon: 'trophy-fill' },
  'Recenzje': { from: '#4a2604', to: '#f28c12', accent: '#fff0b8', icon: 'star-fill' },
  'Społeczność': { from: '#093a2c', to: '#22b57f', accent: '#b6f3ff', icon: 'people-fill' },
  'Inne': { from: '#161d3f', to: '#5567ff', accent: '#ff9be0', icon: 'stars' },
};
const DEFAULT_THEME = THEMES['Aktualności'];
const PATTERNS = ['orbs', 'grid', 'pixels', 'rays', 'triangles'];

let cache = null;

function loadFont(file) {
  const buffer = fs.readFileSync(path.join(FONT_DIR, file));
  return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

async function assets() {
  if (!cache) {
    cache = {
      bold: loadFont('SpaceGrotesk-Bold.ttf'),
      medium: loadFont('SpaceGrotesk-Medium.ttf'),
      logo: await sharp(LOGO_FILE).resize(48, 48, { fit: 'contain' }).png().toBuffer(),
    };
  }
  return cache;
}

/* ------------------------------ losowość ------------------------------ */

function hash(text) {
  let h = 2166136261;
  for (const char of String(text)) {
    h ^= char.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mały, szybki generator pseudolosowy (mulberry32): ten sam ziarno -> ten sam ciąg liczb. */
function random(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand, min, max) => min + rand() * (max - min);
const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];

/* ------------------------------ tekst jako krzywe ------------------------------ */

/** Tekst bez znaków, których czcionka nie ma (emoji itp.) i bez zbędnych spacji. */
function printable(font, text) {
  return Array.from(String(text || ''))
    .filter((char) => char === ' ' || font.charToGlyphIndex(char) > 0)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function measure(font, text, size) {
  return font.getAdvanceWidth(text, size);
}

const round = (value) => Math.round(value * 100) / 100;

/** Polecenia ścieżki -> dane SVG. Własny zapis, bo toPathData() z opentype.js potrafi wypisać "NaN" dla części liter. */
function pathData(commands) {
  return commands
    .map((c) => {
      if (c.type === 'Z') return 'Z';
      if (c.type === 'Q') return `Q${round(c.x1)} ${round(c.y1)} ${round(c.x)} ${round(c.y)}`;
      if (c.type === 'C') return `C${round(c.x1)} ${round(c.y1)} ${round(c.x2)} ${round(c.y2)} ${round(c.x)} ${round(c.y)}`;
      return `${c.type}${round(c.x)} ${round(c.y)}`;
    })
    .join('');
}

function textPath(font, text, x, y, size, fill, opacity = 1) {
  const data = pathData(font.getPath(text, x, y, size).commands);
  return `<path d="${data}" fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}/>`;
}

/** Łamie tekst na linie o szerokości do `maxWidth`; zbyt długie słowa dzieli na znaki. */
function wrap(font, text, size, maxWidth) {
  const lines = [];
  let line = '';
  const push = () => {
    if (line) lines.push(line);
    line = '';
  };

  text.split(' ').forEach((word) => {
    let rest = word;
    while (measure(font, rest, size) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(font, rest.slice(0, cut), size) > maxWidth) cut -= 1;
      push();
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const candidate = line ? `${line} ${rest}` : rest;
    if (measure(font, candidate, size) <= maxWidth) line = candidate;
    else {
      push();
      line = rest;
    }
  });
  push();
  return lines;
}

/** Dobiera największy rozmiar czcionki, przy którym tytuł mieści się w polu; najwyżej ucina wielokropkiem. */
function layoutTitle(font, title) {
  const maxHeight = 330;
  const sizes = [88, 80, 72, 64, 58, 52, 47, 43];
  for (const size of sizes) {
    const lines = wrap(font, title, size, TEXT_WIDTH);
    if (lines.length <= 4 && lines.length * size * 1.12 <= maxHeight) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  let lines = wrap(font, title, size, TEXT_WIDTH).slice(0, 4);
  let last = lines[lines.length - 1];
  while (last.length > 1 && measure(font, `${last}…`, size) > TEXT_WIDTH) last = last.slice(0, -1);
  lines = [...lines.slice(0, -1), `${last.trimEnd()}…`];
  return { size, lines };
}

/* ------------------------------ dekoracje tła ------------------------------ */

function decoration(kind, rand, theme) {
  const white = '#ffffff';
  const parts = [];

  if (kind === 'orbs') {
    const count = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i += 1) {
      const r = between(rand, 40, 190);
      const x = between(rand, 560, 1180);
      const y = between(rand, -20, 650);
      const color = pick(rand, [white, theme.accent, white]);
      parts.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="${color}" fill-opacity="${between(rand, 0.06, 0.2).toFixed(2)}"/>`);
      if (rand() > 0.6) {
        parts.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(r + 22).toFixed(0)}" fill="none" stroke="${white}" stroke-opacity="0.16" stroke-width="3"/>`);
      }
    }
  } else if (kind === 'grid') {
    const angle = between(rand, -18, 18).toFixed(1);
    const step = pick(rand, [48, 60, 72]);
    const lines = [];
    for (let x = 0; x <= 1500; x += step) lines.push(`<path d="M${x} -300V1000"/>`);
    for (let y = 0; y <= 1000; y += step) lines.push(`<path d="M-300 ${y}H1500"/>`);
    parts.push(`<g transform="rotate(${angle} 800 315)" stroke="${white}" stroke-opacity="0.09" stroke-width="2" fill="none">${lines.join('')}</g>`);
    for (let i = 0; i < 9; i += 1) {
      const x = Math.floor(between(rand, 9, 20)) * step;
      const y = Math.floor(between(rand, 1, 10)) * step;
      parts.push(`<rect x="${x}" y="${y}" width="${step}" height="${step}" fill="${theme.accent}" fill-opacity="${between(rand, 0.12, 0.3).toFixed(2)}" transform="rotate(${angle} 800 315)"/>`);
    }
  } else if (kind === 'pixels') {
    const cell = pick(rand, [36, 44, 54]);
    for (let x = 520; x < WIDTH; x += cell) {
      for (let y = 0; y < HEIGHT; y += cell) {
        const chance = (x - 520) / (WIDTH - 520);
        if (rand() < 0.12 + chance * 0.3) {
          const color = rand() > 0.72 ? theme.accent : white;
          parts.push(`<rect x="${x}" y="${y}" width="${cell - 4}" height="${cell - 4}" rx="4" fill="${color}" fill-opacity="${between(rand, 0.05, 0.24).toFixed(2)}"/>`);
        }
      }
    }
  } else if (kind === 'rays') {
    const angle = between(rand, -35, -12).toFixed(1);
    let x = 380;
    const bands = [];
    while (x < 1500) {
      const w = between(rand, 24, 110);
      bands.push(`<rect x="${x.toFixed(0)}" y="-400" width="${w.toFixed(0)}" height="1500" fill="${rand() > 0.75 ? theme.accent : white}" fill-opacity="${between(rand, 0.05, 0.16).toFixed(2)}"/>`);
      x += w + between(rand, 20, 90);
    }
    parts.push(`<g transform="rotate(${angle} 800 315)">${bands.join('')}</g>`);
  } else {
    for (let i = 0; i < 14; i += 1) {
      const cx = between(rand, 560, 1200);
      const cy = between(rand, 0, 630);
      const size = between(rand, 40, 170);
      const rotate = between(rand, 0, 360);
      const points = [0, 1, 2]
        .map((k) => {
          const a = (Math.PI * 2 * k) / 3;
          return `${(cx + Math.cos(a) * size).toFixed(0)},${(cy + Math.sin(a) * size).toFixed(0)}`;
        })
        .join(' ');
      parts.push(`<polygon points="${points}" transform="rotate(${rotate.toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})" fill="${rand() > 0.7 ? theme.accent : white}" fill-opacity="${between(rand, 0.06, 0.2).toFixed(2)}"/>`);
    }
  }
  return parts.join('');
}

function iconGroup(name, x, y, scale, fill, opacity, rotate = 0) {
  const paths = (ICONS[name] || []).map((d) => `<path d="${d}"/>`).join('');
  const cx = x + 8 * scale;
  const cy = y + 8 * scale;
  return `<g transform="rotate(${rotate} ${cx} ${cy}) translate(${x} ${y}) scale(${scale})" fill="${fill}" fill-opacity="${opacity}">${paths}</g>`;
}

/* ------------------------------ składanie grafiki ------------------------------ */

/**
 * Tworzy okładkę wpisu.
 * @param {object} data
 * @param {string} data.title tytuł wpisu
 * @param {string} data.category jedna z kategorii bloga (inna -> kolorystyka domyślna)
 * @param {string[]} [data.tags] tagi (na okładce widać pierwsze trzy)
 * @param {number} [data.variant] numer wariantu wyglądu (0 = domyślny)
 * @returns {Promise<Buffer>} obraz WebP 1200x630
 */
async function generateBlogCover({ title, category, tags = [], variant = 0 }) {
  const { bold, medium, logo } = await assets();
  const theme = THEMES[category] || DEFAULT_THEME;
  const cleanTitle = printable(bold, title).slice(0, 140) || 'Nowy wpis';
  const variantNumber = Math.max(0, Math.min(999, parseInt(variant, 10) || 0));

  const rand = random(hash(`${cleanTitle}|${category}|${variantNumber}`));
  const pattern = PATTERNS[(hash(cleanTitle) + variantNumber) % PATTERNS.length];
  const angle = pick(rand, [125, 135, 145, 155, 215]);

  const layout = layoutTitle(bold, cleanTitle);
  const lineHeight = layout.size * 1.12;
  const blockHeight = layout.lines.length * lineHeight;
  const top = 132 + (330 - blockHeight) / 2;

  const parts = [];
  parts.push(`<defs>
    <linearGradient id="bg" gradientTransform="rotate(${angle - 90} .5 .5)"><stop offset="0" stop-color="${theme.from}"/><stop offset="1" stop-color="${theme.to}"/></linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#05040c" stop-opacity="0.66"/><stop offset="0.55" stop-color="#05040c" stop-opacity="0.34"/><stop offset="1" stop-color="#05040c" stop-opacity="0"/></linearGradient>
    <radialGradient id="glow" cx="0.78" cy="0.45" r="0.55"><stop offset="0" stop-color="${theme.accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${theme.accent}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.85"/></linearGradient>
  </defs>`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>`);
  parts.push(decoration(pattern, rand, theme));

  // Duża ikona kategorii jako znak wodny po prawej stronie.
  const iconScale = between(rand, 22, 27);
  parts.push(iconGroup(theme.icon, between(rand, 770, 830), between(rand, 90, 150), iconScale, '#ffffff', 0.16, between(rand, -14, 14)));
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#scrim)"/>`);

  // Plakietka z kategorią.
  const badgeText = printable(bold, (category || 'Blog').toUpperCase());
  const badgeSize = 22;
  const badgeWidth = measure(bold, badgeText, badgeSize) + 44 + 34;
  parts.push(`<rect x="${PAD}" y="62" width="${badgeWidth.toFixed(0)}" height="46" rx="23" fill="${theme.accent}"/>`);
  parts.push(iconGroup(theme.icon, PAD + 16, 74, 1.375, '#10101c', 0.92));
  parts.push(textPath(bold, badgeText, PAD + 50, 62 + 31, badgeSize, '#10101c'));

  // Tytuł.
  layout.lines.forEach((line, index) => {
    const baseline = top + index * lineHeight + layout.size * 0.82;
    parts.push(textPath(bold, line, PAD, Math.round(baseline * 10) / 10, layout.size, '#ffffff'));
  });

  // Tagi (maksymalnie trzy).
  let chipX = PAD;
  tags.slice(0, 3).forEach((tag) => {
    const label = printable(medium, `#${tag}`).slice(0, 22);
    if (label.length < 2) return;
    const width = measure(medium, label, 22) + 32;
    if (chipX + width > PAD + TEXT_WIDTH) return;
    parts.push(`<rect x="${chipX.toFixed(0)}" y="478" width="${width.toFixed(0)}" height="40" rx="20" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.28"/>`);
    parts.push(textPath(medium, label, chipX + 16, 478 + 27, 22, '#ffffff', 0.95));
    chipX += width + 10;
  });

  // Stopka: logo (dokładane osobno) i nazwa serwisu.
  parts.push(textPath(bold, 'GameVerse', PAD + 60, 583, 30, '#ffffff'));
  parts.push(textPath(medium, 'Blog', PAD + 60 + measure(bold, 'GameVerse', 30) + 14, 583, 24, '#ffffff', 0.7));
  parts.push(`<rect x="0" y="${HEIGHT - 12}" width="${WIDTH}" height="12" fill="url(#bar)"/>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${parts.join('')}</svg>`;

  return sharp(Buffer.from(svg))
    .composite([{ input: logo, left: PAD, top: 552 }])
    .webp({ quality: 90 })
    .toBuffer();
}

module.exports = { generateBlogCover, THEMES, WIDTH, HEIGHT };
