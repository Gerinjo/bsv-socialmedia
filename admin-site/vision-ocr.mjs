const OCR_KINDS = new Set(['lineup', 'scorers']);

function requiredOcrKind(value) {
  const kind = String(value ?? '').trim();
  if (!OCR_KINDS.has(kind)) throw new Error('Die gewünschte Bildauswertung ist ungültig.');
  return kind;
}

function cleanOcrLines(value) {
  return String(value ?? '')
    .replaceAll('\u00ad', '')
    .split(/\r?\n|[|¦•●▪►]+/)
    .map((line) => line
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

function splitLineupEntries(line) {
  return String(line ?? '')
    .split(/\s+(?=(?:(?:nr\.?|#)\s*)?[0-9oOilL|]{1,3}\s+\p{L})/giu)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cleanPersonName(value) {
  const name = String(value ?? '')
    .replace(/^\s*\d{1,2}\s*[:–—-]\s*\d{1,2}\s+/, '')
    .replace(/\s*\((?:c|captain|kapitän)\)\s*$/iu, '')
    .replace(/^[^\p{L}]+/u, '')
    .replace(/[^\p{L}\p{M}.'’\-?\s]+$/gu, '')
    .replace(/(?:\s+[.'’]+)+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2 || !/\p{L}/u.test(name) || /^\d/u.test(name)) return '';
  return name;
}

function shirtNumber(value) {
  const candidate = String(value ?? '')
    .trim()
    .replace(/[oO]/g, '0')
    .replace(/[iIlL|]/g, '1')
    .replace(/[^0-9]/g, '');
  const number = Number(candidate);
  return candidate && Number.isInteger(number) && number >= 1 && number <= 99 ? String(number) : '';
}

export function compactPersonName(value) {
  const name = cleanPersonName(value);
  if (!name || (name.match(/\p{L}/gu)?.length ?? 0) < 3) return '';
  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  if (/^[\p{L}]\.$/u.test(parts[0])) return name;
  const particles = new Set(['al', 'da', 'de', 'del', 'della', 'di', 'dos', 'du', 'la', 'le', 'van', 'von', 'zu', 'zum', 'zur']);
  let surnameStart = parts.length - 1;
  while (surnameStart > 1 && particles.has(parts[surnameStart - 1].toLocaleLowerCase('de-DE'))) surnameStart -= 1;
  const initial = [...parts[0]][0]?.toLocaleUpperCase('de-DE');
  return initial ? `${initial}. ${parts.slice(surnameStart).join(' ')}` : name;
}

function minutesFrom(value) {
  const minutes = [];
  for (const match of String(value ?? '').matchAll(/(?<!\d)(\d{1,3})(?:\s*[.'’′*])?(?:\s*\+\s*(\d{1,2})(?:\s*[.'’′*])?)?(?!\d)/g)) {
    const base = Number(match[1]);
    const extra = match[2] === undefined ? 0 : Number(match[2]);
    if (base < 1 || base > 130 || extra < 0 || extra > 30) continue;
    const key = `${base}+${extra}`;
    if (!minutes.some((minute) => minute.key === key)) {
      minutes.push({ key, base, extra, label: extra ? `${base}'+${extra}` : `${base}'` });
    }
  }
  return minutes;
}

function minuteOnly(value) {
  const text = String(value ?? '').trim();
  if (!text || /\p{L}/u.test(text.replace(/min(?:ute)?n?/giu, ''))) return [];
  if (/^\(?\s*\d{1,3}(?:\s*[.'’′*]|\s*min(?:ute)?n?)?(?:\s*\+\s*\d{1,2}(?:\s*[.'’′*])?)?(?:\s*[,/&]\s*\d{1,3}(?:\s*[.'’′*]|\s*min(?:ute)?n?)?(?:\s*\+\s*\d{1,2}(?:\s*[.'’′*])?)?)*\s*\)?$/iu.test(text)) {
    return minutesFrom(text);
  }
  return [];
}

function scorerFromLine(value) {
  const line = String(value ?? '').trim();
  if (!line) return null;

  const leadingParentheses = /^\(\s*([^)]+)\)\s*(.+)$/.exec(line);
  if (leadingParentheses) {
    const minutes = minutesFrom(leadingParentheses[1]);
    const name = compactPersonName(leadingParentheses[2]);
    if (minutes.length && name) return { name, minutes };
  }

  const trailingParentheses = /^(.+?)\s*\(\s*([^)]+)\)\s*$/.exec(line);
  if (trailingParentheses) {
    const minutes = minutesFrom(trailingParentheses[2]);
    const name = compactPersonName(trailingParentheses[1]);
    if (minutes.length && name) return { name, minutes };
  }

  const leadingMarkedMinutes = /^((?:\d{1,3}\s*(?:[.'’′*]|min(?:ute)?n?)?(?:\s*\+\s*\d{1,2}(?:\s*[.'’′*])?)?\s*(?:[,/&]\s*)?)+)\s*(?:[-–—:]+\s*)?(.+)$/iu.exec(line);
  if (leadingMarkedMinutes) {
    const minutes = minutesFrom(leadingMarkedMinutes[1]);
    const name = compactPersonName(leadingMarkedMinutes[2]);
    if (minutes.length && name) return { name, minutes };
  }

  const trailingMarkedMinutes = /^(.+?)\s+((?:\d{1,3}\s*(?:[.'’′*]|min(?:ute)?n?)?(?:\s*\+\s*\d{1,2}(?:\s*[.'’′*])?)?\s*(?:[,/&]\s*)?)+)$/iu.exec(line);
  if (trailingMarkedMinutes) {
    const minutes = minutesFrom(trailingMarkedMinutes[2]);
    const name = compactPersonName(trailingMarkedMinutes[1]);
    if (minutes.length && name) return { name, minutes };
  }

  const separatedMinutes = /^(\d{1,3}(?:\s*[,/+&]\s*\d{1,3})*)\s*[-–—:|]\s*(.+)$/.exec(line);
  if (separatedMinutes && !/^\d/.test(separatedMinutes[2].trim())) {
    const minutes = minutesFrom(separatedMinutes[1]);
    const name = compactPersonName(separatedMinutes[2]);
    if (minutes.length && name) return { name, minutes };
  }

  return null;
}

function normalizeLineup(lines) {
  const players = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const numberToken = '[0-9oOilL|]{1,3}';
    const leading = new RegExp(`^(?:nr\\.?\\s*|#\\s*)?(${numberToken})\\s*(?:[,;:.)\\-–—]|\\s)\\s*(.+)$`, 'iu').exec(line);
    const trailing = new RegExp(`^(.+?)\\s*(?:\\(\\s*#?\\s*(${numberToken})\\s*\\)|#\\s*(${numberToken}))$`, 'iu').exec(line);
    let number = shirtNumber(leading?.[1] ?? trailing?.[2] ?? trailing?.[3]);
    let rawName = leading?.[2] ?? trailing?.[1] ?? '';
    if (!number && new RegExp(`^${numberToken}$`, 'iu').test(line) && lines[index + 1]) {
      number = shirtNumber(line);
      const nameParts = [];
      while (nameParts.length < 3 && lines[index + 1] && !new RegExp(`^(?:nr\\.?\\s*|#\\s*)?${numberToken}(?:\\s|$)`, 'iu').test(lines[index + 1])) {
        const part = cleanPersonName(lines[index + 1]);
        if (!part) break;
        nameParts.push(part);
        index += 1;
      }
      rawName = nameParts.join(' ');
    } else if (number && rawName && lines[index + 1] && rawName.trim().split(/\s+/).length < 2) {
      const continuation = cleanPersonName(lines[index + 1]);
      const nextStartsWithNumber = new RegExp(`^(?:nr\\.?\\s*|#\\s*)?${numberToken}(?:\\s|$)`, 'iu').test(lines[index + 1]);
      if (continuation && !nextStartsWithNumber) {
        rawName = `${rawName} ${continuation}`;
        index += 1;
      }
    }
    if (!number || /^\d/.test(rawName.trim())) continue;
    const name = compactPersonName(rawName);
    if (!name) continue;
    const entry = `${number.padStart(2, '0')}, ${name}`;
    const key = entry.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    players.push(entry);
    if (players.length === 11) break;
  }
  return players.join('\n');
}

export function isolateLineupTextPixels(imageData) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;
  const source = imageData?.data;
  if (!width || !height || !source || source.length !== width * height * 4) {
    throw new Error('Die Bilddaten für die Aufstellung sind ungültig.');
  }

  const output = new Uint8ClampedArray(source.length);
  output.fill(255);
  const radius = Math.max(1, Math.min(6, Math.round(Math.min(width, height) / 220)));
  const neutralAt = (x, y, maximumLightness) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const offset = (y * width + x) * 4;
    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    return Math.max(red, green, blue) - Math.min(red, green, blue) <= 38
      && (red * 0.299 + green * 0.587 + blue * 0.114) <= maximumLightness;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = source[offset];
      const green = source[offset + 1];
      const blue = source[offset + 2];
      const lightness = red * 0.299 + green * 0.587 + blue * 0.114;
      const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) <= 42;
      if (!neutral || lightness < 72) continue;
      const darkCardNearby = [
        [-radius, 0], [radius, 0], [0, -radius], [0, radius],
        [-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius],
      ].some(([dx, dy]) => neutralAt(x + dx, y + dy, 76));
      if (!darkCardNearby) continue;
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
    }
  }
  for (let offset = 3; offset < output.length; offset += 4) output[offset] = 255;
  const longColumns = [];
  for (let x = 0; x < width; x += 1) {
    let dark = 0;
    for (let y = 0; y < height; y += 1) if (output[(y * width + x) * 4] === 0) dark += 1;
    if (dark >= Math.max(10, height * 0.32)) longColumns.push(x);
  }
  for (const x of longColumns) for (let y = 0; y < height; y += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (x + offsetX < 0 || x + offsetX >= width) continue;
      const offset = (y * width + x + offsetX) * 4;
      output[offset] = 255; output[offset + 1] = 255; output[offset + 2] = 255;
    }
  }
  return { width, height, data: output };
}

