// In a sandboxed private preview, navigate without reloading the opaque blob URL.
let embeddedPath='';
function navigateEditorialReader(destination){
  if(location.protocol==='blob:'){embeddedPath=destination.replace(/^#/, '');route();window.dispatchEvent(new Event('editorialnavigate'));}
  else location.hash=destination;
}
document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(location.protocol==='blob:'&&link){event.preventDefault();navigateEditorialReader(link.getAttribute('href'));}});
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pad = number => String(number).padStart(2, '0');
const initialEdition = editions.find(edition => edition.current) || editions.find(edition => edition.historical) || editions[0];
const issueLink = (edition, page = 'cover') => `#ausgabe/${edition.id}/${page}`;
const imageDimensions = {
  'assets/saison-2627/herren-eins.jpeg': [1600, 915],
  'assets/saison-2627/herren-zwei.jpg': [1200, 750],
  'assets/saison-2627/frauen.jpg': [1600, 898],
  'assets/saison-2627/juniorinnen.jpg': [1600, 1063],
  'assets/saison-2627/sandra-fuchs.jpg': [667, 1000],
  'assets/saison-2627/jerome-ernsberger.jpg': [667, 1000],
  'assets/saison-2627/torsten-parzich.jpg': [1314, 1600],
  'assets/saison-2627/mathias-becht.jpg': [1067, 1600],
  'assets/saison-2627/myriam-lipp.jpg': [1067, 1600],
  "assets/mannschaft.jpg": [
    1500,
    858
  ],
  "assets/team-schwarz.jpg": [
    1500,
    903
  ],
  "assets/heft-06/herren-spiel.jpg": [
    423,
    282
  ],
  "assets/heft-06/herren-ball.jpg": [
    421,
    276
  ],
  "assets/heft-06/pokal-flutlicht.jpg": [
    369,
    302
  ],
  "assets/heft-06/pokal-team.jpg": [
    365,
    262
  ],
  "assets/heft-06/pokal-platz.jpg": [
    365,
    332
  ],
  "assets/heft-06/frauen-sauldorf.jpg": [
    392,
    323
  ],
  "assets/heft-06/frauen-team.jpg": [
    751,
    396
  ],
  "assets/heft-06/sparkasse.jpg": [
    637,
    900
  ],
  "assets/heft-06/original-cover.jpg": [
    500,
    707
  ]
};
const imageSize = src => imageDimensions[src] ? `width="${imageDimensions[src][0]}" height="${imageDimensions[src][1]}"` : "";
let activeEdition = initialEdition;
let pageLinks = { previous: null, next: null };

function articlesFor(edition) {
  return edition.pages || edition.articles || [];
}

function renderCover(edition, articles) {
  const settings = edition.coverSettings;
  $('#cover').classList.toggle('editorial-cover', Boolean(edition.editorialCover));
  for (const [id,key] of [['cover-name-part1','namePart1'],['cover-name-part2','namePart2']]) {
    const node = $('#'+id);
    node.textContent = settings?.[key] ?? (key === 'namePart1' ? 'NORDSTERN' : 'news.');
    node.hidden = settings?.[key === 'namePart1' ? 'showNamePart1' : 'showNamePart2'] === false;
    node.style.fontSize = settings ? `${Math.min(key === 'namePart1' ? 9.6 : 16.3, 100 / Math.max(key === 'namePart1' ? 8 : 5,node.textContent.length))}cqw` : '';
  }
  $('.cover-edition').hidden = settings?.showNumber === false;
  $('.cover-edition small').textContent = settings ? 'AUSGABE' : 'HEFT VOM';
  $('.cover-headline').hidden = settings?.showHeadline === false;
  $('#cover-date').hidden = settings?.showDate === false;
  $('#cover-kicker').hidden = Boolean(settings);
  $('#cover').style.setProperty('--cover-title-size', `${edition.headline[0].length > 90 ? 5 : edition.headline[0].length > 50 ? 6 : edition.headline[0].length > 30 ? 8 : 10}cqw`);
  $('#cover-season').textContent = `SAISON ${edition.season}`;
  $('#cover-date').textContent = edition.matchday ? `${edition.matchday.date.split('-').reverse().join('.')} · ${edition.matchday.time} UHR` : edition.date;
  $('#cover-matchday').textContent = edition.matchday ? `${edition.matchday.round}. SPIELTAG${edition.matchday.homeOpener ? ' · HEIMAUFTAKT' : ''}` : edition.editorialCover ? 'STADIONHEFT' : 'HEIMSPIELTAG';
  $('#cover-number').textContent = edition.number;
  $('#cover-photo').hidden = !edition.photo;
  $('#cover').classList.toggle('graphic-cover', !edition.photo);
  if (edition.photo) {
    $('#cover-photo').src = edition.photo;
    $('#cover-photo').alt = edition.photoAlt;
  }
  $('#cover-kicker').textContent = edition.historical ? 'DER LETZTE GEMEINSAME HEIMSPIELTAG VOR DER WINTERPAUSE' : edition.focus.toUpperCase();
  $('#cover-title').innerHTML = edition.historical ? 'Herz. Kampf.<br><em>Heimspiel.</em>' : `${esc(edition.headline[0])}<br><em>${esc(edition.headline[1])}</em>`;
  const teaserIds = edition.teaserIds || [];
  $('#cover-stories').innerHTML = teaserIds.map(id => {
    const index=articles.findIndex(page=>page.id===id || page.articleIds?.includes(id));
    const article=edition.articles.find(article=>article.id===id);
    return index<0 || !article ? '' : `<a href="${issueLink(edition,'artikel/'+id)}"><span>${esc(article.category)}</span><strong>${esc(edition.teaserAliases?.[id] || article.title)}</strong><small>S. ${pad(index+2)}</small></a>`;
  }).join('');
  $('#cover-matches').innerHTML = edition.matches ? edition.matches.map(match => `<div><span>${esc(match.team)} <b>${esc(match.time)}</b></span><strong>BSV Nordstern <i>–</i> ${esc(match.opponent)}</strong></div>`).join('') : `<div><span>HEIMSPIEL <b>${edition.number}</b></span><strong>BSV Nordstern <i>–</i> ${esc(edition.opponent)}</strong></div><small>Beispielbegegnung · Termin und Spielort folgen</small>`;
  if (edition.demo) {
    const teams = articles.flatMap(article => article.blocks || []).find(block => block.type === 'match-previews')?.teams || [];
    const homeGames = teams.flatMap(team => team.matches.filter(match => match.homeId === team.teamId).map(match => ({ ...match, label: team.label }))).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)).slice(0, 2);
    $('#cover-matches').innerHTML = homeGames.map(match => `<div><span>${shortDate(match.date)} <b>${esc(match.time)}</b></span><strong>${esc(match.label)} · ${/Pokal/i.test(match.competition) ? 'Pokalheimspiel' : 'Heimspiel'} gegen ${esc(match.away)}</strong></div>`).join('');
  }
  if (edition.editorialCover) {
    $('#cover-matches').classList.add('editorial-cover-matches');
    $('#cover-matches').hidden = Boolean(settings && !edition.coverMatches.length);
    $('#cover-matches').innerHTML = `<h2>Die nächsten Spiele der Aktiven</h2><div class="cover-fixtures">${edition.coverMatches.length ? edition.coverMatches.map(match => {
      const content = `<span class="cover-fixture-team">${esc(match.team)}</span>${match.state === 'scheduled'
        ? `<span class="cover-fixture-date">${esc(new Date(match.date + 'T12:00:00Z').toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit'}))} · ${esc(match.time || 'Uhrzeit offen')}${match.time ? ' Uhr' : ''}</span><strong>${esc(match.home)} <i>–</i> ${esc(match.away)}</strong>`
        : `<strong>${match.state === 'pending' ? 'Spielplan noch nicht geladen' : 'Kein nächster Termin im gespeicherten Spielplan'}</strong>`}`;
      return match.articleId ? `<a class="cover-fixture" href="${issueLink(edition, 'artikel/' + match.articleId)}">${content}</a>` : `<div class="cover-fixture">${content}</div>`;
    }).join('') : '<p class="cover-fixtures-empty">Sportdaten aktualisieren, um die nächsten Spiele der Aktiven zu übernehmen.</p>'}</div>`;
  }
  $('#cover-stories').hidden = !$('#cover-stories').children.length;
}

