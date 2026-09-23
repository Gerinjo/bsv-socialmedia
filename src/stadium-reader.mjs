import { stadiumReaderAssets } from "./stadium-reader-assets.mjs";
export function renderEditorialMagazine(snapshot, preview = true) {
  snapshot = {...snapshot, articles: snapshot.articles.filter(article => article.status !== 'waived' && (article.kind !== 'coach' || article.status === 'ready' && article.body?.trim()))};
  const safeJson = (value) =>
    JSON.stringify(value)
      .replaceAll("<", "\\u003c")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
  const contacts = stadiumReaderAssets.contacts;
  const teamWebsite = slug => contacts.teams[slug] || null;
  const personWebsite = (name, slug) => {
    const groups = contacts.groups;
    const match = (slug ? groups.filter(group => group.teamSlug === slug) : groups).flatMap(group => group.people).find(person => person.name === name);
    return (match || groups.flatMap(group => group.people).find(person => person.name === name))?.websiteUrl || null;
  };
  const image = String(snapshot.cover_url || "");
  const validImage =
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) ||
    /^https:\/\//.test(image);
  const year = Number(snapshot.publishes_on.slice(0, 4)),
    seasonStart =
      Number(snapshot.publishes_on.slice(5, 7)) >= 7 ? year : year - 1;
  const labels = {
    board: "Vorstandschaft",
    youth: "Jugendleitung",
    coach: "Trainerteam",
    sports: "Tabelle & Spielplan",
    free: "Vereinsleben",
    event: "Veranstaltungen",
  };
  // Older issues may predate automatic youth approval. Their layout still
  // follows the team's age group, independently of the stored approval flag.
  const compactSports = article => article.kind === 'sports' && Boolean(
    String(article.body || '').startsWith('SPORT KOMPAKT · ') ||
    /\bu(?:19|18|17|16|15|14|13|12)\b|\b[a-d](?:[1-9])?[- ](?:jugend|junior)/i.test(`${article.team_slug || ''} ${article.title || ''}`)
  );
  const articles = snapshot.articles.map((article) => ({
    id: article.id,
    kind: article.kind,
    teamSlug: article.team_slug || null,
    websiteUrl: teamWebsite(article.team_slug),
    category: article.event
      ? [
          new Date(`${article.event.date}T12:00:00Z`).toLocaleDateString(
            "de-DE",
          ),
          article.event.time,
        ]
          .filter(Boolean)
          .join(" · ")
      : labels[article.kind] || "Vereinsleben",
    title: article.title,
    lead: article.event
      ? [article.event.date, article.event.time, article.event.location]
          .filter(Boolean)
          .join(" · ")
      : "",
    author: article.author || "",
    automaticSports: Boolean(article.automatic_sports),
    compactSports: compactSports(article),
    approved: article.status === "ready",
    hasContent: Boolean(article.body?.trim()),
    blocks: article.kind === 'sports' ? [{ type: 'sports-overview', wide: true, text: String(article.body || 'Noch keine Sportdaten abgerufen.'), compact: compactSports(article) }] : String(article.body || "Noch kein Beitrag eingegeben.")
      .split(/\n\s*\n/)
      .map((text) => ({ type: "paragraph", text })),
  }));
  for (let index = 0; index < articles.length; index++) {
    const photo = snapshot.articles[index].team_photo;
    const block = articles[index].blocks.find(block => block.type === 'sports-overview');
    if (block && photo && (/^https:\/\//.test(photo.photo_url || '') || snapshot.demo && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(photo.photo_url || ''))) block.photo = {src:photo.photo_url,alt:photo.alt || articles[index].title};
  }
  const articleTitle = index => articles[index].title;
  for (let index = 0; index < articles.length; index++) {
    const people = (snapshot.articles[index].people || []).map(person => ({ name: person.name, role: person.role, websiteUrl: personWebsite(person.name, articles[index].teamSlug),
      photo_url: /^https:\/\//.test(person.photo_url || '') || snapshot.demo && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(person.photo_url || '') ? person.photo_url : null }));
    const galleries = [];
    for (const group of snapshot.articles[index].galleries || []) {
      const images = group.images.map(img => ({ id: img.id, alt: img.alt || group.title || articleTitle(index), src: img.photo_url })).filter(img => /^https:\/\//.test(img.src || '') || snapshot.demo && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img.src || ''));
      if (images.length) galleries.push({ type: 'editorial-gallery', id: group.id, title: group.title, coverId: group.cover_id, images });
    }
    const galleryRow = groups => ({type:'editorial-gallery-row',wide:true,galleries:groups});
    if (galleries.length > 3) {
      const blocks = articles[index].blocks;
      // Keep the opening galleries inside the contribution, with the rest at
      // its end. A single long paragraph is split at a sentence/word boundary.
      if (blocks.length === 1 && blocks[0].type === 'paragraph') {
        const text = blocks[0].text, middle = Math.floor(text.length / 2);
        const boundary = text.indexOf(' ', middle);
        if (boundary > 0) blocks.splice(0,1,{type:'paragraph',text:text.slice(0,boundary)},{type:'paragraph',text:text.slice(boundary)});
      }
      blocks.splice(Math.max(1,Math.ceil(blocks.length / 2)),0,galleryRow(galleries.slice(0,3)));
      blocks.push(galleryRow(galleries.slice(3)));
    } else if (galleries.length) articles[index].blocks.push(galleryRow(galleries));
    if (people.length) articles[index].blocks.unshift({ type: 'person-portraits', wide: true, people });
  }
  const youth = articles.filter(article => article.compactSports && article.hasContent);
  const activeGroups = ['Herren', 'Frauen'].map(group => {
    const pair = ['I', 'II'].map(number => {
      const match = snapshot.coverMatches?.find(match => match.team === `${group} ${number}`);
      return articles.find(article => article.id === match?.articleId);
    });
    if (!pair.some(article => article?.hasContent)) return null;
    const first = pair.find(Boolean);
    return { id: first.id, articleIds: pair.filter(Boolean).map(article => article.id), category: 'Aktive · Tabellen & Ergebnisse', title: `${group} · 1. und 2. Mannschaft`, lead: '', fullPage: true,
      approved: pair.filter(Boolean).every(article => article.approved),
      blocks: [{type:'senior-sports-grid',wide:true,teams:pair.map((article,index)=>({title:`${index+1}. Mannschaft`,websiteUrl:teamWebsite(`${group.toLowerCase()}-${index+1}`),photo:article?.blocks.find(block=>block.type==='sports-overview')?.photo,text:article?.blocks.find(block=>block.type==='sports-overview')?.text || 'Noch keine Sportdaten abgerufen.',compact:false}))}] };
  }).filter(Boolean);
  const coachGroups = ['herren', 'frauen'].map(group => {
    const pair = [1, 2].map(number => articles.find(article => article.kind === 'coach' && article.teamSlug === `${group}-${number}` && article.hasContent));
    if (!pair.some(Boolean)) return null;
    return { id: pair.find(Boolean).id, articleIds: pair.filter(Boolean).map(article => article.id), keepTogether: true,
      category: 'Aktive · Trainerteam', title: `Grußworte · ${group === 'herren' ? 'Herren' : 'Frauen'}`, lead: '',
      approved: pair.filter(Boolean).every(article => article.approved),
      blocks: [{type:'coach-grid',wide:true,teams:pair.flatMap((article,index)=>article ? [{title:`${index+1}. Mannschaft`,websiteUrl:article.websiteUrl,author:article.author || '',blocks:article.blocks}] : [])}] };
  }).filter(Boolean);
  const groupedIds = new Set([...activeGroups, ...coachGroups].flatMap(group => group.articleIds));
  const editorialPages = [];
  const remaining = articles.filter(article => article.hasContent && !article.compactSports && !groupedIds.has(article.id));
  editorialPages.push(...remaining.filter(article => article.kind === 'board'));
  for (let index = 0; index < 2; index++) {
    const group = index === 0 ? 'Herren' : 'Frauen';
    const sports = activeGroups.find(page => page.title.startsWith(group));
    const photo = sports?.blocks[0].teams[0].photo;
    if (photo) editorialPages.push({id:`team-photo-${group.toLowerCase()}`,title:`${group} · 1. Mannschaft`,category:'Mannschaftsbild',lead:'',fullPage:true,teamPhotoPage:true,keepWithNext:true,approved:sports.approved,blocks:[{type:'team-photo-spread',wide:true,photo}]});
    editorialPages.push(...coachGroups.filter(page => page.title.endsWith(group)), ...activeGroups.filter(page => page.title.startsWith(group)));
  }
  editorialPages.push(...remaining.filter(article => !['board', 'free', 'event', 'youth'].includes(article.kind) && !/^(?:u(?:1[2-9])|[a-d][-123])/.test(article.teamSlug || '')));
  editorialPages.push(...remaining.filter(article => ['free', 'event'].includes(article.kind)).map(article => ({...article, sectionKey:'free'})));
  editorialPages.push(...remaining.filter(article => article.kind === 'youth' || article.kind === 'coach' && /^(?:u(?:1[2-9])|[a-d][-123])/.test(article.teamSlug || '')).map(article => ({...article, sectionKey:'youth'})));
  for (let index = 0; index < youth.length; index += 2) {
    const pair = youth.slice(index, index + 2);
    const shortTitle = article => article.title.replace(/^Sport(?: kompakt)?\s*·\s*/i, '').replace(/^BSV Nordstern Radolfzell\s*·\s*/i, '');
    editorialPages.push({ id: pair[0].id, articleIds: pair.map(article => article.id), category: 'Jugend · Tabellen & Ergebnisse',
      title: pair.map(shortTitle).join(' / '), lead: '', automaticSports: pair.every(article => article.automaticSports), approved: pair.every(article => article.approved),
      blocks: [{ type: 'youth-sports-grid', wide: true, teams: pair.map(article => ({ title: shortTitle(article), websiteUrl:article.websiteUrl, ...article.blocks[0] })) }] });
  }
  const events = snapshot.articles.filter(
    (article) => article.kind === "event",
  );
  const magazineAds = (snapshot.advertising?.ads || []).map(ad => {
    const asset = String(ad.asset || '');
    if (!/^https:\/\//.test(asset) && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(asset) && !(snapshot.demo && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(asset))) {
      throw new Error(`Anzeigenmotiv fehlt: ${ad.name}`);
    }
    return { id: ad.id, name: ad.name, format: ad.format, websiteUrl: ad.websiteUrl, asset,
      width: Number(ad.width) || 1, height: Number(ad.height) || 1 };
  });
  const coverSettings = snapshot.cover_settings || null;
  const selectedTeasers = coverSettings?.articles || (events.length ? events : articles.filter(article => article.hasContent).slice(0, 3)).map(article => ({id:article.id,alias:''}));
  const matchSlug = match => articles.find(article => article.id === match.articleId)?.teamSlug || match.team.toLowerCase().replace(/ ii$/, '-2').replace(/ i$/, '-1').replace(/ (\d+)$/, '-$1');
  const edition = {
    id: `redaktion/${snapshot.id}`,
    number: coverSettings?.number ?? snapshot.publishes_on.slice(5).split("-").reverse().join("."),
    coverSettings,
    season: `${seasonStart}/${String(seasonStart + 1).slice(-2)}`,
    current: true,
    editorialPreview: preview,
    date: new Date(`${snapshot.publishes_on}T12:00:00Z`).toLocaleDateString(
      "de-DE",
    ),
    focus: snapshot.title,
    headline: coverSettings ? [coverSettings.headline, ""] : [snapshot.title, "Unser Vereinsleben."],
    subtitle: "Geschichten, Mannschaften und Termine aus unserem Verein.",
    photo: validImage ? image : null,
    photoAlt: snapshot.cover_alt || snapshot.title,
    photoCaption: snapshot.cover_credit || "Titelbild der Ausgabe",
    coverMatches: (snapshot.coverMatches || []).filter(match => !coverSettings?.teamSlugs || coverSettings.teamSlugs.includes(matchSlug(match))).map(match => ({...match,websiteUrl:teamWebsite(matchSlug(match))})),
    editorialCover: true,
    teaserIds: selectedTeasers.map(item => item.id),
    teaserAliases: Object.fromEntries(selectedTeasers.map(item => [item.id,item.alias])),
    articles,
    editorialPages,
    magazineAds,
    contacts,
    note: snapshot.demo
      ? "Lokale Heftvorschau · keine öffentliche Veröffentlichung."
      : preview
        ? "Private Redaktionsvorschau · Änderungen sind noch nicht veröffentlicht."
        : `Veröffentlicht am ${new Date(snapshot.published_at || Date.now()).toLocaleDateString("de-DE")}.`,
  };
  // All editorial strings enter through JSON or escaped text; no author-supplied HTML is executable.
  const advertisingNote = snapshot.advertising
    ? `${magazineAds.length} Anzeigen · ${snapshot.advertising.demo ? 'lokaler Beispielstand für das Heft vom ' + snapshot.advertising.issueDate : 'Anzeigenstand vom ' + new Date(snapshot.advertising.fetchedAt).toLocaleDateString('de-DE')}.`
    : 'Anzeigen wurden für diese Fassung noch nicht übernommen.';
  edition.note += ' ' + advertisingNote;
  const emptyArticles = articles.filter(article => !article.hasContent).length;
  if (preview && emptyArticles) edition.note += ` ${emptyArticles} Beiträge sind noch ohne Inhalt und erhalten keine eigene Heftseite.`;
  const boot = `const editions=[${safeJson(edition)}];const editionSponsorships={};\n${stadiumReaderAssets.advertisingScript}\n${stadiumReaderAssets.script}`;
  return stadiumReaderAssets.template
    .replace(
      "%%READER_STYLE%%",
      () =>
        stadiumReaderAssets.css +
        `\n.prose-columns p{white-space:pre-line}`,
    )
    .replace(
      "</body>",
      () =>
        `<script>${boot.replaceAll("</script", "<\\/script")}</script></body>`,
    );
}