export function findLineupCardRegions(imageData) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;
  const source = imageData?.data;
  if (!width || !height || !source || source.length !== width * height * 4) return [];
  const darkCardPixel = (x, y) => {
    const offset = (y * width + x) * 4;
    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    return Math.max(red, green, blue) - Math.min(red, green, blue) <= 38
      && red * 0.299 + green * 0.587 + blue * 0.114 <= 76;
  };
  const regions = [];
  const halves = [[0, Math.ceil(width / 2)], [Math.floor(width / 2), width]];
  for (const [startX, endX] of halves) {
    const halfWidth = endX - startX;
    const activeRows = new Uint8Array(height);
    const rowRuns = new Array(height);
    for (let y = 0; y < height; y += 1) {
      let runStart = startX;
      let runLength = 0;
      let bestStart = startX;
      let bestLength = 0;
      for (let x = startX; x < endX; x += 1) {
        if (darkCardPixel(x, y)) {
          if (!runLength) runStart = x;
          runLength += 1;
          if (runLength > bestLength) {
            bestStart = runStart;
            bestLength = runLength;
          }
        } else {
          runLength = 0;
        }
      }
      rowRuns[y] = { start: bestStart, length: bestLength };
      if (bestLength >= halfWidth * 0.12) activeRows[y] = 1;
    }
    const maximumInternalGap = Math.max(2, Math.round(height * 0.008));
    for (let y = 0; y < height;) {
      if (activeRows[y]) { y += 1; continue; }
      const gapStart = y;
      while (y < height && !activeRows[y]) y += 1;
      if (gapStart > 0 && y < height && y - gapStart <= maximumInternalGap) {
        activeRows.fill(1, gapStart, y);
      }
    }
    for (let y = 0; y < height;) {
      if (!activeRows[y]) { y += 1; continue; }
      const startY = y;
      while (y < height && activeRows[y]) y += 1;
      const endY = y;
      if (endY - startY < Math.max(8, height * 0.07)) continue;
      const bestRun = rowRuns.slice(startY, endY).reduce((best, run) => run.length > best.length ? run : best, { start: startX, length: 0 });
      if (bestRun.length < halfWidth * 0.35) continue;
      const paddingX = Math.max(4, Math.round(width * 0.005));
      const paddingY = Math.max(3, Math.round(height * 0.003));
      const regionX = Math.max(0, bestRun.start - paddingX);
      const regionY = Math.max(0, startY - paddingY);
      const maximumX = Math.min(width, bestRun.start + bestRun.length + paddingX);
      const maximumY = Math.min(height, endY + paddingY);
      regions.push({
        x: regionX,
        y: regionY,
        width: maximumX - regionX,
        height: maximumY - regionY,
      });
    }
  }
  const referenceHeights = regions
    .map((region) => region.height)
    .filter((regionHeight) => regionHeight <= height * 0.22)
    .sort((left, right) => left - right);
  const typicalHeight = referenceHeights[Math.floor(referenceHeights.length / 2)] ?? 0;
  const separated = regions.flatMap((region) => {
    if (!typicalHeight || region.height < typicalHeight * 1.55) return [region];
    const count = Math.max(2, Math.round(region.height / typicalHeight));
    const partHeight = region.height / count;
    return Array.from({ length: count }, (_, index) => ({
      ...region,
      y: Math.round(region.y + index * partHeight),
      height: Math.round(region.y + (index + 1) * partHeight) - Math.round(region.y + index * partHeight),
    }));
  });
  return separated
    .sort((left, right) => {
      const leftColumn = left.x + left.width / 2 < width / 2 ? 0 : 1;
      const rightColumn = right.x + right.width / 2 < width / 2 ? 0 : 1;
      return leftColumn - rightColumn || left.y - right.y;
    })
    .slice(0, 12);
}