function renderContents(edition, articles) {
  $('#contents-photo').innerHTML = edition.photo ? `<img src="${esc(edition.photo)}" alt="${esc(edition.photoAlt)}"><figcaption>${esc(edition.photoCaption || (edition.historical ? 'Aus dem Originalheft vom 8. November 2025.' : 'BSV-Herren · Mannschaftsfoto 2025/26.'))}</figcaption>` : '<div class="contents-star" aria-hidden="true">✦</div>';
  $('#contents-intro').textContent = edition.historical ? 'Ein Pokalabend, der in Erinnerung bleibt. Zwei Mannschaften vor der Winterpause. Und die Menschen, die diesen Verein ausmachen. Sieben Geschichten aus dem Nordstern.' : edition.subtitle;
  $('#contents-list').innerHTML = articles.flatMap((page,index) => page.advertising ? [] : (page.segments || [page]).filter(section=>!section.continuation).map(section=>`<a class="contents-row" href="${issueLink(edition, 'artikel/' + (section.articleId || section.id))}"><div><span>${esc(section.category)}</span><strong>${esc(section.title)}</strong></div><b>${pad(index+2)}</b></a>`)).join('');
  if (edition.magazineAds?.length) $('#contents-list').insertAdjacentHTML('beforeend', `<details class="advertising-contents"><summary>Unsere Werbepartner · ${edition.magazineAds.length} Anzeigen</summary>${articles.map((article, index) => article.adSlots?.length ? `<a class="contents-row" href="${issueLink(edition, `artikel/${article.id}`)}"><div><span>Anzeige</span><strong>${esc(article.adSlots.map(slot => slot.ad.name).join(' · '))}</strong></div><b>${pad(index + 2)}</b></a>` : '').join('')}</details>`);
  $('#contents-original').hidden = !edition.source;
  if (edition.source) $('#contents-original').href = edition.source.url;
  $('#edition-note').textContent = edition.historical ? 'Ausgabe 06 · 8. November 2025. Eine redaktionelle Auswahl aus dem gedruckten Heft, neu gesetzt für den Bildschirm. Die Seitenzahlen beziehen sich auf diese digitale Ausgabe.' : `Beispielheft ${edition.number} / ${edition.season}. Texte und Begegnungen sind redaktionelle Skizzen und Platzhalter.`;
  if (edition.note) $('#edition-note').textContent = edition.note;
}

function renderArticle(edition, articles, index) {
  const article = articles[index];
  $('#article').dataset.article = article.id;
  $('#article').classList.toggle('team-photo-article', Boolean(article.teamPhotoPage));
  $('#article').classList.toggle('season-article', Boolean(edition.demo));
  $('#article').classList.toggle('advertising-article', Boolean(article.advertising));
  $('#article').classList.toggle('paged-article', Boolean(article.paged));
  $('#article').classList.toggle('editorial-paged', Boolean(article.editorialPaged));
  $('#article').classList.toggle('senior-sports-article', Boolean(article.blocks?.some(block=>block.type==='senior-sports-grid')));
  $('#article').classList.toggle('sports-compact-article', Boolean(article.blocks?.some(block => block.type === 'sports-overview' && block.compact)));
  $('#article').classList.toggle('youth-sports-article', Boolean(article.blocks?.some(block => block.type === 'youth-sports-grid')));
  $('#article-category').textContent = article.category;
  $('#article-title').textContent = article.title;
  $('#article-lead').textContent = article.lead;
  $('#article-meta').textContent = [article.author, edition.date || `Ausgabe ${edition.number} / ${edition.season}`, article.reading].filter(Boolean).join(' · ');
  $('#article-folio-category').textContent = article.category;
  $('#article-folio').textContent = pad(index + 2);
  let blocks = article.blocks;
  if (!blocks) {
    blocks = [{ type: 'paragraph', text: article.body }];
    if (article.photo) blocks.push({ type: 'figure', src: article.photo, alt: article.photoAlt, caption: 'BSV-Herren · Saison 2025/26.' });
  }
  // Kleine Textabschnitte und ihre Überschriften bleiben innerhalb einer Spalte zusammen.
  $('#article-body').innerHTML = article.paged ? `${article.advertising ? '' : sheetEditorialMarkup(article, edition)}${article.adSlots?.length ? adPageMarkup({ pagePoints: [595.276, 841.89], slots: article.adSlots }) : ''}` : articleBlocksMarkup(blocks, edition);
  const sponsorSlots = (editionSponsorships[edition.id] || []).filter(slot => slot.articleId === article.id);
  $('#article-body').insertAdjacentHTML('beforeend', sponsorSlots.map(slot => sponsorMarkup(slot, edition)).join(''));
  $('#article-source').innerHTML = edition.source ? `Quelle: <a href="${edition.source.url}#page=${article.sourcePage}" target="_blank" rel="noopener">Nordstern News 06 / 2025–26 · ${article.printedPage === 'Titelseite' || article.printedPage === 'Umschlag innen' ? esc(article.printedPage) : `Originalseite ${esc(article.printedPage)}`} ↗</a>. Redaktionelle Auswahl, teils gekürzt und sprachlich geglättet. Historischer Stand vom ${edition.date}.` : `Beispielinhalt für Ausgabe ${edition.number}. Der fertige Beitrag wird für dieses Heimspiel ergänzt.`;
  if (article.sources) $('#article-source').innerHTML = `Quellen · Stand ${esc(longDate(edition.asOf))}: ${article.sources.map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.label)} ↗</a>`).join(' · ')}. ${article.blocks.some(block => block.type === 'letter') ? 'Grußwort und Saisonziele: KI-generierter Textentwurf, nicht von der genannten Person verfasst oder freigegeben.' : 'Für diese Demo redaktionell zusammengestellt.'}`;
}

function sourcesMarkup(sources, asOf, hasLetter) {
  return `Quellen · Stand ${esc(longDate(asOf))}: ${sources.map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.label)} ↗</a>`).join(' · ')}. ${hasLetter ? 'Grußwort und Saisonziele: KI-generierter Textentwurf, nicht von der genannten Person verfasst oder freigegeben.' : 'Für diese Demo redaktionell zusammengestellt.'}`;
}

