const OCR_KINDS = new Set(['lineup', 'scorers']);

function requiredOcrKind(value) {
  const kind = String(value ?? '').trim();
  if (!OCR_KINDS.has(kind)) throw new Error('Die gewünschte Bildauswertung ist ungültig.');
  return kind;
}

function cleanOcrLines(value) {
  return String(value ?? '')
    .replaceAll('\u00ad', '')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/[•●▪►]/g, ' ')
      .replace(/[|¦]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

function cleanPersonName(value) {
  const name = String(value ?? '')
    .replace(/^\s*\d{1,2}\s*[:–—-]\s*\d{1,2}\s+/, '')
    .replace(/^[^\p{L}]+/u, '')
    .replace(/[^\p{L}\p{M}.'’\-?\s]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2 || !/\p{L}/u.test(name) || /^\d/u.test(name)) return '';
  return name;
}

function minutesFrom(value) {
  return [...String(value ?? '').matchAll(/(?<!\d)(\d{1,3})(?!\d)/g)]
    .map((match) => Number(match[1]))
    .filter((minute, index, minutes) => minute >= 1 && minute <= 130 && minutes.indexOf(minute) === index);
}

function minuteOnly(value) {
  const text = String(value ?? '').trim();
  if (!text || /\p{L}/u.test(text.replace(/min(?:ute)?n?/giu, ''))) return [];
  if (/^\(?\s*\d{1,3}(?:\s*[.'’′]|\s*min(?:ute)?n?)?(?:\s*[,/+&]\s*\d{1,3}(?:\s*[.'’′]|\s*min(?:ute)?n?)?)*\s*\)?$/iu.test(text)) {
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
    const name = cleanPersonName(leadingParentheses[2]);
    if (minutes.length && name) return { name, minutes };
  }

  const trailingParentheses = /^(.+?)\s*\(\s*([^)]+)\)\s*$/.exec(line);
  if (trailingParentheses) {
    const minutes = minutesFrom(trailingParentheses[2]);
    const name = cleanPersonName(trailingParentheses[1]);
    if (minutes.length && name) return { name, minutes };
  }

  const leadingMarkedMinutes = /^((?:\d{1,3}\s*(?:[.'’′]|min(?:ute)?n?)\s*(?:[,/+&]\s*)?)+)\s*(?:[-–—:]+\s*)?(.+)$/iu.exec(line);
  if (leadingMarkedMinutes) {
    const minutes = minutesFrom(leadingMarkedMinutes[1]);
    const name = cleanPersonName(leadingMarkedMinutes[2]);
    if (minutes.length && name) return { name, minutes };
  }

  const trailingMarkedMinutes = /^(.+?)\s+((?:\d{1,3}\s*(?:[.'’′]|min(?:ute)?n?)\s*(?:[,/+&]\s*)?)+)$/iu.exec(line);
  if (trailingMarkedMinutes) {
    const minutes = minutesFrom(trailingMarkedMinutes[2]);
    const name = cleanPersonName(trailingMarkedMinutes[1]);
    if (minutes.length && name) return { name, minutes };
  }

  const separatedMinutes = /^(\d{1,3}(?:\s*[,/+&]\s*\d{1,3})*)\s*[-–—:|]\s*(.+)$/.exec(line);
  if (separatedMinutes && !/^\d/.test(separatedMinutes[2].trim())) {
    const minutes = minutesFrom(separatedMinutes[1]);
    const name = cleanPersonName(separatedMinutes[2]);
    if (minutes.length && name) return { name, minutes };
  }

  return null;
}

function normalizeLineup(lines) {
  const players = [];
  const seen = new Set();
  for (const line of lines) {
    const match = /^(?:#\s*)?(\d{1,3})\s*(?:[,;:.)-]|\s)\s*(.+)$/.exec(line);
    if (!match || /^\d/.test(match[2].trim())) continue;
    const name = cleanPersonName(match[2]);
    if (!name) continue;
    const entry = `${match[1].padStart(2, '0')}, ${name}`;
    const key = entry.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    players.push(entry);
    if (players.length === 11) break;
  }
  return players.join('\n');
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
    const nextName = cleanPersonName(lines[index + 1]);
    if (minutes.length && nextName && !scorerFromLine(lines[index + 1])) {
      parsed.push({ name: nextName, minutes });
      index += 1;
      continue;
    }

    const nextMinutes = minuteOnly(lines[index + 1]);
    const name = cleanPersonName(line);
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
      if (!target.minutes.includes(minute)) target.minutes.push(minute);
    }
  }

  return [...grouped.values()]
    .slice(0, 4)
    .map(({ name, minutes }) => `(${minutes.sort((left, right) => left - right).map((minute) => `${minute}.`).join(', ')}) ${name}`)
    .join('\n');
}

export function normalizeOcrText(kindValue, value) {
  const kind = requiredOcrKind(kindValue);
  const lines = cleanOcrLines(value)
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

export function createOcrRecognizer(loadTesseract = () => globalThis.Tesseract) {
  let workerPromise;
  let progressListener = () => {};
  let queue = Promise.resolve();

  async function worker() {
    if (!workerPromise) {
      const tesseract = loadTesseract();
      if (!tesseract?.createWorker) throw new Error('Die lokale Texterkennung konnte nicht geladen werden. Bitte die Seite neu laden.');
      workerPromise = tesseract.createWorker('deu', tesseract.OEM?.LSTM_ONLY ?? 1, {
        logger: (message) => progressListener(ocrProgressText(message)),
      }).then(async (createdWorker) => {
        await createdWorker.setParameters({
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
          tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? '3',
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

  return function recognizeOcrImage(image, kindValue, onProgress = () => {}) {
    const kind = requiredOcrKind(kindValue);
    const task = queue.then(async () => {
      progressListener = onProgress;
      try {
        const activeWorker = await worker();
        const result = await activeWorker.recognize(image);
        const text = normalizeOcrText(kind, result?.data?.text);
        if (!text) {
          const subject = kind === 'lineup' ? 'keine eindeutige Aufstellung' : 'keine eindeutigen Torschützen';
          throw new Error(`Auf dem Bild wurden ${subject} erkannt. Bitte das Bild enger zuschneiden oder den Text von Hand eingeben.`);
        }
        return { text, confidence: Number(result?.data?.confidence) || 0 };
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
