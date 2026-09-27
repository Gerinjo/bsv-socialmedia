// Same labelled match-row rule as bsv-website/football-alerts; navigation text never counts.
export function parseRefereeAppointment(html, load) {
  const $ = load(html);
  if (!$('.stage-header').length || $('.team-name').length !== 2) return 'unknown';
  const rows = $('.stage-meta-left li').filter((_, el) => /^Schiedsrichter(?:\/in|in)?\s*:$/.test($(el).children().first().text().trim()));
  if (rows.length !== 1 || rows.first().children().length < 2) return 'unknown';
  const row = rows.first();
  if (row.find('a[href*="/schiedsrichterprofil/"]').length) return 'assigned';
  const details = row.clone(); details.children().first().remove();
  const value = details.text().replace(/\u200b/g, '').trim();
  if (!value || /^(?:[-–—]|nicht angesetzt|nicht eingeteilt|noch nicht angesetzt|offen|kein Schiedsrichter)$/i.test(value)) return 'missing';
  if (/nicht (?:veröffentlicht|verfügbar)|Datenschutz|keine Angaben/i.test(value)) return 'unknown';
  return 'assigned';
}

// Website team identities, keyed by the same website_path used by social_teams.
export const refereeYouthSources = [
  ['jugend/u19', 'c3b6acd7-2482-4c95-8777-b5260146fafc', '02ENGA3D98000000VS5489B1VU24SJ9U'],
  ['jugend/u17', '67008554-b3ee-4cfd-b0f7-55d498330d56', '02BBS8A0MK000000VS5489B1VU20GQ5T'],
  ['jugend/u15-c1', 'd684d289-c114-4b76-bb2d-333d477416fc', '0276T1CNK8000000VS5489B2VVRTHQ8E'],
  ['jugend/u15-c2', '9be73063-4394-4705-a49c-7627536742b8', '031AUPODRC000000VS5489BRVVNAT1LG'],
  ['jugend/u13-d1', '52344c96-823b-47c2-9eb7-caa3630ef628', '011MICT8J8000000VTVG0001VTR8C1K7'],
  ['jugend/u13-d2', 'be8f058e-f417-41f1-bcd7-badf526aa5a4', '027LQ5OTKO000000VS5489B1VTUKARPV'],
  ['jugend/u13-d3', 'e1533c60-6426-41ec-83fe-15675870ed93', '02PPN4UQA0000000VS5489B1VU7RM1AE'],
  ['jugend/juniorinnen/u17', 'f2a25edd-6dea-42fe-a4a5-13b9f10ae342', '02EK6R3IFK000000VS5489B2VVOABD77'],
  ['jugend/juniorinnen/u15', '46b5ce41-4781-47a4-9584-bb5dc5062e54', '0314RN90R8000000VS5489BRVVV10ESU'],
  ['jugend/juniorinnen/u13', '5ba007c5-a744-478b-a885-9defb0561c8c', '01SE05SKMO000000VS548985VTSAFDL4'],
];