function sheetEditorialMarkup(page, edition) {
  if (page.teamPhotoPage) return `<div class="sheet-editorial team-photo-sheet">${articleBlocksMarkup(page.blocks, edition)}</div>`;
  const sections = page.segments || [page];
  return `<div class="sheet-editorial"><div class="running-head"><span>NORDSTERN NEWS</span><span>${esc(edition.number)} / ${esc(edition.season)} · ${pad(page.folio || 0)}</span></div>${sections.map((section,index) => {
    const heading = section.continuation ? `<p class="section-continuation">${esc(section.title)} · Fortsetzung</p>` : `<header class="article-heading ${index ? 'shared-section-heading' : ''}"><p class="eyebrow">${esc(section.category)}</p><h1>${esc(section.title)}</h1>${section.lead ? `<p class="article-lead">${esc(section.lead)}</p>` : ''}<p class="article-meta">${esc([section.author, edition.date].filter(Boolean).join(' · '))}</p></header>`;
    return `<section class="editorial-section" data-section-id="${esc(section.articleId || section.id)}">${heading}<div class="article-columns">${articleBlocksMarkup(section.blocks, edition)}</div></section>`;
  }).join('')}</div>`;
}

// Portraits share a flow container with their text; other wide blocks remain
// outside prose columns so images and advertisements keep their own space.
function articleBlocksMarkup(blocks, edition) {
  const output = [];
  let prose = [];
  let hasPortraits = false;
  const flush = () => {
    if (prose.length) output.push(`<div class="prose-columns${hasPortraits ? ' portrait-prose' : ''}">${prose.join('')}</div>`);
    prose = [];
    hasPortraits = false;
  };
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'person-portraits') {
      flush();
      hasPortraits = true;
      prose.push(blockMarkup(block, edition));
      continue;
    }
    const wide = block.wide || ['letter', 'sports', 'match-previews', 'youth-schedule', 'events', 'ad-page'].includes(block.type);
    if (wide) { flush(); output.push(blockMarkup(block, edition)); }
    else if (block.type === 'heading' && blocks[i + 1]?.type === 'paragraph') {
      prose.push(`<div class="text-section">${blockMarkup(block, edition)}${blockMarkup(blocks[++i], edition)}</div>`);
    } else prose.push(blockMarkup(block, edition));
  }
  flush();
  return output.join('');
}