export function isolateLineupCardPixels(imageData, region) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;
  const source = imageData?.data;
  const x = Math.max(0, Math.round(Number(region?.x) || 0));
  const y = Math.max(0, Math.round(Number(region?.y) || 0));
  const cardWidth = Math.min(width - x, Math.max(1, Math.round(Number(region?.width) || 0)));
  const cardHeight = Math.min(height - y, Math.max(1, Math.round(Number(region?.height) || 0)));
  if (!width || !height || !source || source.length !== width * height * 4 || cardWidth < 1 || cardHeight < 1) {
    throw new Error('Die Bilddaten der Spielerkarte sind ungültig.');
  }
  const output = new Uint8ClampedArray(cardWidth * cardHeight * 4);
  output.fill(255);
  for (let cardY = 0; cardY < cardHeight; cardY += 1) {
    for (let cardX = 0; cardX < cardWidth; cardX += 1) {
      const sourceOffset = ((y + cardY) * width + x + cardX) * 4;
      const red = source[sourceOffset];
      const green = source[sourceOffset + 1];
      const blue = source[sourceOffset + 2];
      const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) <= 46;
      const lightness = red * 0.299 + green * 0.587 + blue * 0.114;
      if (!neutral || lightness < 64) continue;
      const outputOffset = (cardY * cardWidth + cardX) * 4;
      output[outputOffset] = 0;
      output[outputOffset + 1] = 0;
      output[outputOffset + 2] = 0;
    }
  }
  const ruleColumns = [];
  for (let cardX = 0; cardX < cardWidth; cardX += 1) {
    let black = 0;
    for (let cardY = 0; cardY < cardHeight; cardY += 1) if (output[(cardY * cardWidth + cardX) * 4] === 0) black += 1;
    if (black >= Math.max(20, cardHeight * 0.72)) ruleColumns.push(cardX);
  }
  for (const cardX of ruleColumns) for (let cardY = 0; cardY < cardHeight; cardY += 1) {
    const offset = (cardY * cardWidth + cardX) * 4;
    output[offset] = 255; output[offset + 1] = 255; output[offset + 2] = 255;
  }
  return { width: cardWidth, height: cardHeight, data: output };
}

