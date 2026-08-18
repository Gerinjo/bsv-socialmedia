import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compactLineupPersonName,
  createOcrRecognizer,
  findLineupCardRegions,
  isolateLineupCardPixels,
  isolateLineupTextPixels,
  lineupCardRectangle,
  matchKnownPersonName,
  normalizeLineupCard,
  normalizeOcrText,
  ocrProgressText,
  orderLineupCards,
} from '../admin-site/vision-ocr.mjs';

test('OCR lineup text is normalized for the existing player parser', () => {
  assert.equal(
    normalizeOcrText('lineup', 'Aufstellung:\n1 - P. Branden\n11, M. Muster\n2:1 SV Beispiel'),
    '01, P. Branden\n11, M. Muster',
  );
});

test('OCR lineup accepts pipes, number labels and trailing shirt numbers', () => {
  assert.equal(
    normalizeOcrText('lineup', '1 Domenik Wannemacher | Nr. 11 Raphael Buckel | Justin Kihimann (#7) | 9 | Ilia Gogichaishvili'),
    '01, D. Wannemacher\n11, R. Buckel\n07, J. Kihimann\n09, I. Gogichaishvili',
  );
});

test('OCR lineup joins separate number and multi-line names and repairs common number glyphs', () => {
  assert.equal(
    normalizeOcrText('lineup', 'O1\nPascal\nBrandenburg\n03 Bager\nAl Daraji\n10 Raphael Buckel'),
    '01, P. Brandenburg\n03, B. Al Daraji\n10, R. Buckel',
  );
});

test('OCR lineup separates two graphical cards recognized on the same text line', () => {
  assert.equal(
    normalizeOcrText('lineup', '10 Raphael Buckel 01 Pascal Brandenburg\n12 Julian Brendle 03 Bager Al Daraji'),
    '10, R. Buckel\n01, P. Brandenburg\n12, J. Brendle\n03, B. Al Daraji',
  );
});

test('OCR lineup removes isolated quote artifacts after player names', () => {
  assert.equal(normalizeOcrText('lineup', "01 Pascal Brandenburg '"), '01, P. Brandenburg');
});

test('OCR lineup abbreviates the first name before showing the result for review', () => {
  assert.equal(compactLineupPersonName('Mohamad Salim Hartel'), 'M. Salim Hartel');
  assert.equal(compactLineupPersonName('Baqer Al Daraji'), 'B. Al Daraji');
  assert.equal(compactLineupPersonName('David Pereira Honorato'), 'D. Pereira Honorato');
  assert.equal(normalizeLineupCard('17', 'Giuseppe Vazquez Gabino'), '17, G. Vazquez Gabino');
});

test('lineup card OCR repairs small name errors with the known BSV roster', () => {
  const knownNames = ['Baqer Al Daraji', 'Julian Brendle', 'Momodou Sidibeh', 'Raphael Buckel'];
  assert.equal(matchKnownPersonName('Bager\nAl Daraji', knownNames), 'Baqer Al Daraji');
  assert.equal(matchKnownPersonName('A Daraji\nBager', knownNames), 'Baqer Al Daraji');
  assert.equal(matchKnownPersonName('Julian\nBrendie', knownNames), 'Julian Brendle');
  assert.equal(matchKnownPersonName('Momadou\nSidibeh', knownNames), 'Momodou Sidibeh');
  assert.equal(normalizeLineupCard('O7', 'Momadou\nSidibeh', knownNames), '07, M. Sidibeh');
});

test('lineup card OCR ignores text fragments beside a valid shirt number and name', () => {
  assert.equal(normalizeLineupCard('10\nLan', 'Brian\nda Costa Monteiro'), '10, B. da Costa Monteiro');
  assert.equal(normalizeLineupCard('18 be NS', 'A ü\nShawn\nGoethe\nN\nSn'), '18, S. Goethe');
  assert.equal(normalizeLineupCard('17°', 'Giuseppe\nKi\nVazquez Gabino'), '17, G. Vazquez Gabino');
  assert.equal(normalizeLineupCard('170', 'Giuseppe Vazquez Gabino'), '17, G. Vazquez Gabino');
  assert.equal(normalizeLineupCard('171', 'Giuseppe Vazquez Gabino'), '');
  assert.equal(normalizeLineupCard('fl] 1\n20', 'Samet\nGünes'), '20, S. Günes');
  assert.equal(normalizeLineupCard('18', 'san Shawn Goethe'), '18, S. Goethe');
});

