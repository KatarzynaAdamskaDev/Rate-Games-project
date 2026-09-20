/**
 * Znane skróty gier ("mc", "gta5", "botw", "bg3"...) -> pełne nazwy, od których zaczynają się tytuły w IGDB.
 * Klucz to skrót małymi literami, bez spacji i znaków specjalnych ("cs:go" i "cs go" -> "csgo").
 * IGDB zna część skrótów jako nazwy alternatywne (CS2, GTA5), ale nie wszystkie i nie zawsze -
 * ta lista uzupełnia luki. Wartości muszą być początkiem oficjalnej nazwy gry w IGDB.
 */
const ALIASES = {
  // Minecraft, GTA, Red Dead
  mc: ['Minecraft'],
  gta: ['Grand Theft Auto'],
  gta3: ['Grand Theft Auto III'],
  gtavc: ['Grand Theft Auto: Vice City'],
  gtasa: ['Grand Theft Auto: San Andreas'],
  gta4: ['Grand Theft Auto IV'],
  gtaiv: ['Grand Theft Auto IV'],
  gta5: ['Grand Theft Auto V'],
  gtav: ['Grand Theft Auto V'],
  gta6: ['Grand Theft Auto VI'],
  gtavi: ['Grand Theft Auto VI'],
  rdr: ['Red Dead Redemption'],
  rdr2: ['Red Dead Redemption 2'],

  // Call of Duty
  cod: ['Call of Duty'],
  mw: ['Call of Duty: Modern Warfare'],
  mw2: ['Call of Duty: Modern Warfare 2'],
  mw3: ['Call of Duty: Modern Warfare 3'],
  bo: ['Call of Duty: Black Ops'],
  bo2: ['Call of Duty: Black Ops II'],
  bo3: ['Call of Duty: Black Ops III'],
  bo4: ['Call of Duty: Black Ops 4'],
  warzone: ['Call of Duty: Warzone'],

  // Strzelanki
  cs: ['Counter-Strike'],
  csgo: ['Counter-Strike: Global Offensive'],
  css: ['Counter-Strike: Source'],
  cs2: ['Counter-Strike 2'],
  tf2: ['Team Fortress 2'],
  l4d: ['Left 4 Dead'],
  l4d2: ['Left 4 Dead 2'],
  hl: ['Half-Life'],
  hl2: ['Half-Life 2'],
  hla: ['Half-Life: Alyx'],
  r6: ['Rainbow Six Siege'],
  r6s: ['Rainbow Six Siege'],
  apex: ['Apex Legends'],
  valo: ['Valorant'],
  fn: ['Fortnite'],
  ow: ['Overwatch'],
  ow2: ['Overwatch'],
  dbd: ['Dead by Daylight'],
  fnaf: ["Five Nights at Freddy's"],
  hd2: ['Helldivers 2'],
  bf: ['Battlefield'],
  bf1: ['Battlefield 1'],
  bf3: ['Battlefield 3'],
  bf4: ['Battlefield 4'],
  bf2042: ['Battlefield 2042'],

  // Blizzard i MMO
  wow: ['World of Warcraft'],
  wc3: ['Warcraft III'],
  sc: ['StarCraft'],
  sc2: ['StarCraft II'],
  d2: ['Diablo II'],
  d3: ['Diablo III'],
  d4: ['Diablo IV'],
  hs: ['Hearthstone'],
  hots: ['Heroes of the Storm'],
  poe: ['Path of Exile'],
  eso: ['The Elder Scrolls Online'],
  ffxiv: ['Final Fantasy XIV'],
  ff14: ['Final Fantasy XIV'],
  lol: ['League of Legends'],
  dota: ['Dota 2'],

  // Nintendo
  botw: ['The Legend of Zelda: Breath of the Wild'],
  totk: ['The Legend of Zelda: Tears of the Kingdom'],
  oot: ['The Legend of Zelda: Ocarina of Time'],
  lttp: ['The Legend of Zelda: A Link to the Past'],
  tww: ['The Legend of Zelda: The Wind Waker'],
  smb: ['Super Mario Bros.'],
  sm64: ['Super Mario 64'],
  smo: ['Super Mario Odyssey'],
  smw: ['Super Mario World'],
  mk8: ['Mario Kart 8'],
  mk8d: ['Mario Kart 8 Deluxe'],
  ssbu: ['Super Smash Bros. Ultimate'],
  ssb: ['Super Smash Bros.'],
  acnh: ['Animal Crossing: New Horizons'],
  poke: ['Pokémon'],
  pkmn: ['Pokémon'],

  // RPG
  bg3: ["Baldur's Gate III"],
  bg2: ["Baldur's Gate II"],
  tw3: ['The Witcher 3: Wild Hunt'],
  w3: ['The Witcher 3: Wild Hunt'],
  tw2: ['The Witcher 2'],
  er: ['Elden Ring'],
  ds: ['Dark Souls'],
  ds1: ['Dark Souls'],
  ds2: ['Dark Souls II'],
  ds3: ['Dark Souls III'],
  bb: ['Bloodborne'],
  cp77: ['Cyberpunk 2077'],
  cp2077: ['Cyberpunk 2077'],
  tes: ['The Elder Scrolls'],
  tes4: ['The Elder Scrolls IV: Oblivion'],
  tes5: ['The Elder Scrolls V: Skyrim'],
  fo3: ['Fallout 3'],
  fo4: ['Fallout 4'],
  fnv: ['Fallout: New Vegas'],
  ff: ['Final Fantasy'],
  ff7: ['Final Fantasy VII'],
  ff10: ['Final Fantasy X'],
  kh: ['Kingdom Hearts'],
  dq: ['Dragon Quest'],
  mhw: ['Monster Hunter: World'],
  mhrise: ['Monster Hunter Rise'],

  // Akcja i przygodówki
  hk: ['Hollow Knight'],
  re: ['Resident Evil'],
  re2: ['Resident Evil 2'],
  re4: ['Resident Evil 4'],
  re7: ['Resident Evil 7'],
  re8: ['Resident Evil Village'],
  sh2: ['Silent Hill 2'],
  ac: ["Assassin's Creed"],
  ac2: ["Assassin's Creed II"],
  acu: ["Assassin's Creed Unity"],
  aco: ["Assassin's Creed Origins"],
  acv: ["Assassin's Creed Valhalla"],
  mgs: ['Metal Gear Solid'],
  mgs5: ['Metal Gear Solid V'],
  gow: ['God of War'],
  tlou: ['The Last of Us'],
  tlou2: ['The Last of Us Part II'],
  hzd: ['Horizon Zero Dawn'],
  hfw: ['Horizon Forbidden West'],
  dmc: ['Devil May Cry'],
  dmc5: ['Devil May Cry 5'],
  nms: ["No Man's Sky"],
  sdv: ['Stardew Valley'],
  p2: ['Portal 2'],
  rl: ['Rocket League'],

  // Strategie i symulatory
  civ: ["Sid Meier's Civilization"],
  civ5: ["Sid Meier's Civilization V"],
  civ6: ["Sid Meier's Civilization VI"],
  hoi4: ['Hearts of Iron IV'],
  eu4: ['Europa Universalis IV'],
  ck3: ['Crusader Kings III'],
  ksp: ['Kerbal Space Program'],
  xcom: ['XCOM'],

  // Bijatyki i wyścigi
  sf6: ['Street Fighter 6'],
  mk: ['Mortal Kombat'],
  mk11: ['Mortal Kombat 11'],
  nfs: ['Need for Speed'],
  fh5: ['Forza Horizon 5'],
  fh4: ['Forza Horizon 4'],
};

/** Klucz do wyszukiwania w tabeli skrótów: małe litery i cyfry, bez spacji ("CS:GO" -> "csgo"). */
function aliasKey(term) {
  return String(term || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Pełne nazwy gier, do których odsyła skrót wpisany przez użytkownika (lub pusta lista). */
function aliasesFor(term) {
  const key = aliasKey(term);
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : [];
}

module.exports = { ALIASES, aliasesFor, aliasKey };