export async function prepareLineupOcrImage(image, documentRef = globalThis.document, ImageRef = globalThis.Image) {
  if (!documentRef?.createElement || !ImageRef) return image;
  const sourceImage = await new Promise((resolve, reject) => {
    const loaded = new ImageRef();
    loaded.onload = () => resolve(loaded);
    loaded.onerror = () => reject(new Error('Das Aufstellungsbild konnte nicht vorbereitet werden.'));
    loaded.src = image;
  });
  const canvas = documentRef.createElement('canvas');
  canvas.width = sourceImage.naturalWidth || sourceImage.width;
  canvas.height = sourceImage.naturalHeight || sourceImage.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  const sourcePixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const isolated = isolateLineupTextPixels(sourcePixels);
  const pixels = context.createImageData(canvas.width, canvas.height);
  pixels.data.set(isolated.data);
  const regions = findLineupCardRegions(sourcePixels);
  if (regions.length < 6) {
    context.putImageData(pixels, 0, 0);
    return { image: canvas.toDataURL('image/png'), cards: [], segmented: false };
  }
  const gap = Math.max(8, Math.round(canvas.height * 0.012));
  const output = documentRef.createElement('canvas');
  output.width = Math.max(...regions.map((region) => region.width));
  output.height = regions.reduce((total, region) => total + region.height, gap * (regions.length + 1));
  const outputContext = output.getContext('2d');
  outputContext.fillStyle = '#fff';
  outputContext.fillRect(0, 0, output.width, output.height);
  let outputY = gap;
  const cards = [];
  for (const region of regions) {
    const isolatedCard = isolateLineupCardPixels(sourcePixels, region);
    const card = documentRef.createElement('canvas');
    card.width = isolatedCard.width;
    card.height = isolatedCard.height;
    const cardContext = card.getContext('2d');
    const cardPixels = cardContext.createImageData(card.width, card.height);
    cardPixels.data.set(isolatedCard.data);
    cardContext.putImageData(cardPixels, 0, 0);
    outputContext.drawImage(card, 0, outputY);
    cards.push({
      image: card.toDataURL('image/png'),
      width: card.width,
      height: card.height,
    });
    outputY += region.height + gap;
  }
  return { image: output.toDataURL('image/png'), cards, segmented: true };
}

