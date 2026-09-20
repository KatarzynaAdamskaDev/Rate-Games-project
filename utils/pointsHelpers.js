/**
 * System poziomów i odblokowań GameVerse.
 * Punkty doświadczenia (PD) liczone są dynamicznie na podstawie aktywności
 * użytkownika (na razie: liczby napisanych recenzji), więc działają od razu
 * i nie wymagają żadnej zmiany w istniejącym formularzu dodawania recenzji.
 *
 *   1 recenzja = 10 PD
 */
const POINTS_PER_REVIEW = 10;
const POINTS_PER_LEVEL = 25;

function pointsFromStats(stats) {
  const fromActivity = (stats.reviewCount || 0) * POINTS_PER_REVIEW;
  return Math.max(0, fromActivity + (stats.bonusPoints || 0));
}

function levelFromPoints(points) {
  return Math.floor((points || 0) / POINTS_PER_LEVEL) + 1;
}

function levelProgress(points) {
  const safePoints = points || 0;
  const level = levelFromPoints(safePoints);
  const currentLevelBase = (level - 1) * POINTS_PER_LEVEL;
  const nextLevelAt = level * POINTS_PER_LEVEL;
  const inLevel = safePoints - currentLevelBase;
  const span = nextLevelAt - currentLevelBase;

  return {
    level,
    points: safePoints,
    pointsInLevel: inLevel,
    pointsToNext: nextLevelAt - safePoints,
    percent: Math.min(100, Math.round((inLevel / span) * 100)),
  };
}

/**
 * Motywy: każdy poziom odblokowuje ZESTAW - ramkę awatara, tło profilu i kolor odznaki w jednej palecie,
 * więc profil z maksymalnymi dodatkami wygląda spójnie. `accent` to kolor przewodni motywu
 * (pasek PD, poświata banera, domyślne trofeum), `accent2` - kolor uzupełniający.
 */
const THEMES = [
  { id: 'violet', label: 'Fiolet', levelRequired: 1, frame: 'frame-basic', background: 'bg-default', badge: null, accent: '#a48bff', accent2: '#7c5cff' },
  { id: 'copper', label: 'Miedź', levelRequired: 2, frame: 'frame-bronze', background: 'bg-purple-mist', badge: 'badge-first-review', accent: '#e2955a', accent2: '#a35d2b' },
  { id: 'neon', label: 'Neon', levelRequired: 4, frame: 'frame-neon', background: 'bg-cyberpunk', badge: 'badge-5-reviews', accent: '#3fe0c5', accent2: '#1a9d8a' },
  { id: 'gold', label: 'Złoto', levelRequired: 7, frame: 'frame-gold', background: 'bg-space', badge: 'badge-10-reviews', accent: '#ffb238', accent2: '#d9820f' },
  { id: 'cyber', label: 'Cyber', levelRequired: 10, frame: 'frame-cyber', background: 'bg-retro-pixel', badge: 'badge-25-reviews', accent: '#8f7bff', accent2: '#3fe0c5' },
  { id: 'legend', label: 'Legenda', levelRequired: 15, frame: 'frame-legend', background: 'bg-legend', badge: 'badge-social', accent: '#ff5da2', accent2: '#ffb238' },
];

/** Ramki awatara możliwe do odblokowania wraz z wymaganym poziomem (każda należy do motywu). */
const FRAMES = [
  { id: 'frame-basic', label: 'Fioletowa', levelRequired: 1, theme: 'violet' },
  { id: 'frame-bronze', label: 'Miedziana', levelRequired: 2, theme: 'copper' },
  { id: 'frame-neon', label: 'Neonowa', levelRequired: 4, theme: 'neon' },
  { id: 'frame-gold', label: 'Złota', levelRequired: 7, theme: 'gold' },
  { id: 'frame-cyber', label: 'Cybernetyczna', levelRequired: 10, theme: 'cyber' },
  { id: 'frame-legend', label: 'Legendarna', levelRequired: 15, theme: 'legend' },
];

/** Tła profilu możliwe do odblokowania wraz z wymaganym poziomem (poziom tła = poziom jego ramki). */
const BACKGROUNDS = [
  { id: 'bg-default', label: 'Fioletowy zmierzch', levelRequired: 1, theme: 'violet' },
  { id: 'bg-purple-mist', label: 'Miedziana mgła', levelRequired: 2, theme: 'copper' },
  { id: 'bg-cyberpunk', label: 'Neonowe miasto', levelRequired: 4, theme: 'neon' },
  { id: 'bg-space', label: 'Złota noc', levelRequired: 7, theme: 'gold' },
  { id: 'bg-retro-pixel', label: 'Cyber-piksele', levelRequired: 10, theme: 'cyber' },
  { id: 'bg-legend', label: 'Zorza legendy', levelRequired: 15, theme: 'legend' },
];

