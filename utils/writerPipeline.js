/**
 * Cały proces pomocnika pisania: sprawdzenie faktów w sieci -> napisanie artykułu -> dobór zdjęć na wolnych licencjach
 * -> film -> złożenie gotowego tekstu (zdjęcia z podpisami i autorstwem, film, źródła).
 *
 * Każdy etap poza samym tekstem jest opcjonalny i nie wywraca całości: gdy zawiedzie, artykuł powstaje bez niego,
 * a autor dostaje wyjaśnienie w uwagach. Postęp jest raportowany funkcją onStep (edytor pokazuje go na żywo).
 */
const writer = require('./writingAssistant');
const finder = require('./mediaFinder');
const { saveMedia } = require('./blogMedia');

const MAX_IMAGES = 4;
const CURATION_CANDIDATES = 3;
const DEFAULT_DEADLINE_MS = 200 * 1000; // Azure App Service przerywa nieaktywne połączenia po ok. 230 s

const cut = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
const noQuotes = (text) => String(text || '').replace(/["„”]/g, "'").replace(/[\[\]\n]/g, ' ').replace(/\s+/g, ' ').trim();
const plain = (text) => String(text || '').replace(/[*_`\[\]<>]/g, '').replace(/\s+/g, ' ').trim();

/** Podpis zdjęcia: opis od modelu + autorstwo i licencja (wymagane przez licencje CC). */
function captionFor(text, candidate) {
  const credit = candidate.provider === 'igdb'
    ? `zrzut ekranu z gry ${cut(candidate.author, 50)} (materiały wydawcy, IGDB)`
    : `fot. ${cut(candidate.author || 'autor nieznany', 60)}, ${candidate.license}${candidate.origin === 'wikimedia_commons' ? ' (Wikimedia Commons)' : ''}`;
  return cut(`${noQuotes(text)} - ${credit}`, 290);
}

const imageMarkdown = (saved, alt, caption) => {
  const layout = saved.width && saved.height && saved.width / saved.height >= 1.3 ? '{wide}' : '';
  return `![${noQuotes(alt) || 'Ilustracja do artykułu'}](${saved.url} "${caption}")${layout}`;
};

/** Zastępuje znaczniki {{img:N}} i {{video}} gotowymi elementami; znaczniki bez wyniku znikają. */
function placeMedia(content, { images, video }) {
  let out = content.replace(/^\{\{img:(\d{1,2})\}\}[ \t]*$/gm, (line, id) => images.get(Number(id)) || '');
  let placed = false;
  out = out.replace(/^\{\{video\}\}[ \t]*$/gm, () => {
    if (video && !placed) {
      placed = true;
      return video;
    }
    return '';
  });
  if (video && !placed) {
    // Model nie wskazał miejsca na film: wstawiamy go przed drugim śródtytułem (po wstępie i pierwszej sekcji).
    const headings = [...out.matchAll(/^## /gm)];
    out = headings.length >= 2
      ? `${out.slice(0, headings[1].index)}${video}\n\n${out.slice(headings[1].index)}`
      : `${out}\n\n${video}`;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Pierwsze zdjęcie, którego tytuł zawiera znaczące słowo z zapytania (bez oceny obrazu - tryb bez AI). */
function heuristicPick(query, candidates) {
  const tokens = String(query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 4);
  return candidates.findIndex((candidate) => tokens.some((token) => String(candidate.title).toLowerCase().includes(token)));
}

function igdbCandidates(media, slotIndex) {
  const shots = [];
  media.forEach((entry) => {
    entry.screenshots.slice(0, 8).forEach((shot) => shots.push({
      provider: 'igdb',
      id: `igdb:${shot.url}`,
      title: `${entry.name} - zrzut ekranu`,
      thumbUrl: shot.thumbUrl,
      downloadUrl: shot.url,
      width: shot.width,
      height: shot.height,
      license: 'Materiały wydawcy (IGDB)',
      licenseUrl: '',
      author: entry.name,
      sourceUrl: 'https://www.igdb.com/',
      origin: 'igdb',
    }));
  });
  // Każde miejsce dostaje inne zrzuty, żeby kandydaci się nie powtarzali.
  return shots.slice(slotIndex * 2, slotIndex * 2 + 2);
}

/**
 * @param {object} input
 * @param {object} input.brief         zadanie z okna pomocnika (writer.normalizeBrief)
 * @param {object[]} input.facts       dane gier z katalogu
 * @param {string[]} input.keywords    frazy z treści zadania
 * @param {string[]} input.existingTags tagi już używane na blogu
 * @param {{ images: boolean, video: boolean, screenshots: boolean, research: boolean }} input.options
 * @param {boolean} input.ai           czy użyć AI (klucz jest i limit nie został wyczerpany)
 * @param {string} input.username      kto generuje (autor zdjęć w bibliotece)
 * @param {{ title: number, excerpt: number, content: number }} input.limits
 * @param {Function} input.parseTags
 * @param {Function} [input.onStep]    ({ id, status, label, detail }) - postęp
 * @param {Function} [input.isAborted] czy klient rozłączył się (przerywamy kolejne etapy)
 */
async function runWriter({ brief, facts, keywords, existingTags, options, ai, username, limits, parseTags, onStep = () => {}, isAborted = () => false }) {
  const started = Date.now();
  const deadline = started + (parseInt(process.env.WRITER_DEADLINE_MS, 10) || DEFAULT_DEADLINE_MS);
  const remaining = () => deadline - Date.now();
  const notes = [];
  const usage = { inputTokens: 0, outputTokens: 0, searches: 0 };
  const addUsage = (part) => {
    if (!part) return;
    usage.inputTokens += part.inputTokens || 0;
    usage.outputTokens += part.outputTokens || 0;
    usage.searches += part.searches || 0;
  };
  const step = (id, status, label, detail) => onStep({ id, status, label, detail });
  const checkAbort = () => {
    if (isAborted()) throw Object.assign(new Error('przerwano'), { aborted: true });
  };

  const wantsMedia = options.images || options.video || options.screenshots;
  const igdbIds = facts.map((fact) => fact.id).filter((id) => /^\d+$/.test(id));
  const mediaPromise = wantsMedia && igdbIds.length && (options.video || options.screenshots) ? finder.igdbMedia(igdbIds) : Promise.resolve(new Map());

  checkAbort();

  /* ---- 1. sprawdzanie faktów w sieci ---- */
  let useAi = ai;
  let research = null;
  if (useAi && options.research && writer.webSearchEnabled()) {
    if (remaining() < 110 * 1000) {
      notes.push('Pominięto sprawdzanie faktów w internecie (brak czasu na wszystkie etapy).');
    } else {
      step('research', 'start', 'Sprawdzam fakty w internecie');
      try {
        research = await writer.researchWithClaude({ brief, facts, timeoutMs: Math.min(writer.defaultTimeout(), 75 * 1000) });
        addUsage(research && research.usage);
        step('research', research ? 'done' : 'skip', 'Sprawdzam fakty w internecie', research ? `źródeł: ${research.sources.length}` : 'nic nie znaleziono');
      } catch (err) {
        console.error('[pomocnik pisania] sprawdzanie faktów:', err.code || '', err.cause ? err.cause.message : err.message);
        // Zły klucz albo brak środków dotyczy też pisania tekstu - nie ponawiamy próby, od razu szkielet.
        if (err.code === 'auth' || err.code === 'billing') {
          useAi = false;
          notes.push(`${err.userMessage} Wstawiono szkielet bez AI.`);
        } else if (err.code === 'search-unavailable') {
          notes.push(err.userMessage);
        } else {
          notes.push(`${err.userMessage || 'Nie udało się sprawdzić faktów w internecie.'} Artykuł powstał bez tego etapu.`);
        }
        step('research', 'fail', 'Sprawdzam fakty w internecie', err.userMessage);
      }
    }
  }
  checkAbort();

  /* ---- 2. tekst artykułu ---- */
  let article = null;
  let mode = 'skeleton';
  let model = null;
  if (useAi) {
    step('write', 'start', 'Piszę artykuł');
    try {
      const generated = await writer.generateWithClaude({
        brief, facts, keywords, existingTags, research, options,
        timeoutMs: Math.min(writer.defaultTimeout(), Math.max(40 * 1000, remaining() - 30 * 1000)),
      });
      article = generated.article;
      addUsage(generated.usage);
      model = generated.model;
      mode = 'ai';
      step('write', 'done', 'Piszę artykuł');
    } catch (err) {
      console.error('[pomocnik pisania] AI:', err.code || '', err.cause ? err.cause.message : err.message);
      notes.push(`${err.userMessage || 'Nie udało się użyć AI.'} Wstawiono szkielet bez AI.`);
      step('write', 'fail', 'Piszę artykuł', err.userMessage);
    }
  }
  if (!article) {
    step('write', 'start', 'Przygotowuję szkielet artykułu');
    article = writer.generateSkeleton({ brief, facts, keywords, options });
    step('write', 'done', 'Przygotowuję szkielet artykułu');
  }
  checkAbort();

  const result = writer.finalize(
    { ...article, category: article.category || writer.TYPES[brief.type].category },
    { allowedIds: facts.map((fact) => fact.id), limits, parseTags, stripPlaceholders: mode === 'ai' },
  );

  /* ---- 3. zdjęcia ---- */
  const media = await mediaPromise;
  const images = new Map(); // id znacznika -> Markdown
  const credits = [];
  const usedImages = [];
  if (options.images || options.screenshots) {
    const slots = result.media.length ? result.media : [];
    if (slots.length) {
      step('images', 'start', 'Szukam zdjęć na wolnych licencjach');
      try {
        const perSlot = await Promise.all(slots.map(async (slot, index) => {
          let candidates = options.images ? await finder.findImageCandidates(slot.query, { limit: CURATION_CANDIDATES }).catch(() => []) : [];
          if (options.screenshots) candidates = [...candidates, ...igdbCandidates(media, index)];
          return { slot, candidates };
        }));
        checkAbort();

        // Miniatury do oceny (bez tych, których nie da się pobrać).
        const seen = new Set();
        await Promise.all(perSlot.map(async (entry) => {
          const ready = [];
          await Promise.all(entry.candidates.map(async (candidate) => {
            if (seen.has(candidate.downloadUrl)) return;
            seen.add(candidate.downloadUrl);
            try {
              ready.push({ ...candidate, base64: await finder.thumbnailBase64(candidate) });
            } catch (err) {
              // ten kandydat odpada
            }
          }));
          entry.candidates = ready.sort((a, b) => entry.candidates.findIndex((c) => c.id === a.id) - entry.candidates.findIndex((c) => c.id === b.id));
        }));
        const withCandidates = perSlot.filter((entry) => entry.candidates.length);
        checkAbort();

        // Wybór: model ocenia obrazy; bez AI - proste dopasowanie tytułu do zapytania.
        const picks = [];
        if (withCandidates.length && mode === 'ai' && remaining() > 25 * 1000) {
          step('images', 'start', 'Dobieram najlepsze zdjęcia', 'ocena obrazów przez AI');
          try {
            const curated = await writer.curateImages({
              topic: brief.topic,
              timeoutMs: Math.min(writer.defaultTimeout(), 60 * 1000, remaining() - 15 * 1000),
              slots: withCandidates.map((entry) => ({ id: entry.slot.id, alt: entry.slot.alt, candidates: entry.candidates })),
            });
            addUsage(curated.usage);
            curated.picks.forEach((pick) => {
              const entry = withCandidates.find((item) => item.slot.id === pick.slot);
              const candidate = entry && entry.candidates[pick.candidate - 1];
              if (candidate) picks.push({ slot: entry.slot, candidate, alt: pick.alt || entry.slot.alt, caption: pick.caption || entry.slot.caption });
            });
          } catch (err) {
            console.error('[pomocnik pisania] dobór zdjęć:', err.code || '', err.cause ? err.cause.message : err.message);
            notes.push('Nie udało się ocenić zdjęć przez AI - artykuł powstał bez zdjęć.');
          }
        } else if (withCandidates.length) {
          withCandidates.forEach((entry) => {
            const index = heuristicPick(entry.slot.query, entry.candidates);
            if (index >= 0) picks.push({ slot: entry.slot, candidate: entry.candidates[index], alt: entry.slot.alt, caption: entry.slot.caption });
          });
        }

        // Pobranie wybranych zdjęć do biblioteki multimediów (przekodowane, z tekstem alternatywnym i podpisem).
        const chosen = new Set();
        for (const pick of picks.slice(0, MAX_IMAGES)) {
          if (chosen.has(pick.candidate.downloadUrl)) continue;
          chosen.add(pick.candidate.downloadUrl);
          checkAbort();
          try {
            const buffer = await finder.fetchImageBuffer(pick.candidate.downloadUrl);
            const caption = captionFor(pick.caption, pick.candidate);
            const saved = await saveMedia({ buffer, originalName: `${pick.candidate.id.replace(/[^\w-]+/g, '-')}.jpg`, alt: pick.alt, caption, username });
            images.set(pick.slot.id, imageMarkdown(saved, pick.alt, caption));
            usedImages.push({ slot: pick.slot.id, url: saved.url, alt: cut(pick.alt, 200), caption, candidate: pick.candidate });
          } catch (err) {
            console.error('[pomocnik pisania] pobranie zdjęcia:', err.message);
          }
        }
        step('images', images.size ? 'done' : 'skip', 'Szukam zdjęć na wolnych licencjach', images.size ? `wybrano: ${images.size}` : 'nie znaleziono pasujących zdjęć');
        if (!images.size) notes.push('Nie znalazłem pasujących zdjęć na wolnych licencjach - artykuł jest bez zdjęć (możesz dodać własne przyciskiem zdjęcia).');
      } catch (err) {
        if (err.aborted) throw err;
        console.error('[pomocnik pisania] zdjęcia:', err.message);
        step('images', 'fail', 'Szukam zdjęć na wolnych licencjach', err.message);
        notes.push('Nie udało się wyszukać zdjęć - artykuł jest bez zdjęć.');
      }
    }
  }
  checkAbort();

  /* ---- 4. film ---- */
  let video = null;
  let videoBlock = '';
  if (options.video) {
    step('video', 'start', 'Szukam filmu');
    try {
      video = await finder.pickVideo({ media, gameNames: facts.map((fact) => fact.name), topic: brief.topic });
    } catch (err) {
      console.error('[pomocnik pisania] film:', err.message);
    }
    if (video) {
      const title = plain(video.title);
      videoBlock = `@[youtube](${video.id})\n\n*Film${title ? `: ${title}` : ''}${video.author ? ` - kanał ${plain(video.author)}` : ''} (YouTube).*`;
      step('video', 'done', 'Szukam filmu', video.title);
    } else {
      step('video', 'skip', 'Szukam filmu', 'nie znaleziono osadzalnego filmu');
      notes.push('Nie znalazłem filmu do osadzenia (film wyszukuję dla gier z katalogu; dla innych tematów potrzebny jest klucz YOUTUBE_API_KEY).');
    }
  }

  /* ---- 5. złożenie artykułu ---- */
  let content = placeMedia(result.content, { images, video: videoBlock });

  const sections = [];
  if (research && research.sources.length) {
    const known = new Map(research.sources.map((source) => [source.url, source.title]));
    let cited = result.sources.filter((url) => known.has(url));
    if (!cited.length) cited = research.sources.slice(0, 3).map((source) => source.url);
    sections.push(`## Źródła\n\n${cited.slice(0, 5).map((url) => `- [${plain(known.get(url)) || url}](${url})`).join('\n')}`);
  }
  if (usedImages.length) {
    const lines = usedImages.map((item, index) => {
      const c = item.candidate;
      if (c.provider === 'igdb') return `- Zdjęcie ${index + 1}: zrzut ekranu z gry ${plain(c.author)} - materiały wydawcy, [IGDB](https://www.igdb.com/)`;
      const license = c.licenseUrl ? `[${plain(c.license)}](${c.licenseUrl})` : plain(c.license);
      return `- Zdjęcie ${index + 1}: „${plain(c.title)}” - ${plain(c.author) || 'autor nieznany'}, ${license}, [źródło](${c.sourceUrl})`;
    });
    sections.push(`## Źródła zdjęć\n\n${lines.join('\n')}`);
  }
  if (sections.length) content = `${content}\n\n${sections.join('\n\n')}`;
  if (content.length > limits.content) content = content.slice(0, content.lastIndexOf('\n\n', limits.content)).trim();

  const words = (content.match(/\S+/g) || []).length;
  if (mode === 'ai' && (brief.type === 'review' || brief.type === 'opinion')) {
    notes.push('AI nie grała w tę grę: opinie w tekście opierają się na danych i publicznie znanych ocenach. Przeczytaj tekst i upewnij się, że odpowiada Twojemu zdaniu.');
  }
  if (mode === 'ai') notes.push('Tekst napisała AI na podstawie Twojego zadania, danych z katalogu i wyników wyszukiwania. Sprawdź kluczowe fakty (daty, liczby, nazwy) przed publikacją.');

  return {
    mode,
    model,
    article: { ...result, content, words },
    media: {
      images: usedImages.map((item) => ({ url: item.url, alt: item.alt, caption: item.caption, license: item.candidate.license, author: item.candidate.author, source: item.candidate.sourceUrl, provider: item.candidate.provider })),
      video: video ? { id: video.id, title: video.title, author: video.author, source: video.source } : null,
      sources: research ? research.sources.length : 0,
    },
    usage,
    notes,
    tookMs: Date.now() - started,
  };
}

module.exports = { runWriter, placeMedia, captionFor, heuristicPick };