function normalizeScorers(lines) {
  const parsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const direct = scorerFromLine(line);
    if (direct) {
      parsed.push(direct);
      continue;
    }

    const minutes = minuteOnly(line);
    const nextName = compactPersonName(lines[index + 1]);
    if (minutes.length && nextName && !scorerFromLine(lines[index + 1])) {
      parsed.push({ name: nextName, minutes });
      index += 1;
      continue;
    }

    const nextMinutes = minuteOnly(lines[index + 1]);
    const name = compactPersonName(line);
    if (name && nextMinutes.length) {
      parsed.push({ name, minutes: nextMinutes });
      index += 1;
    }
  }

  const grouped = new Map();
  for (const entry of parsed) {
    const key = entry.name.toLocaleLowerCase('de-DE');
    if (!grouped.has(key)) grouped.set(key, { name: entry.name, minutes: [] });
    const target = grouped.get(key);
    for (const minute of entry.minutes) {
      if (!target.minutes.some((existing) => existing.key === minute.key)) target.minutes.push(minute);
    }
  }

  return [...grouped.values()]
    .map(({ name, minutes }) => `(${minutes.sort((left, right) => (left.base * 100 + left.extra) - (right.base * 100 + right.extra)).map((minute) => minute.label).join(', ')}) ${name}`)
    .join('\n');
}