/** Odznaki przyznawane na podstawie aktywności; kolor odznaki to kolor jej motywu. */
const BADGE_DEFINITIONS = [
  {
    id: 'badge-first-review',
    label: 'Pierwsza recenzja',
    description: 'Dodaj swoją pierwszą recenzję gry.',
    icon: 'bi-award-fill',
    theme: 'copper',
    color: '#e2955a',
    check: (stats) => stats.reviewCount >= 1,
  },
  {
    id: 'badge-5-reviews',
    label: 'Rozkręcony recenzent',
    description: 'Dodaj 5 recenzji gier.',
    icon: 'bi-lightning-charge-fill',
    theme: 'neon',
    color: '#3fe0c5',
    check: (stats) => stats.reviewCount >= 5,
  },
  {
    id: 'badge-10-reviews',
    label: 'Aktywny recenzent',
    description: 'Dodaj 10 recenzji gier.',
    icon: 'bi-trophy-fill',
    theme: 'gold',
    color: '#ffb238',
    check: (stats) => stats.reviewCount >= 10,
  },
  {
    id: 'badge-25-reviews',
    label: 'Weteran recenzji',
    description: 'Dodaj 25 recenzji gier.',
    icon: 'bi-gem',
    theme: 'cyber',
    color: '#8f7bff',
    check: (stats) => stats.reviewCount >= 25,
  },
  {
    id: 'badge-social',
    label: 'Towarzyska dusza',
    description: 'Zdobądź 10 obserwujących.',
    icon: 'bi-people-fill',
    theme: 'legend',
    color: '#ff5da2',
    check: (stats) => stats.followersCount >= 10,
  },
];

function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** Motyw aktywnego tła (jego kolory przewodnie używane są w całym banerze). */
function themeForBackground(backgroundId) {
  const bg = BACKGROUNDS.find((b) => b.id === backgroundId);
  return themeById(bg ? bg.theme : 'violet');
}

/** Trofeum widoczne w banerze, gdy użytkownik nie wybrał żadnej odznaki. */
const DEFAULT_TROPHY = { id: null, label: 'Trofeum', icon: 'bi-trophy-fill', color: '#ffb238' };

/**
 * Zwraca trofeum do banera: wybraną odznakę (jeśli wciąż odblokowana) albo domyślne,
 * w kolorze przewodnim motywu aktywnego tła.
 */
function resolveTrophy(activeTrophyId, stats, unlockAll = false, themeAccent = null) {
  const badge = BADGE_DEFINITIONS.find((b) => b.id === activeTrophyId);
  if (badge && (unlockAll || badge.check(stats))) {
    return { id: badge.id, label: badge.label, icon: badge.icon, color: badge.color };
  }
  return themeAccent ? { ...DEFAULT_TROPHY, color: themeAccent } : DEFAULT_TROPHY;
}

/**
 * Blokady odznak, ramek i teł. Gdy administrator włączył użytkownikowi "odblokuj wszystko"
 * (users.unlockAll), nic nie jest zablokowane niezależnie od poziomu i aktywności.
 */
function allFramesWithLockState(level, unlockAll = false) {
  return FRAMES.map((f) => ({ ...f, locked: !unlockAll && f.levelRequired > level }));
}

function allBackgroundsWithLockState(level, unlockAll = false) {
  return BACKGROUNDS.map((b) => ({ ...b, locked: !unlockAll && b.levelRequired > level }));
}

function allBadgesWithLockState(stats, unlockAll = false) {
  return BADGE_DEFINITIONS.map((b) => ({ ...b, locked: !unlockAll && !b.check(stats) }));
}

module.exports = {
  POINTS_PER_REVIEW,
  POINTS_PER_LEVEL,
  pointsFromStats,
  levelFromPoints,
  levelProgress,
  FRAMES,
  BACKGROUNDS,
  BADGE_DEFINITIONS,
  THEMES,
  themeById,
  themeForBackground,
  DEFAULT_TROPHY,
  resolveTrophy,
  allFramesWithLockState,
  allBackgroundsWithLockState,
  allBadgesWithLockState,
};
