import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../admin-site/admin-page.html', import.meta.url), 'utf8');
function uiFunction(name, globals = {}) {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf('\n    function ', start + 1);
  return vm.runInNewContext(`${source.slice(start, end)}; ${name}`, globals);
}

test('occupied slots display the escaped partner name and remain checked and disabled', () => {
  const render = uiFunction('sponsorSlotHtml', {
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    sponsorContextLabels: { announcement: 'Ankündigung' },
  });
  const options = {
    audience: { id: 'club', label: 'Gesamtverein' }, context: 'announcement', slot: 2, current: 1,
    holder: { sponsor_id: 'other' }, sponsorsById: new Map([['other', { name: 'Firma "A & B"' }]]),
  };
  const occupied = render(options);
  assert.match(occupied, /Belegt durch Firma &quot;A &amp; B&quot;/);
  assert.match(occupied, /checked disabled/);
  assert.match(occupied, /tabindex="0"/);
  const own = render({ ...options, holder: undefined, current: 2 });
  assert.match(own, /checked/);
  assert.doesNotMatch(own, /disabled/);
  const free = render({ ...options, holder: undefined });
  assert.doesNotMatch(free, /checked|disabled/);
});

test('selecting a slot clears the other own slot but never clears occupied slots', () => {
  const inputs = [{ checked: true }, { checked: false }];
  for (const input of inputs) input.closest = () => ({ querySelectorAll: () => inputs });
  uiFunction('wireSponsorSlotControls', { document: { querySelectorAll: () => inputs } })();
  inputs[1].checked = true;
  inputs[1].onchange();
  assert.equal(inputs[0].checked, false);
  inputs[0].checked = true;
  inputs[0].disabled = true;
  inputs[1].onchange();
  assert.equal(inputs[0].checked, true);
  inputs[1].checked = false;
  inputs[1].onchange();
  assert.equal(inputs[0].checked, true);
});

test('saving selects only checked and enabled slots for the current partner', () => {
  const collect = uiFunction('collectSponsorAssignments', {
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, '.sponsorAssignment:checked:not(:disabled)');
        return [{ dataset: { audience: 'club', context: 'announcement' }, value: '2' }];
      },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(collect())), [{ audienceId: 'club', context: 'announcement', slot: 2 }]);
});