function mergeLineupCandidates(candidates) {
  const ranked = [...candidates].sort((left, right) => {
    const lineDifference = right.text.split(/\r?\n/).filter(Boolean).length - left.text.split(/\r?\n/).filter(Boolean).length;
    return lineDifference || right.confidence - left.confidence;
  });
  const entries = new Map();
  const order = [];
  for (const candidate of ranked) {
    for (const line of candidate.text.split(/\r?\n/).filter(Boolean)) {
      const match = /^(\d{2}),\s*(.+)$/.exec(line);
      if (!match) continue;
      const quality = (match[2].match(/\p{L}/gu)?.length ?? 0) - (match[2].match(/[?]/g)?.length ?? 0) * 4;
      if (!entries.has(match[1])) order.push(match[1]);
      if (!entries.has(match[1]) || quality > entries.get(match[1]).quality) {
        entries.set(match[1], { line, quality });
      }
    }
  }
  return order.slice(0, 11).map((number) => entries.get(number).line).join('\n');
}

function comparablePersonName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(leftValue, rightValue) {
  const left = [...String(leftValue ?? '')];
  const right = [...String(rightValue ?? '')];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous[right.length];
}

function nameSimilarity(left, right) {
  const maximumLength = Math.max(left.length, right.length);
  return maximumLength ? 1 - editDistance(left, right) / maximumLength : 0;
}

function recognizedPersonName(value) {
  const parts = cleanOcrLines(value)
    .map(cleanPersonName)
    .filter((part) => (part.match(/\p{L}/gu)?.length ?? 0) >= 2);
  return cleanPersonName(parts.slice(0, 4).join(' '));
}

