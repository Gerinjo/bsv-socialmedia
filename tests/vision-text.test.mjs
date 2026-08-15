import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeVisionText,
  responseOutputText,
  visionTextPrompt,
} from '../supabase/functions/_shared/vision-text.mjs';

test('lineup prompt requires renderer-compatible text and the BSV team', () => {
  const prompt = visionTextPrompt('lineup', { bsvTeam: 'BSV Nordstern Radolfzell', opponent: 'SV Beispiel' });
  assert.match(prompt, /BSV Nordstern Radolfzell/);
  assert.match(prompt, /01, Vorname Nachname/);
  assert.match(prompt, /höchstens elf/);
});

test('lineup text is normalized for the existing player parser', () => {
  assert.equal(
    normalizeVisionText('lineup', '```text\nAufstellung:\n- 1 - P. Branden\n- 11, M. Muster\n```'),
    '01, P. Branden\n11, M. Muster',
  );
});

test('scorer text is normalized for the report image', () => {
  assert.equal(
    normalizeVisionText('scorers', 'M. Oosbrugger (19., 46.)\n72 - N. Beispiel'),
    '(19., 46.) M. Oosbrugger\n(72.) N. Beispiel',
  );
});

test('Responses API text is read from message content', () => {
  assert.equal(responseOutputText({
    output: [{ content: [{ type: 'output_text', text: '01, P. Branden' }] }],
  }), '01, P. Branden');
});
