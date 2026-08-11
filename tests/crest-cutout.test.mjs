import test from 'node:test';
import assert from 'node:assert/strict';
import '../admin-site/crest-cutout.js';

const { removeEdgeConnectedBackground } = globalThis.BsvCrestCutout;

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
