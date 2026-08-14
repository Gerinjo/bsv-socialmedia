import assert from 'node:assert/strict';
import test from 'node:test';

import { bulletReportText, reportEmojis, stylizeReportText } from '../admin-site/rich-text-editor.mjs';

test('Spielbericht formatiert lateinische Zeichen und Zahlen Instagram-tauglich fett', () => {
  assert.equal(stylizeReportText('BSV 12', 'bold'), '𝐁𝐒𝐕 𝟏𝟐');
});

test('Spielbericht formatiert Text kursiv und behält Satzzeichen', () => {
  assert.equal(stylizeReportText('Tor!', 'italic'), '𝑇𝑜𝑟!');
});

test('Aufzählungen werden zeilenweise ergänzt und nicht doppelt markiert', () => {
  assert.equal(bulletReportText('Tor\n- Assist\n\n• Sieg'), '• Tor\n• Assist\n\n• Sieg');
});

test('Emoji-Auswahl enthält fußballtypische Zeichen', () => {
  assert.ok(reportEmojis.includes('⚽'));
  assert.ok(reportEmojis.includes('💚'));
  assert.ok(reportEmojis.includes('🏆'));
});
