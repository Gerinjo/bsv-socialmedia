export function editorialCoverDefaults(issue, articles = []) {
  const visible = articles.filter(article => article.kind !== 'sports' && article.status !== 'waived' && article.body?.trim() && (article.kind !== 'coach' || article.status === 'ready'));
  const events = visible.filter(article => article.kind === 'event');
  return {
    showNumber: true, number: issue.publishes_on.slice(5).split('-').reverse().join('.'),
    showNamePart1: true, namePart1: 'NORDSTERN', showNamePart2: true, namePart2: 'news.',
    showHeadline: true, headline: issue.title, showDate: true,
    articles: (events.length ? events : visible.slice(0, 3)).map(article => ({id: article.id, alias: ''})),
    teamSlugs: null,
    ...issue.cover_settings,
  };
}
// Only fixed greetings have a counterpart in a newly created issue.
export function editorialCoverTemplate(settings, articles) {
  const normalized = normalizeEditorialCoverSettings(settings);
  return {...normalized, articles: normalized.articles.flatMap(item => {
    const article = articles.find(article => article.id === item.id);
    return article?.template_key && ['board','youth','coach'].includes(article.kind)
      ? [{template_key:article.template_key, alias:item.alias}] : [];
  })};
}
export function applyEditorialCoverTemplate(template, articles, teams) {
  return {...structuredClone(template), articles: template.articles.flatMap(item => {
    const article = articles.find(article => article.template_key === item.template_key && ['board','youth','coach'].includes(article.kind));
    return article ? [{id:article.id, alias:item.alias}] : [];
  }), teamSlugs: template.teamSlugs.filter(slug => teams.some(team => team.slug === slug && team.active !== false))};
}
export function normalizeEditorialCoverSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bitte die Titelblatt-Auswahl prüfen.');
  const result = {};
  for (const name of ['showNumber','showNamePart1','showNamePart2','showHeadline','showDate']) {
    if (typeof value[name] !== 'boolean') throw new Error('Ungültiger Titelblatt-Schalter.');
    result[name] = value[name];
  }
  for (const [name, limit] of [['number',20],['namePart1',40],['namePart2',40],['headline',180]]) {
    if (typeof value[name] !== 'string' || value[name].trim().length > limit) throw new Error(`Titelblatt-Feld ${name} ist zu lang oder ungültig.`);
    result[name] = value[name].trim();
  }
  if (!Array.isArray(value.articles) || value.articles.length > 200 || !Array.isArray(value.teamSlugs) || value.teamSlugs.length > 100) throw new Error('Bitte die Cover-Beiträge und Mannschaften prüfen.');
  const ids = new Set();
  result.articles = value.articles.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.alias !== 'string' || item.alias.trim().length > 100) throw new Error('Ungültiger oder doppelter Cover-Beitrag.');
    ids.add(item.id);
    return {id:item.id, alias:item.alias.trim()};
  });
  if (value.teamSlugs.some(slug => typeof slug !== 'string' || !/^(herren|frauen)-[1-9][0-9]*$/.test(slug)) || new Set(value.teamSlugs).size !== value.teamSlugs.length) throw new Error('Ungültige Mannschaftsauswahl.');
  result.teamSlugs = [...value.teamSlugs];
  return result;
}
export function editorialReleaseState(issue, articles) {
  const pending = articles.filter(
    (article) => !article.automatic_sports && !(article.kind === 'coach' && article.status === 'waived') && (article.status !== "ready" || !article.body.trim()),
  );
  const automaticPending = articles.filter(article => article.automatic_sports && (article.status !== 'ready' || !article.body.trim())).length;
  const missingCover =
    issue.kind === "stadium" && !issue.cover_path && !issue.cover_url;
  const reviewed = issue.previewed_version === issue.version;
  const currentPublication = issue.published_version === issue.version;
  return {
    pending: pending.length,
    automaticPending,
    missingCover,
    reviewed,
    currentPublication,
    ready: articles.length > 0 && !pending.length && !automaticPending && !missingCover,
    canPublish:
      issue.kind === "stadium" &&
      articles.length > 0 &&
      !pending.length &&
      !automaticPending &&
      !missingCover &&
      reviewed &&
      !currentPublication,
  };
}
export function editorialCoverMatches(issue, articles, teams) {
  return teams.filter(team => team.active !== false && /^(herren|frauen)-[1-9][0-9]*$/.test(team.slug || ''))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.slug.localeCompare(b.slug))
    .map(team => {
      const article = articles.find(article => article.kind === 'sports' && article.team_id === team.id);
      const match = (article?.source_snapshot?.upcoming || [])
        .filter(match => match.scheduled && !match.finished && match.date >= issue.publishes_on)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))[0];
      const [group, number] = team.slug.split('-');
      return { team: `${group === 'herren' ? 'Herren' : 'Frauen'} ${number === '1' ? 'I' : number === '2' ? 'II' : number}`,
        articleId: article?.id || null, date: match?.date || null, time: match?.time || null,
        home: match?.home || null, away: match?.away || null,
        state: match ? 'scheduled' : article?.source_snapshot?.fetchedAt ? 'unavailable' : 'pending' };
    });
}
export function editorialPublicSnapshot(issue, articles, teams = []) {
  const visible = articles.filter(article => article.status !== 'waived' && (article.kind !== 'coach' || article.status === 'ready' && article.body.trim()));
  const settings = issue.cover_settings ? structuredClone(issue.cover_settings) : null;
  if (settings) settings.articles = settings.articles.filter(item => visible.some(article => article.id === item.id && article.kind !== 'sports' && article.body.trim()));
  return {
    schemaVersion: 1,
    id: issue.id,
    version: issue.version,
    title: issue.title,
    kind: issue.kind,
    publishes_on: issue.publishes_on,
    cover_path: issue.cover_path || null,
    cover_url: issue.cover_url || null,
    cover_alt: issue.cover_alt || "",
    cover_credit: issue.cover_credit || "",
    cover_settings: settings,
    advertising: issue.advertising || null,
    coverMatches: editorialCoverMatches(issue, articles, teams),
    articles: visible.map(
      ({ id, title, body, author, kind, status, event_snapshot, automatic_sports, people_snapshot, gallery_groups, team_id, source_snapshot }) => ({
        id,
        title,
        body,
        author,
        kind,
        status,
        automatic_sports: Boolean(automatic_sports),
        team_slug: teams.find(team => team.id === team_id)?.slug || null,
        galleries: gallery_groups || [],
        team_photo: source_snapshot?.teamPhoto ? {alt:source_snapshot.teamPhoto.alt, photo_path:source_snapshot.teamPhoto.photo_path || null, photo_url:source_snapshot.teamPhoto.photo_url || null} : null,
        people: (people_snapshot || []).map(({ name, role, photo_url, photo_path }) => ({ name, role, photo_url: photo_url || null, photo_path: photo_path || null })),
        event: event_snapshot
          ? {
              date: event_snapshot.date,
              time: event_snapshot.time,
              location: event_snapshot.location,
            }
          : null,
      }),
    ),
  };
}
export function normalizeEditorialEvent(value) {
  const title = String(value.title ?? "").trim(),
    description = String(value.description ?? "").trim(),
    location = String(value.location ?? "").trim();
  const date = String(value.date ?? ""),
    time = String(value.time ?? "");
  if (
    !title ||
    title.length > 180 ||
    !description ||
    description.length > 30000 ||
    location.length > 200
  )
    throw new Error("Veranstaltungstitel, Beschreibung und Ort prüfen.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error("Bitte ein gültiges Veranstaltungsdatum angeben.");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Bitte eine gültige Uhrzeit angeben.");
  return {
    title,
    description,
    location,
    date,
    time,
    source_id: value.source_id ? String(value.source_id) : null,
  };
}
export function decodeEditorialCover(dataUrl) {
  const match = String(dataUrl ?? "").match(
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match || match[2].length > 7 * 1024 * 1024)
    throw new Error("Bitte ein JPG-, PNG- oder WebP-Bild bis 5 MB hochladen.");
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  if (bytes.length > 5 * 1024 * 1024)
    throw new Error("Das Titelbild darf höchstens 5 MB groß sein.");
  const valid =
    match[1] === "jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : match[1] === "png"
        ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
        : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!valid) throw new Error("Die Bilddatei hat kein gültiges Format.");
  return {
    bytes,
    mimeType: `image/${match[1]}`,
    extension: match[1] === "jpeg" ? "jpg" : match[1],
  };
}