test('lineup card OCR does not turn short garbage into a catalog name', () => {
  assert.equal(matchKnownPersonName('B. X', ['Raphael Buckel']), 'B. X');
  assert.equal(normalizeLineupCard('10', 'B. X', ['Raphael Buckel']), '');
});

test('lineup cards start with the six-player side of the home or away team', () => {
  const homeCards = [
    ...Array.from({ length: 6 }, (_, index) => ({ column: 'left', id: `L${index + 1}` })),
    ...Array.from({ length: 5 }, (_, index) => ({ column: 'right', id: `R${index + 1}` })),
  ];
  const awayCards = [
    ...Array.from({ length: 5 }, (_, index) => ({ column: 'left', id: `L${index + 1}` })),
    ...Array.from({ length: 6 }, (_, index) => ({ column: 'right', id: `R${index + 1}` })),
  ];
  assert.deepEqual(orderLineupCards(homeCards, true).map((card) => card.id), ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'R1', 'R2', 'R3', 'R4', 'R5']);
  assert.deepEqual(orderLineupCards(awayCards, false).map((card) => card.id), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'L1', 'L2', 'L3', 'L4', 'L5']);
});

test('lineup card crops follow the mirrored home and away graphic', () => {
  const leftCard = { width: 200, height: 60, column: 'left' };
  const rightCard = { width: 200, height: 60, column: 'right' };
  assert.deepEqual(lineupCardRectangle(leftCard, 'number', false), { left: 0, top: 0, width: 72, height: 60 });
  assert.deepEqual(lineupCardRectangle(leftCard, 'number', true), { left: 128, top: 0, width: 72, height: 60 });
  assert.deepEqual(lineupCardRectangle(leftCard, 'name', true), { left: 20, top: 0, width: 132, height: 60 });
  assert.deepEqual(lineupCardRectangle(rightCard, 'name', true), { left: 2, top: 0, width: 134, height: 60 });
});

test('lineup image isolation keeps light card text and removes grass and card background', () => {
  const pixels = isolateLineupTextPixels({
    width: 3,
    height: 3,
    data: new Uint8ClampedArray([
      20, 85, 35, 255, 34, 34, 34, 255, 20, 85, 35, 255,
      20, 85, 35, 255, 235, 235, 235, 255, 34, 34, 34, 255,
      20, 85, 35, 255, 34, 34, 34, 255, 20, 85, 35, 255,
    ]),
  });
  assert.deepEqual([...pixels.data.slice(16, 20)], [0, 0, 0, 255]);
  assert.deepEqual([...pixels.data.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...pixels.data.slice(4, 8)], [255, 255, 255, 255]);
});

test('graphical lineup cards are detected separately in both columns', () => {
  const width = 20;
  const height = 30;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 20; data[offset + 1] = 90; data[offset + 2] = 30; data[offset + 3] = 255;
  }
  for (const [x1, y1, x2, y2] of [[1, 2, 8, 10], [1, 16, 8, 24], [11, 4, 18, 12], [11, 18, 18, 26]]) {
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 34; data[offset + 1] = 34; data[offset + 2] = 34;
    }
  }
  assert.equal(findLineupCardRegions({ width, height, data }).length, 4);
});

test('lineup card detection restores a card hidden by multi-line name gaps', () => {
  const width = 200;
  const height = 240;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 20; data[offset + 1] = 90; data[offset + 2] = 30; data[offset + 3] = 255;
  }
  const cards = [
    ...[10, 50, 130, 170, 210].map((y) => [5, y, 90, y + 29]),
    ...[30, 70, 110, 150, 190].map((y) => [105, y, 190, y + 29]),
  ];
  for (const [fromX, fromY, toX, toY] of cards) {
    for (let y = fromY; y <= toY; y += 1) for (let x = fromX; x <= toX; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 34; data[offset + 1] = 34; data[offset + 2] = 34;
    }
  }
  const regions = findLineupCardRegions({ width, height, data });
  assert.equal(regions.length, 11);
  assert.equal(regions.filter((region) => region.x + region.width / 2 < width / 2).length, 6);
  assert.ok(regions.some((region) => region.y >= 85 && region.y <= 100));
});

test('card isolation keeps the full light glyph without requiring a dark neighboring pixel', () => {
  const card = isolateLineupCardPixels({
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      34, 34, 34, 255,
      110, 110, 110, 255,
      240, 240, 240, 255,
    ]),
  }, { x: 0, y: 0, width: 3, height: 1 });
  assert.deepEqual([...card.data], [
    255, 255, 255, 255,
    0, 0, 0, 255,
    0, 0, 0, 255,
  ]);
});

