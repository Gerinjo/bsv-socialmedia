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
  const tokens = String(value ?? '').match(/[0-9oOilL|]{1,3}/g) ?? [];
  tokens.sort((left, right) => right.length - left.length || Number(/\d/.test(right)) - Number(/\d/.test(left)));
  for (const token of tokens) {
    const candidate = token.replace(/[oO]/g, '0').replace(/[iIlL|]/g, '1');
    const candidates = [candidate];
    // A bright card edge is occasionally recognized as a trailing zero (for example 17 -> 170).
    // Only strip that specific artifact; genuine or otherwise ambiguous three-digit values stay invalid.
    if (/^\d{2}0$/.test(candidate)) candidates.push(candidate.slice(0, -1));
    for (const possibleNumber of candidates) {
      const number = Number(possibleNumber);
      if (possibleNumber && Number.isInteger(number) && number >= 1 && number <= 99) return String(number);
    }
  }
  return '';
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

export function compactLineupPersonName(value) {
  const name = cleanPersonName(value);
  if (!name || (name.match(/\p{L}/gu)?.length ?? 0) < 3) return '';
  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  if (/^[\p{L}]\.$/u.test(parts[0])) return name;
  const firstLetter = parts[0].match(/\p{L}/u)?.[0];
  return firstLetter ? `${firstLetter.toLocaleUpperCase('de-DE')}. ${parts.slice(1).join(' ')}` : name;
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
    const name = compactLineupPersonName(recognizedPersonName(rawName));
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
      const paddingX = Math.max(6, Math.round(width * 0.025));
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
  const sorted = separated
    .sort((left, right) => {
      const leftColumn = left.x + left.width / 2 < width / 2 ? 0 : 1;
      const rightColumn = right.x + right.width / 2 < width / 2 ? 0 : 1;
      return leftColumn - rightColumn || left.y - right.y;
    });
  if (sorted.length === 10) {
    const columns = [
      sorted.filter((region) => region.x + region.width / 2 < width / 2),
      sorted.filter((region) => region.x + region.width / 2 >= width / 2),
    ];
    if (columns.every((column) => column.length === 5)) {
      const centerGaps = columns.flatMap((column) => column.slice(1).map((region, index) => {
        const previous = column[index];
        return (region.y + region.height / 2) - (previous.y + previous.height / 2);
      })).sort((left, right) => left - right);
      const typicalGap = centerGaps[Math.floor(centerGaps.length / 2)] ?? 0;
      const missing = columns.flatMap((column) => column.slice(1).map((region, index) => ({
        column,
        previous: column[index],
        next: region,
        gap: (region.y + region.height / 2) - (column[index].y + column[index].height / 2),
      }))).sort((left, right) => right.gap - left.gap)[0];
      if (typicalGap && missing?.gap >= typicalGap * 1.55) {
        const values = (key) => missing.column.map((region) => region[key]).sort((left, right) => left - right);
        const regionWidth = values('width')[Math.floor(missing.column.length / 2)];
        const regionHeight = values('height')[Math.floor(missing.column.length / 2)];
        const regionX = values('x')[Math.floor(missing.column.length / 2)];
        const centerY = ((missing.previous.y + missing.previous.height / 2) + (missing.next.y + missing.next.height / 2)) / 2;
        sorted.push({
          x: regionX,
          y: Math.max(0, Math.round(centerY - regionHeight / 2)),
          width: Math.min(regionWidth, width - regionX),
          height: Math.min(regionHeight, height - Math.max(0, Math.round(centerY - regionHeight / 2))),
        });
        sorted.sort((left, right) => {
          const leftColumn = left.x + left.width / 2 < width / 2 ? 0 : 1;
          const rightColumn = right.x + right.width / 2 < width / 2 ? 0 : 1;
          return leftColumn - rightColumn || left.y - right.y;
        });
      }
    }
  }
  return sorted.slice(0, 12);
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
    let numberImage;
    let numberWidth;
    let numberHeight;
    if (card.height > 100) {
      numberHeight = 80;
      numberWidth = Math.max(1, Math.round(card.width * numberHeight / card.height));
      const numberCard = documentRef.createElement('canvas');
      numberCard.width = numberWidth;
      numberCard.height = numberHeight;
      const numberContext = numberCard.getContext('2d');
      numberContext.fillStyle = '#fff';
      numberContext.fillRect(0, 0, numberWidth, numberHeight);
      numberContext.drawImage(card, 0, 0, numberWidth, numberHeight);
      numberImage = numberCard.toDataURL('image/png');
    }
    cards.push({
      image: card.toDataURL('image/png'),
      width: card.width,
      height: card.height,
      numberImage,
      numberWidth,
      numberHeight,
      column: region.x + region.width / 2 < canvas.width / 2 ? 'left' : 'right',
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
  let parts = cleanOcrLines(value)
    .map(cleanPersonName)
    .filter((part) => (part.match(/\p{L}/gu)?.length ?? 0) >= 2);
  const longTokens = parts.flatMap((part) => part.split(/\s+/)).filter((token) => (token.match(/\p{L}/gu)?.length ?? 0) >= 3);
  if (longTokens.length >= 2) {
    const particles = new Set(['al', 'da', 'de', 'di', 'do', 'dos', 'du', 'la', 'le', 'van', 'von', 'zu']);
    parts = parts.map((part) => part.split(/\s+/).filter((token) => {
      const letters = token.match(/\p{L}/gu)?.length ?? 0;
      return letters >= 3 || particles.has(token.toLocaleLowerCase('de-DE')) || /^[\p{L}]\.$/u.test(token);
    }).join(' ')).filter(Boolean);
  }
  const name = cleanPersonName(parts.slice(0, 4).join(' '));
  const tokens = name.split(/\s+/);
  if (tokens.length >= 3) {
    const fragment = comparablePersonName(tokens[0]).replaceAll(' ', '');
    const following = comparablePersonName(tokens[1]).replaceAll(' ', '');
    let position = 0;
    for (const character of following) if (character === fragment[position]) position += 1;
    if (fragment.length >= 2 && fragment.length <= 3 && following.length >= 4 && position === fragment.length) {
      return cleanPersonName(tokens.slice(1).join(' '));
    }
  }
  return name;
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
    .map((entry) => ({
      ...entry,
      score: Math.max(
        nameSimilarity(comparable, entry.comparable),
        nameSimilarity(comparable.split(' ').sort().join(' '), entry.comparable.split(' ').sort().join(' ')),
      ),
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (best && best.score >= 0.68 && (best.score >= 0.86 || best.score - (runnerUp?.score ?? 0) >= 0.07)) return best.name;
  return recognized;
}

export function normalizeLineupCard(numberValue, nameValue, knownNames = []) {
  const number = shirtNumber(numberValue);
  const name = compactLineupPersonName(matchKnownPersonName(nameValue, knownNames));
  const letters = name.match(/\p{L}/gu)?.length ?? 0;
  return number && name && letters >= 3 ? `${number.padStart(2, '0')}, ${name}` : '';
}

function lineupNumberRetryIndexes(cardResults) {
  const numbers = cardResults.map((card) => shirtNumber(card.number));
  const counts = new Map();
  for (const number of numbers) if (number) counts.set(number, (counts.get(number) ?? 0) + 1);
  return numbers
    .map((number, index) => !number || counts.get(number) > 1 ? index : -1)
    .filter((index) => index >= 0);
}

export function orderLineupCards(cards, isHome = true) {
  const source = Array.isArray(cards) ? cards : [];
  if (!source.length || !source.every((card) => card?.column === 'left' || card?.column === 'right')) return source;
  const firstColumn = isHome ? 'left' : 'right';
  const secondColumn = isHome ? 'right' : 'left';
  return [
    ...source.filter((card) => card.column === firstColumn),
    ...source.filter((card) => card.column === secondColumn),
  ];
}

export function lineupCardRectangle(card, part, isHome = true) {
  const width = Number(card?.width) || 0;
  const height = Number(card?.height) || 0;
  if (!width || !height) return undefined;
  if (part === 'number') {
    const left = isHome ? Math.round(width * 0.64) : 0;
    return { left, top: 0, width: Math.max(1, isHome ? width - left : Math.round(width * 0.36)), height };
  }
  if (part === 'name') {
    const left = isHome ? Math.round(width * (card?.column === 'left' ? 0.1 : 0.01)) : Math.round(width * 0.3);
    const right = isHome ? Math.round(width * (card?.column === 'left' ? 0.76 : 0.68)) : width;
    return { left, top: 0, width: Math.max(1, right - left), height };
  }
  return undefined;
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
  let pageSegmentationModes = { auto: '3', sparse: '11', block: '6', line: '7', word: '8' };

  async function worker() {
    if (!workerPromise) {
      const tesseract = loadTesseract();
      if (!tesseract?.createWorker) throw new Error('Die lokale Texterkennung konnte nicht geladen werden. Bitte die Seite neu laden.');
      pageSegmentationModes = {
        auto: tesseract.PSM?.AUTO ?? '3',
        sparse: tesseract.PSM?.SPARSE_TEXT ?? '11',
        block: tesseract.PSM?.SINGLE_BLOCK ?? '6',
        line: tesseract.PSM?.SINGLE_LINE ?? '7',
        word: tesseract.PSM?.SINGLE_WORD ?? '8',
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

  return function recognizeOcrImage(image, kindValue, onProgress = () => {}, knownNames = [], options = {}) {
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
          const cards = orderLineupCards(Array.isArray(prepared?.cards) ? prepared.cards : [], options?.isHome !== false);
          const isHome = options?.isHome !== false;
          let firstCandidate;
          if (cards.length >= 6) {
            const cardResults = cards.map(() => ({ number: '', name: '', nameConfidence: 0 }));
            const cardConfidences = [];
            await activeWorker.setParameters({
              tessedit_pageseg_mode: pageSegmentationModes.sparse,
              tessedit_char_whitelist: '0123456789OoIlL|',
            });
            for (let index = 0; index < cards.length; index += 1) {
              progressListener(`Rückennummer ${index + 1} von ${cards.length} wird gelesen …`);
              const card = typeof cards[index] === 'string' ? { image: cards[index] } : cards[index];
              const rectangle = lineupCardRectangle(card, 'number', isHome);
              const result = await activeWorker.recognize(card?.image ?? cards[index], rectangle ? { rectangle } : undefined);
              cardResults[index].number = result?.data?.text ?? '';
              cardConfidences.push(Number(result?.data?.confidence) || 0);
            }
            const unmatchedNumbers = lineupNumberRetryIndexes(cardResults);
            if (unmatchedNumbers.length) {
              await activeWorker.setParameters({
                tessedit_pageseg_mode: pageSegmentationModes.line,
                tessedit_char_whitelist: '0123456789',
              });
              for (const index of unmatchedNumbers) {
                progressListener(`Rückennummer ${index + 1} wird noch einmal geprüft …`);
                const card = typeof cards[index] === 'string' ? { image: cards[index] } : cards[index];
                const rectangle = lineupCardRectangle(card, 'number', isHome);
                const result = await activeWorker.recognize(card?.image ?? cards[index], rectangle ? { rectangle } : undefined);
                if (shirtNumber(result?.data?.text)) cardResults[index].number = result.data.text;
                cardConfidences.push(Number(result?.data?.confidence) || 0);
              }
            }
            const downscaledNumberRetries = lineupNumberRetryIndexes(cardResults)
              .filter((index) => cards[index]?.numberImage && cards[index]?.numberWidth && cards[index]?.numberHeight);
            if (downscaledNumberRetries.length) {
              await activeWorker.setParameters({
                tessedit_pageseg_mode: pageSegmentationModes.word,
                tessedit_char_whitelist: '0123456789OoIlL|',
              });
              for (const index of downscaledNumberRetries) {
                progressListener(`Rückennummer ${index + 1} wird verkleinert geprüft …`);
                const card = cards[index];
                const numberCard = {
                  width: card.numberWidth,
                  height: card.numberHeight,
                  column: card.column,
                };
                const rectangle = lineupCardRectangle(numberCard, 'number', isHome);
                const result = await activeWorker.recognize(card.numberImage, rectangle ? { rectangle } : undefined);
                if (shirtNumber(result?.data?.text)) cardResults[index].number = result.data.text;
                cardConfidences.push(Number(result?.data?.confidence) || 0);
              }
            }
            await activeWorker.setParameters({
              tessedit_pageseg_mode: pageSegmentationModes.sparse,
              tessedit_char_whitelist: '',
            });
            for (let index = 0; index < cards.length; index += 1) {
              progressListener(`Spielername ${index + 1} von ${cards.length} wird gelesen …`);
              const card = typeof cards[index] === 'string' ? { image: cards[index] } : cards[index];
              const rectangle = lineupCardRectangle(card, 'name', isHome);
              const result = await activeWorker.recognize(card?.image ?? cards[index], rectangle ? { rectangle } : undefined);
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
                const rectangle = lineupCardRectangle(card, 'name', isHome);
                const result = await activeWorker.recognize(card?.image ?? cards[index], rectangle ? { rectangle } : undefined);
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