// Immutable image references are resolved against the saved article by the API.
export function normalizeEditorialGalleries(value) {
  if (!Array.isArray(value) || value.length > 6) throw new Error('Höchstens sechs Bildgruppen pro Beitrag.');
  const ids = new Set();
  const id = value => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value) || ids.has(value)) throw new Error('Ungültige oder doppelte Bildkennung.');
    ids.add(value); return value;
  };
  return value.map(group => {
    const groupId = id(group.id), title = String(group.title || '').trim();
    if (title.length > 180 || !Array.isArray(group.images) || !group.images.length || group.images.length > 20) throw new Error('Eine Bildgruppe benötigt 1 bis 20 Bilder und einen Titel bis 180 Zeichen.');
    const images = group.images.map(image => {
      const imageId = id(image.id), alt = String(image.alt || '').trim();
      if (alt.length > 300) throw new Error('Bildbeschreibungen dürfen höchstens 300 Zeichen lang sein.');
      return { id: imageId, alt, ...(image.dataUrl ? { dataUrl: String(image.dataUrl) } : {}) };
    });
    if (!images.some(image => image.id === group.cover_id)) throw new Error('Bitte ein Titelbild aus der Bildgruppe auswählen.');
    return { id: groupId, title, cover_id: group.cover_id, images };
  });
}