function sportsTeamPhotoMarkup(photo) {
  return photo ? `<figure class="sports-team-photo"><img src="${esc(photo.src)}" ${imageSize(photo.src)} alt="${esc(photo.alt)}" loading="lazy"></figure>` : '';
}
function editorialOwnTeam(text) {
  const normalize = name => name.toLocaleLowerCase('de-DE').replace(/\s*\((?:\d+er|flex)\)\s*/g, ' ').replace(/\s+zg\.?$/, '').replace(/\s+/g, ' ').trim();
  const sections = text.split(/\n\s*\n/);
  const table = sections.find(section => section.startsWith('TABELLE'));
  const names = (table || '').split('\n').filter(line => line.includes('|')).slice(1).map(line => line.split('|')[1].trim());
  const fixtures = sections.filter(section => /^(LETZTE PARTIE|NÄCHSTE SPIELE)/.test(section)).flatMap(section => section.split('\n').filter(line => line.includes('|')).slice(1).map(line => (line.split('|')[2] || '').split(' – ').map(normalize))).filter(pair => pair.length === 2 && pair.every(Boolean));
  // Every fixture belongs to this team. Their common participant also resolves
  // abbreviated SG names, which need not resemble the editorial team label.
  const common = fixtures.length > 1 ? [...new Set(fixtures[0])].filter(name => fixtures.every(pair => pair.includes(name))) : [];
  if (common.length === 1) {
    const matches = names.filter(name => normalize(name) === common[0]);
    if (matches.length === 1) return matches[0];
  }
  const heading = text.split('\n')[0].replace(/^SPORT KOMPAKT · /, '');
  const base = heading.split(' · ')[0];
  const reserve = heading.match(/\b[A-D]([1-9])[- ](?:Junior|Jugend)/i)?.[1];
  const expected = normalize(base + (reserve && reserve !== '1' ? ` ${reserve}` : ''));
  const matches = names.filter(name => normalize(name).replace(/^sg\s+/, '') === expected.replace(/^sg\s+/, ''));
  return matches.length === 1 ? matches[0] : null;
}
function editorialSportsMarkup(block) {
  const ownTeam = block.ownTeam || editorialOwnTeam(block.text);
  return `<div class="editorial-sports ${block.compact ? 'sports-compact' : ''}">${block.text.split(/\n\s*\n/).map(section => {
    const lines = section.split('\n');
    const firstRow = lines.findIndex(line => line.includes('|'));
    const photo = section.startsWith('TABELLE') ? sportsTeamPhotoMarkup(block.photo) : '';
    if (firstRow < 0) return /^(TABELLE|LETZTE PARTIE|NÄCHSTE SPIELE)/.test(lines[0]) ? `${photo}<section class="sports-section"><h3>${esc(lines[0])}</h3><p>${esc(lines.slice(1).join('\n')).replaceAll('\n','<br>')}</p></section>` : `<section class="sports-note"><p>${esc(section).replaceAll('\n', '<br>')}</p></section>`;
    const heading = lines.slice(0, firstRow);
    const rows = lines.slice(firstRow).map(line => line.split('|').map(cell => cell.trim()));
    const shortHeaders = { Platz: 'Pl.', Spiele: 'Sp.', Punkte: 'Pkt.', Uhrzeit: 'Zeit', Ergebnis: 'Erg.' };
    const columns = rows[0].map(cell => block.compact ? shortHeaders[cell] || cell : cell);
    return `${photo}<section class="sports-section ${heading[0]?.startsWith('TABELLE') ? 'sports-table' : ''}"><h3>${esc(heading[0] || '')}</h3>${heading.slice(1).map(line => `<p>${esc(line)}</p>`).join('')}<table><thead><tr>${columns.map(cell => `<th scope="col">${esc(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row => `<tr${heading[0]?.startsWith('TABELLE') && row[1] === ownTeam ? ' class="our-team"' : ''}>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
  }).join('')}</div>`;
}

function pairedSportsMarkup(block, compact) {
  const prefix = compact ? 'youth' : 'senior';
  const hasPhotos = block.teams.some(team => team.photo);
  return `<div class="${prefix}-sports-grid aligned-sports-grid${hasPhotos ? ' with-team-photos' : ''}">${block.teams.map(team => {
    const ownTeam = editorialOwnTeam(team.text);
    const sections = team.text.split(/\n\s*\n/), parts = ['', '', '', '', ''];
    for (const section of sections) {
      const slot = section.startsWith('TABELLE') ? 1 : section.startsWith('LETZTE PARTIE') ? 2 : section.startsWith('NÄCHSTE SPIELE') ? 3 : /^(HINWEISE|QUELLENSTAND)/.test(section) ? 4 : 0;
      parts[slot] += (parts[slot] ? '\n\n' : '') + section;
    }
    if(compact) parts[0]='';
    return `<section class="${prefix}-sports-card"><h2>${esc(team.title)}</h2>${parts.map((text,index)=>`${index === 1 && hasPhotos ? `<div class="sports-photo-row">${sportsTeamPhotoMarkup(team.photo)}</div>` : ''}<div class="sports-part" data-sports-part="${index}">${text ? editorialSportsMarkup({text,compact,ownTeam}) : ''}</div>`).join('')}</section>`;
  }).join('')}</div>`;
}

function sponsorMarkup(slot, edition) {
  const sponsor = slot.sponsor;
  const asOf = slot.asOf.split('-').reverse().join('.');
  return `<aside class="youth-sponsor" aria-label="Anzeige: ${esc(sponsor.name)}" data-sponsor-id="${esc(sponsor.id)}">
    <div class="sponsor-disclosure"><span>ANZEIGE${slot.status === 'preview' ? ' · GESTALTUNGSBEISPIEL' : ''}</span><span>JUNGE STERNE</span></div>
    <p class="sponsor-thanks">An der Seite<br><em>unserer Jugend.</em></p>
    ${sponsorImageMarkup({ name: sponsor.name, url: sponsor.url, src: sponsor.logo, width: sponsor.width, height: sponsor.height, alt: sponsor.logoAlt, className: 'sponsor-logo-link', loading: 'lazy' })}
    <a class="sponsor-name" href="${esc(sponsor.url)}" target="_blank" rel="noopener sponsored">${esc(sponsor.name)} <span aria-hidden="true">↗</span></a>
    <small>Jugendpartner laut <a href="${esc(slot.sourceUrl)}" target="_blank" rel="noopener">BSV-Homepage</a> · Stand ${asOf}.${slot.status === 'preview' ? `<br>${edition.historical ? 'Neu ergänzt für diese Vorschau; keine Anzeige aus dem Originalheft 2025.' : 'Gestaltungsbeispiel; keine bestätigte Anzeigenbuchung.'}` : ''}</small>
  </aside>`;
}

function renderArchive() {
  const season = $('#season-filter').value;
  $('#archive-grid').innerHTML = editions.filter(edition => season === 'all' || edition.season === season).map(edition => `<a class="archive-card" href="${issueLink(edition)}" aria-label="Ausgabe ${edition.number} / ${edition.season} öffnen">
    <div class="mini-cover ${edition.photo ? '' : 'graphic-cover'}"><div class="mini-masthead">NORDSTERN<strong>news.</strong></div><span class="mini-number">${edition.number}</span>${edition.photo ? `<img src="${esc(edition.photo)}" alt="" loading="lazy">` : '<span class="mini-star" aria-hidden="true">✦</span>'}<div class="mini-copy">${esc(edition.headline[0])}<br><em>${esc(edition.headline[1])}</em></div><div class="mini-foot">SAISON ${edition.season}</div></div>
    <div class="archive-meta"><span>HEFT ${edition.number} / ${edition.season}</span><span>${edition.historical ? 'ARCHIV' : edition.current ? 'AKTUELLE DEMO' : 'BEISPIEL'}</span></div><h2>${esc(edition.focus)}</h2><p>${edition.date || 'Termin folgt · Beispielheft'}</p></a>`).join('');
}

function setPagination(edition, articles, page) {
  const pages = ['cover', 'inhalt', ...articles.map(article => `artikel/${article.id}`)];
  const position = pages.indexOf(page);
  pageLinks = { previous: position > 0 ? issueLink(edition, pages[position - 1]) : null, next: position < pages.length - 1 ? issueLink(edition, pages[position + 1]) : '#archiv' };
  const prev = $('#page-prev');
  if (pageLinks.previous) { prev.href = pageLinks.previous; prev.removeAttribute('aria-disabled'); prev.removeAttribute('tabindex'); }
  else { prev.removeAttribute('href'); prev.setAttribute('aria-disabled', 'true'); prev.tabIndex = -1; }
  $('#page-next').href = pageLinks.next;
  $('#page-next').innerHTML = `${position === 0 ? 'Heft öffnen' : position === pages.length - 1 ? 'Zum Archiv' : 'Weiterblättern'} <span aria-hidden="true">→</span>`;
  $('#page-status').textContent = position === 0 ? `TITEL · HEFT ${edition.number}` : `SEITE ${pad(position)} / ${pad(pages.length - 1)}`;
  $('#cover-link').href = issueLink(edition);
  $('#contents-link').href = issueLink(edition, 'inhalt');
  for (const [selector, active] of [['#cover-link', page === 'cover'], ['#contents-link', page === 'inhalt']]) {
    if (active) $(selector).setAttribute('aria-current', 'page'); else $(selector).removeAttribute('aria-current');
  }
}

function route() {
  if ($('#sponsor-dialog').open) $('#sponsor-dialog').close();
  let path = embeddedPath || location.hash.slice(1);
  if (path.startsWith('ausgabe/2026-27/00/')) {
    path = path.replace('ausgabe/2026-27/00/', 'ausgabe/2026-27/01/');
    try { history.replaceState(null, '', `${location.pathname}${location.search}#${path}`); } catch {}
  }
  if (!path || path === 'cover' || path === 'inhalt' || path.startsWith('artikel/')) {
    path = `ausgabe/${activeEdition.id}/${path || 'cover'}`;
    try { history.replaceState(null, '', `${location.pathname}${location.search}#${path}`); } catch {}
  }
  const archive = path === 'archiv';
  const match = path.match(/^ausgabe\/((?:\d{4}-\d{2}\/\d{2})|(?:redaktion\/[a-z0-9-]+))\/(cover|inhalt|artikel\/[a-z0-9-]+)$/);
  const edition = match && editions.find(item => item.id === match[1]);
  const page = match ? match[2] : '';
  const articles = edition ? articlesFor(edition) : [];
  const articleIndex = page.startsWith('artikel/') ? articles.findIndex(article => article.id === page.slice(8) || article.articleIds?.includes(page.slice(8))) : -1;
  const missing = !archive && (!edition || (page.startsWith('artikel/') && articleIndex < 0));
  const visible = !archive && !missing;
  $('#cover').hidden = !visible || page !== 'cover';
  $('#contents').hidden = !visible || page !== 'inhalt';
  $('#article').hidden = !visible || articleIndex < 0;
  $('#archive').hidden = !archive;
  $('#not-found').hidden = !missing;
  $('#reader-pagination').hidden = !visible;
  $('#reader-context').hidden = !visible;
  $('#source-link').hidden = !visible || !edition.source;
  if (archive) $('#archive-link').setAttribute('aria-current', 'page'); else $('#archive-link').removeAttribute('aria-current');
  document.body.dataset.view = archive ? 'archive' : page === 'cover' ? 'cover' : 'inside';
  if (visible) {
    activeEdition = edition;
    $('#edition-select').value = edition.id;
    $('#home-link').href = issueLink(edition);
    $('#reader-context').textContent = edition.historical ? `AUS DEM VEREINSARCHIV · ${edition.date.toUpperCase()} · NEU GESTALTET` : edition.demo ? `SAISONAUFTAKT ${edition.season} · DEMO · STAND ${edition.asOf.split('-').reverse().join('.')}` : `GESTALTUNGSBEISPIEL · HEFT ${edition.number} / ${edition.season}`;
    document.querySelectorAll('.issue-reference').forEach(node => { node.textContent = `AUSGABE ${edition.number} / ${edition.season}`; });
    if (page === 'cover') renderCover(edition, articles);
    if (page === 'inhalt') renderContents(edition, articles);
    if (articleIndex >= 0) renderArticle(edition, articles, articleIndex);
    setPagination(edition, articles, articleIndex >= 0 ? 'artikel/' + articles[articleIndex].id : page);
    if (edition.source) $('#source-link').href = edition.source.url;
    $('#reader-footnote').textContent = edition.historical ? 'Originalinhalte von 2025 · Digitale Neugestaltung' : edition.demo ? `Saisonheft-Demo · KI-Grußworte zur Freigabe · Spieldaten vom ${edition.asOf.split('-').reverse().join('.')}` : 'Beispielausgabe · Texte und Spieldaten sind Platzhalter';
    document.title = `${articleIndex >= 0 ? articles[articleIndex].category : page === 'inhalt' ? 'Inhalt' : 'Titelseite'} · Heft ${edition.number} — Nordstern News`;
  } else {
    pageLinks = { previous: null, next: null };
    $('#home-link').href = issueLink(activeEdition);
    $('#reader-footnote').textContent = 'BSV Nordstern Radolfzell · Seit 1956';
    document.title = archive ? 'Heftarchiv — Nordstern News' : 'Seite nicht gefunden — Nordstern News';
  }
  window.scrollTo(0, 0);
  const focusTarget = archive ? $('#archive-title') : page === 'cover' ? (activeEdition?.coverSettings?.showHeadline === false ? $('#cover') : $('#cover-title')) : page === 'inhalt' ? $('#contents-title') : articleIndex >= 0 ? $(articles[articleIndex].advertising || articles[articleIndex].paged ? '#article' : '#article-title') : $('#main');
  focusTarget.focus({ preventScroll: true });
}

