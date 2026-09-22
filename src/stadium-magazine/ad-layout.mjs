import { FORMATS } from './platform-sponsors.mjs';

const packingFormats = { ...FORMATS, 'sixth-pair': [2, 2] };
const sizes = Object.keys(packingFormats);
const units = sizes.map(size => packingFormats[size][0] * packingFormats[size][1]);
const sum = counts => counts.reduce((total, count, i) => total + count * units[i], 0);
const key = counts => counts.join(',');

// Enumerate every legal packing in a two-column, six-row page. Thirds and
// sixths follow the three horizontal strips; quarters follow the four quadrants.
function patterns(firstRow, limits, maxAds = Infinity, occupiedMask) {
  const found = new Map();
  function visit(cell, mask, counts, slots) {
    while (cell < 12 && mask & (1 << cell)) cell++;
    if (cell === 12) {
      const k = key(counts);
      const score = slots.reduce((n, slot) => n + slot.row * slot.width * slot.height, 0);
      if (!found.has(k) || found.get(k).score < score) found.set(k, { counts: [...counts], slots: [...slots], score });
      return;
    }
    const row = Math.floor(cell / 2), column = cell % 2;
    visit(cell + 1, mask | (1 << cell), counts, slots);
    for (let i = 0; i < sizes.length; i++) {
      const [width, height] = packingFormats[sizes[i]];
      const adCount = slots.reduce((count, slot) => count + (slot.format === 'sixth-pair' ? 2 : 1), 0);
      if (adCount + (sizes[i] === 'sixth-pair' ? 2 : 1) > maxAds || counts[i] >= limits[i] || row % height || column + width > 2 || row + height > 6) continue;
      let area = 0;
      for (let y = row; y < row + height; y++) for (let x = column; x < column + width; x++) area |= 1 << (y * 2 + x);
      if (area & mask) continue;
      counts[i]++;
      visit(cell + 1, mask | area, counts, [...slots, { format: sizes[i], column, row, width, height }]);
      counts[i]--;
    }
  }
  visit(occupiedMask === undefined ? firstRow * 2 : 0, occupiedMask ?? (1 << (firstRow * 2)) - 1, sizes.map(() => 0), []);
  return [...found.values()];
}

export function packAdvertisements(ads, pages, { maxAdsPerPage = Infinity } = {}) {
  if (new Set(ads.map(ad => ad.id)).size !== ads.length) throw new Error('Doppelte Anzeigen-ID');
  if (ads.some(ad => !FORMATS[ad.format])) throw new Error('Unbekanntes Anzeigenformat');
  if (pages.some(page => !Number.isInteger(page.contentRows) || page.contentRows < 0 || page.contentRows > 6)) throw new Error('Ungültige Inhaltshöhe');
  // Two sixth-page advertisements always share a horizontal third. Pack each
  // pair as one full-width strip, then restore the two original half-width ads.
  // An odd inventory repeats the first motif in the final pair. A pair still
  // counts as two advertisements toward the page's banner limit.
  const sixths = ads.filter(ad => ad.format === '1/6').sort((a, b) => a.id.localeCompare(b.id));
  if (sixths.length && maxAdsPerPage < 2) throw new Error('1/6-Anzeigen benötigen Platz für ein Paar.');
  const packable = ads.filter(ad => ad.format !== '1/6');
  for (let i = 0; i < sixths.length; i += 2) {
    packable.push({ id: sixths[i].id, format: 'sixth-pair', members: [{ad: sixths[i]}, {ad: sixths[i + 1] || sixths[0], ...(!sixths[i + 1] ? {repeated: true} : {})}] });
  }
  const counts = sizes.map(size => packable.filter(ad => ad.format === size).length);
  const byCapacity = Array.from({ length: 7 }, (_, firstRow) => patterns(firstRow, counts, maxAdsPerPage));
  let states = new Map([[key(sizes.map(() => 0)), { used: sizes.map(() => 0), choices: [], score: 0 }]]);
  const maskPatterns = new Map();
  for (const page of pages) {
    if (page.contentMask !== undefined && !maskPatterns.has(page.contentMask)) maskPatterns.set(page.contentMask, patterns(0, counts, maxAdsPerPage, page.contentMask));
    const available = page.contentMask === undefined ? byCapacity[page.contentRows] : maskPatterns.get(page.contentMask);
    const next = new Map();
    for (const state of states.values()) for (const pattern of available) {
      const used = state.used.map((n, i) => n + pattern.counts[i]);
      if (used.some((n, i) => n > counts[i])) continue;
      const k = key(used), score = state.score + pattern.score + (pattern.slots.length ? 1000 : 0);
      if (!next.has(k) || next.get(k).score < score) next.set(k, { used, choices: [...state.choices, pattern], score });
    }
    states = next;
  }
  const extraCache = new Map();
  function extraPages(left) {
    if (!sum(left)) return [];
    const k = key(left);
    if (extraCache.has(k)) return extraCache.get(k);
    let best;
    for (const pattern of byCapacity[0]) {
      if (!sum(pattern.counts) || pattern.counts.some((n, i) => n > left[i])) continue;
      const result = [pattern, ...extraPages(left.map((n, i) => n - pattern.counts[i]))];
      if (!best || result.length < best.length || result.length === best.length && sum(result[0].counts) > sum(best[0].counts)) best = result;
    }
    extraCache.set(k, best);
    return best;
  }
  let best;
  for (const state of states.values()) {
    const extras = extraPages(counts.map((n, i) => n - state.used[i]));
    if (!best || extras.length < best.extras.length || extras.length === best.extras.length && (sum(state.used) > sum(best.state.used) || sum(state.used) === sum(best.state.used) && state.score > best.state.score)) best = { state, extras };
  }
  const queues = sizes.map(size => packable.filter(ad => ad.format === size).sort((a, b) => a.id.localeCompare(b.id)));
  function materialize(pattern) {
    return pattern.slots.sort((a, b) => a.row - b.row || a.column - b.column).flatMap(slot => {
      const ad = queues[sizes.indexOf(slot.format)].shift();
      if (ad.members) return ad.members.map((member, column) => ({ ...member, frame: [column / 2, slot.row / 6, (column + 1) / 2, (slot.row + slot.height) / 6] }));
      return [{ ad, frame: [slot.column / 2, slot.row / 6, (slot.column + slot.width) / 2, (slot.row + slot.height) / 6] }];
    });
  }
  const placements = best.state.choices.map(materialize);
  return { placements, extraPages: best.extras.map(materialize), placedInContent: placements.flat().length };
}