test('OCR scorer text is normalized and repeated names are grouped', () => {
  assert.equal(
    normalizeOcrText('scorers', 'Torschützen\n19′ M. Oosbrugger\nM. Oosbrugger (46.)\n72 - N. Beispiel\nEndstand 3:1'),
    "(19', 46') M. Oosbrugger\n(72') N. Beispiel",
  );
});

test('OCR scorer text accepts pipe separators, missing minute marks and stoppage time', () => {
  assert.equal(
    normalizeOcrText('scorers', "(18, 42) Domenik Wannemacher | (21') Raphael Buckel | (45' +2) Justin Kihimann | (47) Ilia Gogichaishvili | (81') Marco Wacker"),
    "(18', 42') D. Wannemacher\n(21') R. Buckel\n(45'+2) J. Kihimann\n(47') I. Gogichaishvili\n(81') M. Wacker",
  );
});

test('OCR scorer text supports separate minute and name lines', () => {
  assert.equal(normalizeOcrText('scorers', "19'\nM. Oosbrugger\nN. Beispiel\n72."), "(19') M. Oosbrugger\n(72') N. Beispiel");
});

test('OCR progress is translated for the UI', () => {
  assert.equal(ocrProgressText({ status: 'recognizing text', progress: 0.42 }), 'Text wird lokal erkannt · 42 %');
});

test('browser OCR worker is reused and its text is normalized', async () => {
  let workers = 0;
  const fakeWorker = {
    async setParameters() {},
    async recognize() {
      return { data: { text: "19' M. Oosbrugger", confidence: 91 } };
    },
    async terminate() {},
  };
  const recognize = createOcrRecognizer(() => ({
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: '3' },
    async createWorker() {
      workers += 1;
      return fakeWorker;
    },
  }));

  assert.deepEqual(await recognize('data:image/png;base64,abc', 'scorers'), {
    text: "(19') M. Oosbrugger",
    confidence: 91,
  });
  await recognize('data:image/png;base64,def', 'scorers');
  assert.equal(workers, 1);
});

test('graphical lineup uses isolated sparse-text OCR without retry after ten players', async () => {
  const calls = [];
  const parameters = [];
  const fakeWorker = {
    async setParameters(value) { parameters.push(value); },
    async recognize(image) {
      calls.push(image);
      return { data: { text: Array.from({ length: 10 }, (_, index) => `${index + 1} Spieler ${index + 1}`).join('\n'), confidence: 88 } };
    },
    async terminate() {},
  };
  const recognize = createOcrRecognizer(() => ({
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: '3', SPARSE_TEXT: '11' },
    async createWorker() { return fakeWorker; },
  }), async () => 'isolated-image');

  const result = await recognize('original-image', 'lineup');
  assert.equal(result.text.split('\n').length, 10);
  assert.deepEqual(calls, ['isolated-image', 'original-image']);
  assert.ok(parameters.some((value) => value.tessedit_pageseg_mode === '11'));
});

test('segmented lineup cards read number and name in separate sparse regions', async () => {
  const parameters = [];
  const calls = [];
  const fakeWorker = {
    async setParameters(value) { parameters.push(value); },
    async recognize(image, options) {
      calls.push({ image, options });
      const index = Number(String(image).replace('card-', ''));
      const text = options?.rectangle?.left === 0 ? String(index) : `Spieler ${index}`;
      return { data: { text, confidence: 90 } };
    },
    async terminate() {},
  };
  const recognize = createOcrRecognizer(() => ({
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: '3', SPARSE_TEXT: '11', SINGLE_BLOCK: '6', SINGLE_WORD: '8' },
    async createWorker() { return fakeWorker; },
  }), async () => ({
    image: 'segmented-image',
    cards: Array.from({ length: 11 }, (_, index) => ({ image: `card-${index + 1}`, width: 200, height: 60 })),
    segmented: true,
  }));

  const result = await recognize('original-image', 'lineup', () => {}, [], { isHome: false });
  assert.equal(result.text.split('\n').length, 11);
  assert.equal(calls.length, 22);
  assert.ok(calls.slice(0, 11).every((call) => call.options.rectangle.left === 0));
  assert.ok(calls.slice(11).every((call) => call.options.rectangle.left > 0));
  assert.ok(parameters.filter((value) => value.tessedit_pageseg_mode === '11').length >= 2);
});