function fixturesMarkup(edition) {
  return `<div class="article-fixtures">${edition.matches.map(match => `<div><span class="fixture-label">${esc(match.team)} · ${esc(match.league)}</span><strong class="fixture-time">${esc(match.time)} <small>UHR</small></strong><p><b>BSV Nordstern</b><br>gegen ${esc(match.opponent)}</p></div>`).join('')}</div>`;
}

function blockMarkup(block, edition) {
  switch (block.type) {
    case 'team-photo-spread': return `<figure class="team-photo-spread"><img src="${esc(block.photo.src)}" ${imageSize(block.photo.src)} alt="${esc(block.photo.alt)}"></figure>`;
    case 'person-portraits': return `<div class="editorial-person-portraits">${block.people.map(person => `<figure>${person.photo_url ? `<img src="${esc(person.photo_url)}" alt="${esc(person.name)}" width="120" height="145">` : ''}<figcaption><strong>${esc(person.name)}</strong>${esc(person.role)}</figcaption></figure>`).join('')}</div>`;
    case 'coach-grid': return `<div class="coach-grid">${block.teams.map(team => `<section><h2>${esc(team.title)}</h2>${team.author ? `<p class="coach-author">${esc(team.author)}</p>` : ''}${articleBlocksMarkup(team.blocks, edition)}</section>`).join('')}</div>`;
    case 'editorial-gallery-row': return `<div class="editorial-gallery-row">${block.galleries.map(group=>blockMarkup(group,edition)).join('')}</div>`;
    case 'editorial-gallery': { const cover=block.images.find(img=>img.id===block.coverId)||block.images[0];const label=`${block.title || 'Bildergalerie'} · ${block.images.length} Bilder ansehen`;return `<figure class="editorial-gallery"><button type="button" data-gallery-id="${esc(block.id)}" aria-label="${esc(label)}" title="${esc(label)}"><span class="editorial-gallery-cover"><img src="${esc(cover.src)}" alt="${esc(cover.alt)}" loading="lazy"><svg class="editorial-gallery-icon" viewBox="0 0 32 32" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 23H3V3h22v2M9 27H7V7h22v2"/><rect x="11" y="11" width="20" height="20" rx="1"/><circle cx="25" cy="17" r="2"/><path d="m12 27 6-7 5 5 3-3 4 5"/></svg></span></button></figure>`; }
    case 'senior-sports-grid': return pairedSportsMarkup(block, false);
    case 'sports-overview': return editorialSportsMarkup(block);
    case 'youth-sports-grid': return pairedSportsMarkup(block, true);
    case 'paragraph': return `<p>${esc(block.text)}</p>`;
    case 'heading': return `<h2>${esc(block.text)}</h2>`;
    case 'quote': return `<blockquote><p>${esc(block.text)}</p><cite>${esc(block.by)}</cite></blockquote>`;
    case 'figure': return `<figure class="editorial-photo${block.wide ? ' full-spread' : ''}"><img src="${block.src}" ${imageSize(block.src)} alt="${esc(block.alt)}" loading="lazy"><figcaption>${esc(block.caption)}</figcaption></figure>`;
    case 'advert': return `<figure class="original-ad"><span class="eyebrow">ANZEIGE · ORIGINAL VON 2025</span><img src="${block.src}" ${imageSize(block.src)} alt="${esc(block.alt)}" loading="lazy"><figcaption>${esc(block.caption)}</figcaption></figure>`;
    case 'gallery': return `<figure class="gallery"><div>${block.items.map(item => `<img src="${item.src}" ${imageSize(item.src)} alt="${esc(item.alt)}" loading="lazy">`).join('')}</div><figcaption>${esc(block.caption)}</figcaption></figure>`;
    case 'score': return `<div class="scoreboard"><p>${esc(block.detail)}</p><div><strong>${esc(block.home)}</strong><span>${esc(block.score)}</span><strong>${esc(block.away)}</strong></div></div>`;
    case 'timeline': return `<ol class="goal-timeline">${block.items.map(item => `<li><span class="goal-minute">${esc(item.minute)}</span><div><span class="goal-score">${esc(item.score)}</span><h3>${esc(item.name)}</h3><p>${esc(item.text)}</p></div></li>`).join('')}</ol>`;
    case 'stats': return `<div class="article-stats">${block.items.map(item => `<div><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`).join('')}</div>`;
    case 'fixtures': return fixturesMarkup(edition);
    case 'list': return `<ul class="editorial-list">${block.items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
    case 'letter': return letterMarkup(block);
    case 'sports': return sportsMarkup(block);
    case 'match-previews': return matchPreviewsMarkup(block, edition);
    case 'youth-schedule': return youthScheduleMarkup(block);
    case 'events': return eventsMarkup(block);
    case 'ad-page': return adPageMarkup(block);
    case 'article-sources': return `<div class="article-source">${sourcesMarkup(block.sources, block.asOf, block.hasLetter)}</div>`;
    case 'notice': return `<aside class="editorial-notice"><span class="eyebrow">${esc(block.kicker)}</span><h2>${esc(block.title)}</h2><p>${esc(block.text)}</p>${block.url ? externalLink(block.url, block.linkLabel) : ''}</aside>`;
    case 'original': return `<a class="original-link" href="${edition.source.url}" target="_blank" rel="noopener"><img src="assets/heft-06/original-cover.jpg" alt="Titelseite des gedruckten Originalhefts"><div><span class="eyebrow">DAS GEDRUCKTE HEFT</span><strong>Nordstern News<br>Ausgabe 6 / 2025–26</strong><span>24 Seiten · PDF · 4,3 MB ↗</span></div></a>`;
    default: return '';
  }
}

function shortDate(date) { return `${date.slice(8, 10)}.${date.slice(5, 7)}.`; }
function longDate(date) { return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)); }
function externalLink(url, label) { return `<a class="editorial-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`; }

function letterMarkup(block) {
  return `<section class="letter full-spread" aria-label="Grußwort-Entwurf für ${esc(block.name)}">
    <p class="draft-label">KI-GENERIERTER ENTWURF · NICHT FREIGEGEBEN</p>
    <div class="letter-layout"><aside class="letter-author">${block.image ? `<img src="${esc(block.image)}" ${imageSize(block.image)} alt="${esc(block.name)} · Porträt von der BSV-Homepage" loading="eager" decoding="async">` : `<span class="author-monogram" aria-hidden="true">${esc(block.name.split(' ').map(name => name[0]).join(''))}</span>`}<span class="eyebrow">TEXTVORSCHLAG FÜR</span><h2>${esc(block.name)}</h2><p>${esc(block.role)}</p>${block.image ? '<small>Porträt: BSV-Homepage</small>' : ''}</aside>
    <div class="letter-text">${block.paragraphs.map(text => `<p>${esc(text)}</p>`).join('')}<p class="letter-signature">${esc(block.signature)}</p><small class="letter-disclosure">Für diese Demo generiert. Kein Originalgrußwort und keine bestätigte Saisonzielsetzung.</small></div></div>
  </section>`;
}

function scheduleRows(team) {
  return `<ol class="schedule-list">${team.matches.map(match => `<li><time datetime="${match.date}T${match.time}"><b>${shortDate(match.date)}</b><span>${esc(match.time)} Uhr</span></time><div><span class="match-competition">${esc(match.competition)}</span><a href="${esc(match.url)}" target="_blank" rel="noopener"><strong>${esc(match.home)}</strong><span class="match-versus">–</span><strong>${esc(match.away)}</strong><span class="sr-only"> · Ansetzung auf FUSSBALL.DE öffnen</span></a></div></li>`).join('')}</ol>${team.notices.map(notice => `<p class="schedule-note">${shortDate(notice.date)} ${esc(notice.text)}</p>`).join('')}`;
}

function sportsMarkup(block) {
  const team = block.team;
  const unplayed = team.table.every(row => Number(row.matches) === 0);
  return `<section class="sports-sheet full-spread"><div class="sports-heading"><span class="eyebrow">${esc(team.label)} · ZAHLEN & TERMINE</span><span>Stand ${shortDate(block.asOf)}${block.asOf.slice(0, 4)}</span></div><div class="sports-grid"><section><h2>Die nächsten Spiele.</h2>${scheduleRows(team)}<p class="data-note">Auszug aus der veröffentlichten Spielvorschau. Kurzfristige Verlegungen sind möglich.</p>${externalLink(team.fullScheduleUrl, 'Vollständiger Spielplan')}</section><section><h2>Die Tabelle.</h2><div class="table-wrap"><table class="league-table"><caption>${esc(team.league)}${unplayed ? ' · Starttabelle, noch keine Ligaspiele' : ''}</caption><thead><tr><th scope="col">Pl.</th><th scope="col">Mannschaft</th><th scope="col"><abbr title="Spiele">Sp.</abbr></th><th scope="col">Tore</th><th scope="col"><abbr title="Punkte">Pkt.</abbr></th></tr></thead><tbody>${team.table.map(row => `<tr${row.teamPermanentId === team.teamId ? ' class="our-team"' : / zg\./.test(row.teamName) ? ' class="withdrawn-team"' : ''}><td>${esc(row.position)}</td><th scope="row">${esc(row.teamName)}</th><td>${esc(row.matches)}</td><td>${esc(row.goalRatio)}</td><td>${esc(row.points)}</td></tr>`).join('')}</tbody></table></div><p class="data-note">${unplayed ? 'Gleiche Platznummern entsprechen dem veröffentlichten Startstand. ' : ''}Sp. = Spiele · Pkt. = Punkte · zg. = zurückgezogen.</p>${externalLink(team.tableSource, 'Aktuelle Verbandstabelle')}</section></div></section>`;
}

function matchPreviewsMarkup(block, edition) {
  return `<div class="match-preview-grid full-spread">${block.teams.map(team => {
    const match = team.matches[0];
    if (!match) return '';
    const isHome = match.homeId === team.teamId;
    return `<section class="match-preview"><div class="match-preview-top"><span>${esc(team.label)}</span><span>${isHome ? 'HEIMSPIEL' : 'AUSWÄRTS'}</span></div><p class="match-preview-date">${shortDate(match.date)} <em>${esc(match.time)}</em><small>UHR</small></p><span class="match-competition">${esc(match.competition)}</span><h2>${esc(match.home)}<span>gegen</span>${esc(match.away)}</h2><a class="editorial-link" href="${issueLink(edition, `artikel/${team.articleId}`)}">Gegner, Trainer & Spielplan →</a></section>`;
  }).join('')}</div>`;
}

function youthScheduleMarkup(block) {
  return `<div class="youth-fixtures-grid full-spread">${block.teams.map(team => `<section class="youth-fixtures"><div class="youth-fixtures-heading"><h2>${esc(team.label)}</h2>${externalLink(team.url, 'Teamseite')}</div>${scheduleRows(team)}<p class="data-note">Quelle: Spielplan der Teamseite · ${shortDate(block.asOf)}${block.asOf.slice(0, 4)}</p></section>`).join('')}</div>`;
}

function eventsMarkup(block) {
  const lastDay = new Date(`${block.window.end}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const window = `${longDate(block.window.start)} bis ${longDate(lastDay.toISOString().slice(0, 10))}`;
  return `<section class="event-window full-spread"><div class="event-window-heading"><span class="eyebrow">${block.scope === 'supporters' ? 'TERMINE DES FÖRDERVEREINS' : 'VERANSTALTUNGSVORSCHAU'}</span><strong>Die nächsten <em>${block.period.months || 4}</em> ${block.period.months ? 'Monate' : 'Wochen'}.</strong><p>${window}</p></div><div class="event-window-body">${block.items.length ? block.items.map(event => `<article class="event-entry"><time datetime="${event.date}">${longDate(event.date)}</time><h2>${esc(event.title)}</h2><p class="event-details">${event.time ? `${esc(event.time)} Uhr` : 'Uhrzeit noch nicht veröffentlicht'}${event.location ? `<br>${esc(event.location)}` : ''}</p>${event.description ? `<p>${esc(event.description)}</p>` : '<p>Weitere Programmdetails sind noch nicht veröffentlicht.</p>'}${event.descriptionDraft ? '<small class="event-draft">Beschreibung: generierter redaktioneller Entwurf</small>' : ''}${externalLink(event.url, 'Veranstaltungskalender öffnen')}</article>`).join('') : `<h2>In diesem Zeitraum ist kein weiterer Termin eingetragen.</h2><p>${block.scope === 'supporters' ? 'Sobald Flohmarkt oder Rädermarkt mit einem neuen Datum in Meetings & Veranstaltungen stehen, werden sie im nächsten passenden Heft vorgestellt.' : 'Der Vereinskalender enthält für diese vier Wochen keine weiteren Veranstaltungen. Den Flohmarkt und den Ausblick auf den Rädermarkt findet ihr beim Förderverein mit einem Fenster von drei Monaten.'}</p>`}${externalLink(block.sourceUrl, block.scope === 'supporters' ? 'Meetings & Veranstaltungen' : 'Vereinskalender ansehen')}</div></section>`;
}

function sponsorWebsiteUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function sponsorImageMarkup({ name, url, src, width, height, alt, className = '', loading = 'eager' }) {
  const websiteUrl = sponsorWebsiteUrl(url);
  const image = `<img src="${esc(src)}" width="${width}" height="${height}" alt="${esc(alt)}" loading="${loading}" decoding="async">`;
  const classes = `sponsor-image ${className}`.trim();
  if (!websiteUrl) return `<div class="${classes}">${image}</div>`;
  return `<button type="button" class="${classes}" data-sponsor-url="${esc(websiteUrl)}" data-sponsor-name="${esc(name)}" aria-label="Anzeige von ${esc(name)} öffnen" aria-haspopup="dialog" aria-controls="sponsor-dialog">${image}</button>`;
}

function adPageMarkup(block) {
  const [width, height] = block.pagePoints;
  const top = Math.min(...block.slots.map(slot => slot.frame[1]));
  const bottom = Math.max(...block.slots.map(slot => slot.frame[3]));
  const band = bottom - top;
  return `<div class="advertising-canvas${block.slots.length === 1 ? ' advertising-canvas-single' : ''}" style="--page-ratio:${width}/${height};--band-ratio:${width}/${height * band}">${block.slots.map(({ ad, frame }) => `<figure class="advertising-slot" data-ad-id="${esc(ad.id)}" style="--ad-left:${frame[0] * 100}%;--ad-top:${frame[1] * 100}%;--ad-width:${(frame[2] - frame[0]) * 100}%;--ad-height:${(frame[3] - frame[1]) * 100}%;--band-top:${(frame[1] - top) / band * 100}%;--band-height:${(frame[3] - frame[1]) / band * 100}%">${sponsorImageMarkup({ name: ad.name, url: ad.websiteUrl, src: ad.asset, width: ad.width, height: ad.height, alt: `Anzeige: ${ad.name}` })}</figure>`).join('')}</div>`;
}

const sponsorDialog = $('#sponsor-dialog');
$('#article-body').addEventListener('click', event => {
  const trigger = event.target.closest('[data-sponsor-url]');
  if (!trigger) return;
  const url = sponsorWebsiteUrl(trigger.dataset.sponsorUrl);
  if (!url) return;
  const image = trigger.querySelector('img');
  $('#sponsor-dialog-title').textContent = trigger.dataset.sponsorName;
  $('#sponsor-dialog-image').src = image.src;
  $('#sponsor-dialog-image').alt = image.alt;
  $('#sponsor-dialog-link').href = url;
  sponsorDialog.showModal();
  document.body.classList.add('sponsor-dialog-open');
});
$('#sponsor-dialog-close').addEventListener('click', () => sponsorDialog.close());
sponsorDialog.addEventListener('click', event => {
  if (event.target !== sponsorDialog) return;
  const rect = sponsorDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) sponsorDialog.close();
});
sponsorDialog.addEventListener('close', () => {
  document.body.classList.remove('sponsor-dialog-open');
  $('#sponsor-dialog-link').removeAttribute('href');
});

const galleryDialog = document.createElement('dialog');
galleryDialog.className = 'editorial-gallery-dialog';
galleryDialog.setAttribute('aria-label', 'Bildergalerie');
galleryDialog.innerHTML = '<div class="gallery-toolbar"><strong id="gallery-title"></strong><button type="button" data-gallery-close aria-label="Galerie schließen">✕</button></div><img class="gallery-large" alt=""><p class="gallery-caption"></p><div class="gallery-toolbar"><button type="button" data-gallery-prev aria-label="Vorheriges Bild">←</button><span class="gallery-count" aria-live="polite"></span><button type="button" data-gallery-next aria-label="Nächstes Bild">→</button></div>';
document.body.append(galleryDialog);
let galleryState = null;
function showGalleryImage(index) {
  galleryState.index = (index + galleryState.group.images.length) % galleryState.group.images.length;
  const image=galleryState.group.images[galleryState.index];
  galleryDialog.querySelector('img').src=image.src;
  galleryDialog.querySelector('img').alt=image.alt;
  galleryDialog.querySelector('.gallery-caption').textContent=image.alt;
  galleryDialog.querySelector('.gallery-count').textContent=`${galleryState.index+1} / ${galleryState.group.images.length}`;
  galleryDialog.querySelectorAll('[data-gallery-prev],[data-gallery-next]').forEach(button=>button.disabled=galleryState.group.images.length<2);
}
document.addEventListener('click', event => {
  const trigger=event.target.closest('[data-gallery-id]');
  if(!trigger)return;
  const group=editions.flatMap(edition=>edition.articles || []).flatMap(article=>article.blocks || []).flatMap(block=>block.type==='editorial-gallery-row' ? block.galleries : [block]).find(block=>block.type==='editorial-gallery' && block.id===trigger.dataset.galleryId);
  if(!group)return;
  galleryState={group,index:0};
  galleryDialog.querySelector('#gallery-title').textContent=group.title || 'Bildergalerie';
  showGalleryImage(Math.max(0,group.images.findIndex(image=>image.id===group.coverId)));
  galleryDialog.showModal();
});
galleryDialog.querySelector('[data-gallery-close]').onclick=()=>galleryDialog.close();
galleryDialog.querySelector('[data-gallery-prev]').onclick=()=>showGalleryImage(galleryState.index-1);
galleryDialog.querySelector('[data-gallery-next]').onclick=()=>showGalleryImage(galleryState.index+1);
galleryDialog.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();showGalleryImage(galleryState.index+(event.key==='ArrowRight'?1:-1));
});

$('#edition-select').innerHTML = editions.map(edition => `<option value="${edition.id}">${edition.current ? `Heft ${edition.number} · Saisonauftakt` : `Heft ${edition.number}`} / ${edition.season} · ${edition.historical ? 'Archiv' : edition.demo ? 'Demo' : 'Beispiel'}</option>`).join('');
$('#edition-select').addEventListener('change', event => {
  const edition = editions.find(item => item.id === event.target.value);
  if (edition) navigateEditorialReader(issueLink(edition));
});
$('#season-filter').addEventListener('change', renderArchive);
window.addEventListener('hashchange', route);
window.addEventListener('keydown', event => {
  if (sponsorDialog.open || galleryDialog.open) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || /INPUT|SELECT|TEXTAREA|BUTTON|A/.test(event.target.tagName) || event.target.isContentEditable) return;
  const destination = event.key === 'ArrowRight' ? pageLinks.next : event.key === 'ArrowLeft' ? pageLinks.previous : null;
  if (destination) { event.preventDefault(); navigateEditorialReader(destination); }
});
renderArchive();
route();
