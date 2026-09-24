import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderEditorialNewsletter, newsletterDefaults, normalizeNewsletterSettings, newsletterExcerpt, newsletterSource, newsletterSelection, newsletterArticleUrl } from '../src/newsletter.mjs';
const template = await readFile(new URL('../templates/newsletter.html', import.meta.url), 'utf8');
const snapshot = {kind:'newsletter',title:'Nordstern Post · Oktober',publishes_on:'2026-10-01',articles:[{title:'Aus dem Verein',body:'Wir sehen uns beim BSV!\n\nhttps://bsvnordstern.de/verein/termine?a=1&b=2',author:'Vorstandschaft',status:'ready'}]};

test('newsletter exports an email, retains branding and unsubscribe token, and matches plain text', () => {
  const mail = renderEditorialNewsletter(snapshot, template, {preview:false});
  assert.match(mail.html, /newsletter-header/);
  assert.match(mail.html, /teams-schuss.webp/);
  assert.match(mail.html, /bsv-nordstern.png/);
  assert.match(mail.html, /Oktober 2026/);
  assert.match(mail.html, /href="https:\/\/bsvnordstern.de\/verein\/termine\?a=1&amp;b=2"/);
  for (const output of [mail.html, mail.text]) {
    assert.ok(output.includes('Wir sehen uns beim BSV!'));
    assert.ok(output.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));
  }
  assert.doesNotMatch(mail.html, /<script|<iframe|stadium-reader|\{\{CONTENT\}\}/);
  assert.equal(mail.subject, snapshot.title);
});
test('newsletter distinguishes preview from export and rejects wrong issue type', () => {
  const draft = structuredClone(snapshot);
  draft.articles[0].status = 'review';
  assert.match(renderEditorialNewsletter(draft, template).html, /noch nicht freigegeben/);
  assert.throws(() => renderEditorialNewsletter(draft, template, {preview:false}), /freigeben/);
  assert.throws(() => renderEditorialNewsletter({...snapshot,articles:[]}, template, {preview:false}), /freigeben/);
  assert.throws(() => renderEditorialNewsletter({...snapshot,kind:'stadium'}, template), /Newsletter-Ausgabe/);
});
test('untrusted editorial text and titles stay text in newsletter HTML', () => {
  const hostile = {...snapshot,title:'<script>alert(1)</script>',articles:[{title:'<img src=x onerror=alert(1)>',body:'<script>alert(1)</script>\n\njavascript:alert(1)',status:'ready'}]};
  const result = renderEditorialNewsletter(hostile, template, {preview:false});
  assert.doesNotMatch(result.html, /<script|<img src=x|href="javascript:/);
  assert.ok(result.text.includes('<script>alert(1)</script>'));
});
test('expiring article images cannot escape into sendable mail exports', () => {
  const withImages = structuredClone(snapshot);
  withImages.articles[0].galleries = [{images:[{photo_url:'https://example.org/storage/v1/object/sign/gallery/photo.png?token=secret',alt:'Vereinsfoto'}]}];
  assert.match(renderEditorialNewsletter(withImages, template).html, /Vereinsfoto/);
  assert.throws(() => renderEditorialNewsletter(withImages, template, {preview:false}), /dauerhaften öffentlichen Link/);
  withImages.articles[0].galleries[0].images[0].photo_url = 'https://bsvnordstern.de/images/foto.png';
  const result = renderEditorialNewsletter(withImages, template, {preview:false});
  assert.match(result.html, /src="https:\/\/bsvnordstern.de\/images\/foto.png"/);
  assert.match(result.text, /https:\/\/bsvnordstern.de\/images\/foto.png/);
});

test('every newsletter has the fixed stadium section in HTML and text, even without published issues', () => {
  for (const mail of [renderEditorialNewsletter(snapshot, template, {preview:false}), renderEditorialNewsletter({...snapshot,articles:[]}, template)]) {
    assert.equal((mail.html.match(/data-newsletter-stadium-magazines/g) || []).length, 1);
    assert.ok(mail.html.includes('Unsere Stadionhefte'));
    assert.ok(mail.text.includes('UNSERE STADIONHEFTE'));
    assert.ok(mail.html.includes('href="https://gerinjo.github.io/bsv-stadionheft-pages/"'));
    assert.ok(mail.text.includes('https://gerinjo.github.io/bsv-stadionheft-pages/'));
  }
});
test('newsletter links published stadium issues newest first, including editions with newer drafts', () => {
  const older = {id:'10000000-0000-0000-0000-000000000001',kind:'stadium',published_at:'2026-09-10T12:00:00Z',published_version:2,version:2,title:'Altes Heft'};
  const newer = {id:'20000000-0000-0000-0000-000000000002',kind:'stadium',published_at:'2026-09-20T12:00:00Z',published_version:3,version:4,title:'Interner neuer Entwurfstitel'};
  const stadiumIssues = [older, newer, older,
    {...older,id:'30000000-0000-0000-0000-000000000003',published_at:null,published_version:null},
    {...older,id:'40000000-0000-0000-0000-000000000004',kind:'newsletter'},
    {...older,id:'50000000-0000-0000-0000-000000000005',published_at:'invalid'},
    {...older,id:'demo-stadium'},
    {...older,id:'60000000-0000-0000-0000-000000000006',published_version:null},
  ];
  const preview = renderEditorialNewsletter(snapshot, template, {stadiumIssues});
  const exported = renderEditorialNewsletter(snapshot, template, {stadiumIssues,preview:false});
  assert.equal(preview.html.replaceAll('https://bsv-story-automatik.jerome-ernsberger.chatgpt.site/newsletter/abmelden?vorschau=1', 'https://bsv-story-automatik.jerome-ernsberger.chatgpt.site/newsletter/abmelden#{{{RESEND_UNSUBSCRIBE_URL}}}'), exported.html);
  for (const content of [exported.html, exported.text]) {
    const prefix = 'https://bsv-story-automatik.jerome-ernsberger.chatgpt.site/stadionheft/';
    assert.ok(content.includes(prefix + older.id));
    assert.ok(content.includes(prefix + newer.id));
    assert.ok(content.indexOf(prefix + newer.id) < content.indexOf(prefix + older.id));
    assert.equal(content.split(prefix + older.id).length - 1, 1);
    assert.ok(content.includes('20.9.2026'));
    assert.ok(!content.includes(newer.title));
    for (const excluded of stadiumIssues.slice(3)) assert.ok(!content.includes(prefix + excluded.id));
  }
});


test('newsletter settings reach HTML, text and email metadata in the wider framed layout', () => {
  const settings = {...newsletterDefaults(snapshot), name:'Sternenpost & Verein',number:'02 / 2026',headline:'Gemeinsam in den Herbst',intro:'Erste Zeile.\nZweite Zeile.',kicker:'UNSER VEREIN',subject:'Deine Oktoberpost',preheader:'Das erwartet dich im Oktober'};
  const mail = renderEditorialNewsletter({...snapshot,newsletter_settings:settings}, template, {preview:false});
  assert.equal(mail.subject, settings.subject);
  assert.equal(mail.preheader, settings.preheader);
  assert.ok(mail.html.includes('Sternenpost &amp; Verein'));
  assert.ok(mail.text.includes(settings.name));
  for (const output of [mail.html,mail.text]) {
    assert.ok(output.includes('Ausgabe 02 / 2026 · Oktober 2026'));
    assert.ok(output.includes(settings.headline));
    assert.ok(output.includes(settings.kicker));
  }
  assert.match(mail.html, /Erste Zeile.<br \/>Zweite Zeile./);
  assert.match(mail.html, /max-width:720px[^"]*border:4px solid #17613a/);
  assert.match(mail.html, /\[if mso\]><table[^>]*width="720"/);
  assert.ok(!mail.html.includes('{{BRAND}}'));
});
test('visibility settings remove header fields from HTML and text while stadium links remain', () => {
  const settings = {...newsletterDefaults(snapshot),name:'HiddenName',number:'HiddenNumber',headline:'HiddenHeadline',kicker:'HiddenKicker',intro:'HiddenIntro',preheader:'Explicit preview',showName:false,showNumber:false,showDate:false,showHeadline:false,showKicker:false,showIntro:false};
  const mail = renderEditorialNewsletter({...snapshot,newsletter_settings:settings}, template, {preview:false});
  for (const output of [mail.html,mail.text]) {
    for (const hidden of ['HiddenName','HiddenNumber','HiddenHeadline','HiddenKicker','HiddenIntro','Oktober 2026']) assert.ok(!output.includes(hidden), hidden);
    assert.ok(output.includes('https://gerinjo.github.io/bsv-stadionheft-pages/'));
  }
});
test('newsletter settings validation rejects malformed fields and does not accept unrelated data', () => {
  const settings = newsletterDefaults(snapshot);
  for (const invalid of [null,[],{...settings,name:''},{...settings,number:'x'.repeat(31)},{...settings,showDate:'false'},{...settings,subject:'Subject\nBcc: test@example.org'},{...settings,intro:{html:'content'}}]) {
    assert.throws(() => normalizeNewsletterSettings(invalid));
  }
  const normalized = normalizeNewsletterSettings({...settings,name:'  Meine Post  ',stadiumLinks:[],html:'<script>'});
  assert.equal(normalized.name,'Meine Post');
  assert.ok(!('stadiumLinks' in normalized));
  assert.ok(!('html' in normalized));
  assert.equal(newsletterDefaults(snapshot).name,'NORDSTERN POST');
});

const publication = {issue_id:'10000000-0000-4000-8000-000000000001',issue_version:8,published_at:'2026-09-24T10:00:00Z',snapshot:{kind:'stadium',title:'Unser Stadionheft',articles:[
  {id:'one',title:'Erster Artikel',author:'Vorstand',status:'ready',body:'Gemeinsam gestalten wir den Verein. '.repeat(25)+'Nur im vollständigen Heft.'},
  {id:'two',title:'Zweiter Artikel',status:'ready',body:'Kurze Nachricht.'},
  {id:'draft',title:'Geheim',status:'draft',body:'Unveröffentlichter Entwurf'},
  {id:'empty',title:'Leer',status:'ready',body:'  '},
]}};
test('published magazine selection contains only available articles, in magazine order, as frozen excerpts',()=>{
  const source = newsletterSource(publication);
  assert.deepEqual(source.articles.map(a=>a.id),['one','two']);
  const selection = newsletterSelection(source,['two','one']);
  assert.deepEqual(selection.articles.map(a=>a.id),['one','two']);
  assert.ok(selection.articles[0].excerpt.length<=420);
  assert.ok(selection.articles[0].excerpt.endsWith('…'));
  assert.ok(!selection.articles[0].excerpt.includes('Nur im vollständigen Heft.'));
  source.articles[0].excerpt = 'Geändert';
  assert.notEqual(selection.articles[0].excerpt,source.articles[0].excerpt);
  assert.equal(newsletterSelection(source,[]),null);
  for(const invalid of [null,['draft'],['one','one'],[42],Array(31).fill('one')]) assert.throws(()=>newsletterSelection(source,invalid));
  for(const invalid of [null,{...publication,published_at:null},{...publication,issue_version:0},{...publication,snapshot:{kind:'newsletter'}}]) assert.throws(()=>newsletterSource(invalid));
});
test('teasers normalize whitespace and shorten at a sentence or word boundary within 420 characters',()=>{
  assert.equal(newsletterExcerpt('Hallo\n\nVerein!   Weiter.'),'Hallo Verein! Weiter.');
  assert.equal(newsletterExcerpt('x'.repeat(420)),'x'.repeat(420));
  assert.equal(newsletterExcerpt('x'.repeat(421)),'x'.repeat(419)+'…');
  const sentence='Wort '.repeat(45).trim()+'.';
  assert.equal(newsletterExcerpt(sentence+' Noch mehr Worte'.repeat(30)),sentence+'…');
  const result=newsletterExcerpt('Vereinsleben '.repeat(100));
  assert.ok(result.endsWith('Vereinsleben…'));
  assert.ok(result.length<=420);
});
test('a newsletter can export selected magazine teasers alone with pinned article links in HTML and text',()=>{
  const selection=newsletterSelection(newsletterSource(publication),['one']);
  const mail=renderEditorialNewsletter({...snapshot,articles:[],newsletter_selection:selection},template,{preview:false});
  const url=newsletterArticleUrl(selection,selection.articles[0]);
  assert.ok(url.endsWith('/stadionheft/'+publication.issue_id+'?version=8#artikel/one'));
  for(const output of [mail.html,mail.text]){
    assert.ok(output.includes('Erster Artikel'));
    assert.ok(output.includes(selection.articles[0].excerpt));
    assert.ok(output.includes(url));
    assert.ok(!output.includes('Zweiter Artikel'));
    assert.ok(!output.includes('Nur im vollständigen Heft.'));
  }
  assert.equal(mail.preheader,selection.articles[0].excerpt.slice(0,160));
  assert.match(mail.html,/data-newsletter-stadium-magazines/);
  assert.throws(()=>renderEditorialNewsletter({...snapshot,articles:[{title:'Offen',body:'Text',status:'draft'}],newsletter_selection:selection},template,{preview:false}),/freigeben/);
  selection.title='<script>bad()</script>';
  selection.articles[0].excerpt='<img src=x onerror=bad()>';
  assert.doesNotMatch(renderEditorialNewsletter({...snapshot,newsletter_selection:selection},template).html,/<script>|<img src=x/);
});

test('sendable newsletter links to the confirmation page with the personal Resend token; preview is harmless',()=>{
  const sent=renderEditorialNewsletter(snapshot,template,{preview:false});
  for(const output of [sent.html,sent.text])assert.ok(output.includes('/newsletter/abmelden#{{{RESEND_UNSUBSCRIBE_URL}}}'));
  assert.doesNotMatch(sent.html,/href="\{\{\{RESEND_UNSUBSCRIBE_URL/);
  const preview=renderEditorialNewsletter(snapshot,template);
  assert.match(preview.html,/newsletter\/abmelden\?vorschau=1/);
  assert.doesNotMatch(preview.html,/RESEND_UNSUBSCRIBE_URL|\{\{UNSUBSCRIBE_URL/);
});