test('segmented lineup retries a missed shirt number as a single line', async () => {
  const parameters = [];
  let activeMode = '3';
  let firstCardNumberAttempts = 0;
  const fakeWorker = {
    async setParameters(value) {
      parameters.push(value);
      activeMode = value.tessedit_pageseg_mode ?? activeMode;
    },
    async recognize(image, options) {
      const index = Number(String(image).replace('card-', ''));
      const numberCrop = options?.rectangle?.left >= 100;
      if (index === 1 && numberCrop) {
        firstCardNumberAttempts += 1;
        return { data: { text: activeMode === '7' ? '08' : '', confidence: activeMode === '7' ? 83 : 0 } };
      }
      return { data: { text: numberCrop ? String(index + 10) : `Spieler ${index}`, confidence: 90 } };
    },
    async terminate() {},
  };
  const recognize = createOcrRecognizer(() => ({
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: '3', SPARSE_TEXT: '11', SINGLE_BLOCK: '6', SINGLE_LINE: '7' },
    async createWorker() { return fakeWorker; },
  }), async () => ({
    image: 'segmented-image',
    cards: Array.from({ length: 11 }, (_, index) => ({ image: `card-${index + 1}`, width: 200, height: 60 })),
    segmented: true,
  }));

  const result = await recognize('original-image', 'lineup', () => {}, [], { isHome: true });
  assert.match(result.text, /^08, Spieler$/m);
  assert.equal(firstCardNumberAttempts, 2);
  assert.ok(parameters.some((value) => value.tessedit_pageseg_mode === '7'));
});

test('segmented lineup retries a still missing shirt number on a downscaled card', async () => {
  let activeMode = '3';
  const calls = [];
  const fakeWorker = {
    async setParameters(value) { activeMode = value.tessedit_pageseg_mode ?? activeMode; },
    async recognize(image, options) {
      calls.push({ image, mode: activeMode });
      if (image === 'card-1-small') return { data: { text: '17', confidence: 81 } };
      const index = Number(String(image).replace('card-', ''));
      const numberCrop = options?.rectangle?.left >= 100;
      if (numberCrop) return { data: { text: index === 1 ? '' : String(index + 10), confidence: index === 1 ? 0 : 90 } };
      return { data: { text: `Spieler ${index}`, confidence: 90 } };
    },
    async terminate() {},
  };
  const recognize = createOcrRecognizer(() => ({
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: '3', SPARSE_TEXT: '11', SINGLE_BLOCK: '6', SINGLE_LINE: '7', SINGLE_WORD: '8' },
    async createWorker() { return fakeWorker; },
  }), async () => ({
    image: 'segmented-image',
    cards: Array.from({ length: 11 }, (_, index) => ({
      image: `card-${index + 1}`,
      width: 200,
      height: 60,
      ...(index === 0 ? { numberImage: 'card-1-small', numberWidth: 200, numberHeight: 80 } : {}),
    })),
    segmented: true,
  }));

  const result = await recognize('original-image', 'lineup', () => {}, [], { isHome: true });
  assert.match(result.text, /^17, Spieler$/m);
  assert.ok(calls.some((call) => call.image === 'card-1-small' && call.mode === '8'));
});

test('segmented lineup retries duplicate shirt numbers instead of losing a card', async () => {
  let activeMode = '3';
  const numberAttempts = new Map();
  const fakeWorker = {
    async setParameters(value) { activeMode = value.tessedit_pageseg_mode ?? activeMode; },
    async recognize(image, options) {
      const index = Number(String(image).replace('card-', ''));
      const numberCrop = options?.rectangle?.left >= 100;
      if (!numberCrop) return { data: { text: `Spieler ${index}`, confidence: 90 } };
      numberAttempts.set(index, (numberAttempts.get(index) ?? 0) + 1);
      if (index === 7) return { data: { text: activeMode === '7' ? '17' : '1', confidence: 82 } };
      return { data: { text: String(index).padStart(2, '0'), confidence: 90 } };
    },
    async terminate() {},
  };
  const recognize = createOcrRecognizer(() => ({
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: '3', SPARSE_TEXT: '11', SINGLE_BLOCK: '6', SINGLE_LINE: '7' },
    async createWorker() { return fakeWorker; },
  }), async () => ({
    image: 'segmented-image',
    cards: Array.from({ length: 11 }, (_, index) => ({ image: `card-${index + 1}`, width: 200, height: 60 })),
    segmented: true,
  }));

  const result = await recognize('original-image', 'lineup', () => {}, [], { isHome: true });
  assert.equal(result.text.split('\n').length, 11);
  assert.match(result.text, /^17, Spieler$/m);
  assert.equal(numberAttempts.get(1), 2);
  assert.equal(numberAttempts.get(7), 2);
});
