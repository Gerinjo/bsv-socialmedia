import test from 'node:test';
import assert from 'node:assert/strict';
import '../admin-site/crest-cutout.js';

const { removeEdgeConnectedBackground, createWhiteLogoVariant } = globalThis.BsvCrestCutout;

function image(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set(color, index * 4);
  return { width, height, data };
}

function setPixel(target, x, y, color) {
  target.data.set(color, (y * target.width + x) * 4);
}

function alphaAt(target, x, y) {
  return target.data[(y * target.width + x) * 4 + 3];
}

test('nur der randverbundene Hintergrund wird transparent', () => {
  const target = image(7, 7, [255, 255, 255, 255]);
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) setPixel(target, x, y, [20, 120, 50, 255]);
  }
  setPixel(target, 3, 3, [255, 255, 255, 255]);

  const result = removeEdgeConnectedBackground(target, { threshold: 20 });
  assert.equal(alphaAt(result, 0, 0), 0);
  assert.equal(alphaAt(result, 3, 3), 255, 'Weiß innerhalb des Wappens muss erhalten bleiben');
  assert.equal(alphaAt(result, 2, 2), 255);
});

test('vorhandene Transparenz wird unverändert übernommen', () => {
  const target = image(5, 5, [0, 0, 0, 0]);
  setPixel(target, 2, 2, [255, 255, 255, 255]);
  const result = removeEdgeConnectedBackground(target);
  assert.equal(result.metadata.method, 'source-alpha');
  assert.equal(alphaAt(result, 2, 2), 255);
});

test('vorhandene Transparenz außerhalb des Bildrands wird ebenfalls unverändert übernommen', () => {
  const target = image(5, 5, [230, 230, 230, 255]);
  setPixel(target, 2, 2, [20, 120, 50, 128]);

  const result = removeEdgeConnectedBackground(target);

  assert.equal(result.metadata.method, 'source-alpha');
  assert.equal(alphaAt(result, 0, 0), 255);
  assert.equal(alphaAt(result, 2, 2), 128);
});

test('kräftige Markenfarbe am Rand wird bei neutraler Automatik nicht entfernt', () => {
  const target = image(7, 7, [191, 160, 28, 255]);
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 2; x <= 4; x += 1) setPixel(target, x, y, [255, 255, 255, 255]);
  }

  const result = removeEdgeConnectedBackground(target, { requireNeutralBackground: true });

  assert.equal(result.metadata.method, 'colored-border-preserved');
  assert.equal(result.metadata.safetyBlocked, true);
  assert.equal(result.metadata.safetyReason, 'colored-border');
  assert.equal(result.metadata.removedRatio, 0);
  assert.equal(alphaAt(result, 0, 0), 255, 'Gold am Rand muss erhalten bleiben');
});

test('unverhältnismäßig große automatische Entfernung wird verworfen', () => {
  const target = image(10, 10, [255, 255, 255, 255]);
  for (let y = 3; y <= 6; y += 1) {
    for (let x = 3; x <= 6; x += 1) setPixel(target, x, y, [20, 120, 50, 255]);
  }

  const result = removeEdgeConnectedBackground(target, {
    requireNeutralBackground: true,
    maximumRemovedRatio: 0.45,
  });

  assert.equal(result.metadata.method, 'large-removal-preserved');
  assert.equal(result.metadata.safetyBlocked, true);
  assert.ok(result.metadata.candidateRemovedRatio > 0.45);
  assert.equal(result.metadata.removedRatio, 0);
  assert.equal(alphaAt(result, 0, 0), 255, 'Original muss bei blockierter Entfernung erhalten bleiben');
});

test('weiße Sponsorvariante lässt helle Buchstaben-Aussparungen transparent', () => {
  const target = image(5, 5, [255, 255, 255, 0]);
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) setPixel(target, x, y, [20, 70, 160, 255]);
  }
  setPixel(target, 2, 2, [255, 255, 255, 255]);

  const result = createWhiteLogoVariant(target, {
    backgroundColor: { red: 255, green: 255, blue: 255 },
    threshold: 44,
  });

  assert.equal(alphaAt(result, 2, 2), 0, 'das Loch im Buchstaben muss transparent bleiben');
  assert.equal(alphaAt(result, 1, 1), 255, 'der farbige Buchstabe muss sichtbar bleiben');
  assert.deepEqual([...result.data.slice((1 * 5 + 1) * 4, (1 * 5 + 1) * 4 + 3)], [255, 255, 255]);
});

test('weiße Sponsorvariante bewahrt echte Transparenz ohne Farbschlüssel', () => {
  const target = image(2, 1, [255, 255, 255, 0]);
  setPixel(target, 1, 0, [10, 20, 30, 128]);

  const result = createWhiteLogoVariant(target);

  assert.equal(alphaAt(result, 0, 0), 0);
  assert.equal(alphaAt(result, 1, 0), 128);
});

test('weiße Sponsorvariante erkennt deckendes Weiß in transparenten Farb-Logos', () => {
  const target = image(7, 7, [255, 255, 255, 0]);
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 1; x <= 5; x += 1) setPixel(target, x, y, [30, 60, 150, 255]);
  }
  setPixel(target, 3, 3, [255, 255, 255, 255]);

  const result = createWhiteLogoVariant(target);

  assert.equal(alphaAt(result, 3, 3), 0, 'weißes Loch im farbigen Logo muss transparent werden');
  assert.equal(alphaAt(result, 2, 2), 255);
});
