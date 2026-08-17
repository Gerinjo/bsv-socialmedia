import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOcrRecognizer,
  findLineupCardRegions,
  isolateLineupTextPixels,
  normalizeOcrText,
  ocrProgressText,
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

test('segmented lineup cards use single-block OCR mode', async () => {
  const parameters = [];
  const fakeWorker = {
    async setParameters(value) { parameters.push(value); },
    async recognize() {
      return { data: { text: Array.from({ length: 11 }, (_, index) => `${index + 1} Spieler ${index + 1}`).join('\n'), confidence: 90 } };
    },
    async terminate() {},
  };
  const recognize = createOcrRecognizer(() => ({
    OEM: { LSTM_ONLY: 1 },
    PSM: { AUTO: '3', SPARSE_TEXT: '11', SINGLE_BLOCK: '6' },
    async createWorker() { return fakeWorker; },
  }), async () => ({ image: 'segmented-image', segmented: true }));

  await recognize('original-image', 'lineup');
  assert.ok(parameters.some((value) => value.tessedit_pageseg_mode === '6'));
});