export function matchKnownPersonName(value, knownNames = []) {
  const recognized = recognizedPersonName(value);
  const comparable = comparablePersonName(recognized);
  if (comparable.length < 5) return recognized;
  const candidates = [...new Set(knownNames
    .map((entry) => typeof entry === 'string' ? entry : entry?.display_name ?? entry?.displayName)
    .map((entry) => cleanPersonName(entry))
    .filter(Boolean))]
    .map((name) => ({ name, comparable: comparablePersonName(name) }))
    .filter((entry) => entry.comparable);
  const exact = candidates.find((entry) => entry.comparable === comparable);
  if (exact) return exact.name;

  const exactSurname = candidates.filter((entry) => {
    const tokens = entry.comparable.split(' ');
    return comparable === tokens.at(-1) && comparable.length >= 4;
  });
  if (exactSurname.length === 1) return exactSurname[0].name;

  const ranked = candidates
    .map((entry) => ({ ...entry, score: nameSimilarity(comparable, entry.comparable) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (best && best.score >= 0.68 && (best.score >= 0.86 || best.score - (runnerUp?.score ?? 0) >= 0.07)) return best.name;
  return recognized;
}

export function normalizeLineupCard(numberValue, nameValue, knownNames = []) {
  const number = shirtNumber(numberValue);
  const name = compactPersonName(matchKnownPersonName(nameValue, knownNames));
  return number && name ? `${number.padStart(2, '0')}, ${name}` : '';
}

export function normalizeOcrText(kindValue, value) {
  const kind = requiredOcrKind(kindValue);
  const cleaned = cleanOcrLines(value);
  const lines = (kind === 'lineup' ? cleaned.flatMap(splitLineupEntries) : cleaned)
    .filter((line) => !/^(?:aufstellung|startelf|torschützen|tore|ersatzspieler)\s*:?\s*$/i.test(line));
  return kind === 'lineup' ? normalizeLineup(lines) : normalizeScorers(lines);
}

export function ocrProgressText(message = {}) {
  const status = String(message.status ?? 'Texterkennung wird vorbereitet').trim();
  const labels = {
    'loading tesseract core': 'Texterkennung wird geladen',
    'initializing tesseract': 'Texterkennung wird gestartet',
    'loading language traineddata': 'Deutsches Sprachmodell wird geladen',
    'initializing api': 'Sprachmodell wird vorbereitet',
    'recognizing text': 'Text wird lokal erkannt',
  };
  const label = labels[status] ?? status;
  const progress = Number(message.progress);
  return Number.isFinite(progress) && progress > 0
    ? `${label} · ${Math.min(100, Math.round(progress * 100))} %`
    : `${label} …`;
}

export function createOcrRecognizer(
  loadTesseract = () => globalThis.Tesseract,
  prepareLineupImage = prepareLineupOcrImage,
) {
  let workerPromise;
  let progressListener = () => {};
  let queue = Promise.resolve();
  let pageSegmentationModes = { auto: '3', sparse: '11', block: '6' };

  async function worker() {
    if (!workerPromise) {
      const tesseract = loadTesseract();
      if (!tesseract?.createWorker) throw new Error('Die lokale Texterkennung konnte nicht geladen werden. Bitte die Seite neu laden.');
      pageSegmentationModes = {
        auto: tesseract.PSM?.AUTO ?? '3',
        sparse: tesseract.PSM?.SPARSE_TEXT ?? '11',
        block: tesseract.PSM?.SINGLE_BLOCK ?? '6',
      };
      workerPromise = tesseract.createWorker('deu', tesseract.OEM?.LSTM_ONLY ?? 1, {
        logger: (message) => progressListener(ocrProgressText(message)),
      }).then(async (createdWorker) => {
        await createdWorker.setParameters({
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
          tessedit_pageseg_mode: pageSegmentationModes.auto,
        });
        return createdWorker;
      });
    }
    return workerPromise;
  }

  async function resetWorker() {
    const staleWorker = await workerPromise?.catch(() => null);
    workerPromise = undefined;
    await staleWorker?.terminate?.().catch(() => {});
  }

  return function recognizeOcrImage(image, kindValue, onProgress = () => {}, knownNames = []) {
    const kind = requiredOcrKind(kindValue);
    const task = queue.then(async () => {
      progressListener = onProgress;
      try {
        const activeWorker = await worker();
        const candidates = [];
        if (kind === 'lineup') {
          progressListener('Aufstellungs-Grafik wird für die Texterkennung bereinigt …');
          const prepared = await prepareLineupImage(image);
          const preparedImage = typeof prepared === 'string' ? prepared : prepared.image;
          const cards = Array.isArray(prepared?.cards) ? prepared.cards : [];
          let firstCandidate;
          if (cards.length >= 6) {
            const cardResults = cards.map(() => ({ number: '', name: '', nameConfidence: 0 }));
            const cardConfidences = [];
            await activeWorker.setParameters({ tessedit_pageseg_mode: pageSegmentationModes.sparse });
            for (let index = 0; index < cards.length; index += 1) {
              progressListener(`Rückennummer ${index + 1} von ${cards.length} wird gelesen …`);
              const card = typeof cards[index] === 'string' ? { image: cards[index] } : cards[index];
              const width = Number(card?.width) || 0;
              const height = Number(card?.height) || 0;
              const options = width && height ? { rectangle: { left: 0, top: 0, width: Math.max(1, Math.round(width * 0.36)), height } } : undefined;
              const result = await activeWorker.recognize(card?.image ?? cards[index], options);
              cardResults[index].number = result?.data?.text ?? '';
              cardConfidences.push(Number(result?.data?.confidence) || 0);
            }
            await activeWorker.setParameters({ tessedit_pageseg_mode: pageSegmentationModes.sparse });
            for (let index = 0; index < cards.length; index += 1) {
              progressListener(`Spielername ${index + 1} von ${cards.length} wird gelesen …`);
              const card = typeof cards[index] === 'string' ? { image: cards[index] } : cards[index];
              const width = Number(card?.width) || 0;
              const height = Number(card?.height) || 0;
              const left = Math.max(0, Math.round(width * 0.3));
              const options = width && height ? { rectangle: { left, top: 0, width: Math.max(1, width - left), height } } : undefined;
              const result = await activeWorker.recognize(card?.image ?? cards[index], options);
              cardResults[index].name = result?.data?.text ?? '';
              cardResults[index].nameConfidence = Number(result?.data?.confidence) || 0;
              cardConfidences.push(Number(result?.data?.confidence) || 0);
            }
            const comparableKnownNames = new Set(knownNames
              .map((entry) => typeof entry === 'string' ? entry : entry?.display_name ?? entry?.displayName)
              .map(comparablePersonName)
              .filter(Boolean));
            const unmatchedNames = comparableKnownNames.size ? cardResults
              .map((card, index) => comparableKnownNames.has(comparablePersonName(matchKnownPersonName(card.name, knownNames))) ? -1 : index)
              .filter((index) => index >= 0) : [];
            if (unmatchedNames.length) {
              await activeWorker.setParameters({ tessedit_pageseg_mode: pageSegmentationModes.block });
              for (const index of unmatchedNames) {
                progressListener(`Spielername ${index + 1} wird noch einmal geprüft …`);
                const card = typeof cards[index] === 'string' ? { image: cards[index] } : cards[index];
                const width = Number(card?.width) || 0;
                const height = Number(card?.height) || 0;
                const left = Math.max(0, Math.round(width * 0.3));
                const options = width && height ? { rectangle: { left, top: 0, width: Math.max(1, width - left), height } } : undefined;
                const result = await activeWorker.recognize(card?.image ?? cards[index], options);
                const alternative = result?.data?.text ?? '';
                const alternativeMatch = matchKnownPersonName(alternative, knownNames);
                const alternativeConfidence = Number(result?.data?.confidence) || 0;
                if (comparableKnownNames.has(comparablePersonName(alternativeMatch)) || alternativeConfidence > cardResults[index].nameConfidence) {
                  cardResults[index].name = alternative;
                  cardResults[index].nameConfidence = alternativeConfidence;
                }
                cardConfidences.push(alternativeConfidence);
              }
            }
            const cardTexts = cardResults
              .map((card) => normalizeLineupCard(card.number, card.name, knownNames))
              .filter(Boolean);
            firstCandidate = {
              text: mergeLineupCandidates(cardTexts.map((text) => ({ text, confidence: 100 }))),
              confidence: cardConfidences.reduce((sum, value) => sum + value, 0) / Math.max(1, cardConfidences.length),
            };
          } else {
            await activeWorker.setParameters({ tessedit_pageseg_mode: pageSegmentationModes.sparse });
            const result = await activeWorker.recognize(preparedImage);
            firstCandidate = {
              text: normalizeOcrText(kind, result?.data?.text),
              confidence: Number(result?.data?.confidence) || 0,
            };
          }
          candidates.push(firstCandidate);
          const firstText = firstCandidate.text;
          const uniqueNumbers = new Set(firstText.match(/^\d{2}(?=,)/gm) ?? []);
          if (uniqueNumbers.size < 11) {
            progressListener('Erkennung wird mit dem Originalbild abgeglichen …');
            await activeWorker.setParameters({ tessedit_pageseg_mode: pageSegmentationModes.auto });
            const result = await activeWorker.recognize(image);
            candidates.push({
              text: normalizeOcrText(kind, result?.data?.text),
              confidence: Number(result?.data?.confidence) || 0,
            });
          }
        } else {
          await activeWorker.setParameters({ tessedit_pageseg_mode: pageSegmentationModes.auto });
          const result = await activeWorker.recognize(image);
          candidates.push({
            text: normalizeOcrText(kind, result?.data?.text),
            confidence: Number(result?.data?.confidence) || 0,
          });
        }
        const best = [...candidates].sort((left, right) => {
          const lineDifference = right.text.split(/\r?\n/).filter(Boolean).length - left.text.split(/\r?\n/).filter(Boolean).length;
          return lineDifference || right.confidence - left.confidence;
        })[0];
        const text = kind === 'lineup' ? mergeLineupCandidates(candidates) : best?.text ?? '';
        if (!text) {
          const subject = kind === 'lineup' ? 'keine eindeutige Aufstellung' : 'keine eindeutigen Torschützen';
          throw new Error(`Auf dem Bild wurden ${subject} erkannt. Bitte das Bild enger zuschneiden oder den Text von Hand eingeben.`);
        }
        return { text, confidence: best.confidence };
      } catch (error) {
        await resetWorker();
        throw error;
      } finally {
        progressListener = () => {};
      }
    });
    queue = task.catch(() => {});
    return task;
  };
}

export const recognizeOcrImage = createOcrRecognizer();
