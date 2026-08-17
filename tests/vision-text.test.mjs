import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOcrRecognizer,
  normalizeOcrText,
  ocrProgressText,
} from '../admin-site/vision-ocr.mjs';

test('OCR lineup text is normalized for the existing player parser', () => {
  assert.equal(
    normalizeOcrText('lineup', 'Aufstellung:\n1 - P. Branden\n11, M. Muster\n2:1 SV Beispiel'),
    '01, P. Branden\n11, M. Muster',
  );
});

test('OCR scorer text is normalized and repeated names are grouped', () => {
  assert.equal(
    normalizeOcrText('scorers', 'Torschützen\n19′ M. Oosbrugger\nM. Oosbrugger (46.)\n72 - N. Beispiel\nEndstand 3:1'),
    '(19., 46.) M. Oosbrugger\n(72.) N. Beispiel',
  );
});

test('OCR scorer text supports separate minute and name lines', () => {
  assert.equal(normalizeOcrText('scorers', "19'\nM. Oosbrugger\nN. Beispiel\n72."), '(19.) M. Oosbrugger\n(72.) N. Beispiel');
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
    text: '(19.) M. Oosbrugger',
    confidence: 91,
  });
  await recognize('data:image/png;base64,def', 'scorers');
  assert.equal(workers, 1);
});
