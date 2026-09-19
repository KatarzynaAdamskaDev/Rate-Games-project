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

/** Ramki awatara możliwe do odblokowania wraz z wymaganym poziomem. */
const FRAMES = [
  { id: 'frame-basic', label: 'Podstawowa', levelRequired: 1 },
  { id: 'frame-bronze', label: 'Brązowa', levelRequired: 2 },
  { id: 'frame-neon', label: 'Neonowa', levelRequired: 4 },
  { id: 'frame-gold', label: 'Złota', levelRequired: 7 },
  { id: 'frame-cyber', label: 'Cybernetyczna', levelRequired: 10 },
  { id: 'frame-legend', label: 'Legendarna', levelRequired: 15 },
];

/** Tła profilu możliwe do odblokowania wraz z wymaganym poziomem. */
const BACKGROUNDS = [
  { id: 'bg-default', label: 'Domyślne', levelRequired: 1 },
  { id: 'bg-purple-mist', label: 'Fioletowa mgła', levelRequired: 3 },
  { id: 'bg-cyberpunk', label: 'Cyberpunk', levelRequired: 6 },
  { id: 'bg-space', label: 'Kosmiczne', levelRequired: 9 },
  { id: 'bg-retro-pixel', label: 'Retro pixel', levelRequired: 13 },
];

/** Odznaki przyznawane na podstawie aktywności. */
const BADGE_DEFINITIONS = [
  {
    id: 'badge-first-review',
    label: 'Pierwsza recenzja',
    description: 'Dodaj swoją pierwszą recenzję gry.',
    check: (stats) => stats.reviewCount >= 1,
  },
  {
    id: 'badge-5-reviews',
    label: 'Rozkręcony recenzent',
    description: 'Dodaj 5 recenzji gier.',
    check: (stats) => stats.reviewCount >= 5,
  },
  {
    id: 'badge-10-reviews',
    label: 'Aktywny recenzent',
    description: 'Dodaj 10 recenzji gier.',
    check: (stats) => stats.reviewCount >= 10,
  },
  {
    id: 'badge-25-reviews',
    label: 'Weteran recenzji',
    description: 'Dodaj 25 recenzji gier.',
    check: (stats) => stats.reviewCount >= 25,
  },
  {
    id: 'badge-social',
    label: 'Towarzyska dusza',
    description: 'Zdobądź 10 obserwujących.',
    check: (stats) => stats.followersCount >= 10,
  },
];

function allFramesWithLockState(level) {
  return FRAMES.map((f) => ({ ...f, locked: f.levelRequired > level }));
}

function allBackgroundsWithLockState(level) {
  return BACKGROUNDS.map((b) => ({ ...b, locked: b.levelRequired > level }));
}

function allBadgesWithLockState(stats) {
  return BADGE_DEFINITIONS.map((b) => ({ ...b, locked: !b.check(stats) }));
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
  allFramesWithLockState,
  allBackgroundsWithLockState,
  allBadgesWithLockState,
};
