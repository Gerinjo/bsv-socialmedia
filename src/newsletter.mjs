import { NEWSLETTER_UNSUBSCRIBE_LINK } from './newsletter-unsubscribe.mjs';
export function newsletterDefaults(issue) {
  return {
    name: 'NORDSTERN POST', number: '', headline: issue.title,
    kicker: 'GEMEINSAM. STARK. SEIT 1956.',
    intro: 'Neuigkeiten, Menschen und Geschichten aus dem BSV Nordstern Radolfzell.',
    subject: '', preheader: '',
    showName: true, showNumber: true, showDate: true,
    showHeadline: true, showKicker: true, showIntro: true,
    ...issue.newsletter_settings,
  };
}
export function normalizeNewsletterSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bitte die Newsletter-Angaben prüfen.');
  const settings = {};
  for (const [name, label, limit] of [['name','Name',80],['number','Ausgabenummer',30],['headline','Überschrift',180],['kicker','Dachzeile',120],['intro','Einleitung',1000],['subject','Betreff',180],['preheader','Vorschautext',200]]) {
    if (typeof value[name] !== 'string' || value[name].trim().length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value[name]) || (name !== 'intro' && /[\r\n]/.test(value[name]))) throw new Error(`${label}: Bitte einen gültigen Text mit höchstens ${limit} Zeichen eingeben.`);
    settings[name] = value[name].trim();
  }
  for (const name of ['showName','showNumber','showDate','showHeadline','showKicker','showIntro']) {
    if (typeof value[name] !== 'boolean') throw new Error('Ungültiger Newsletter-Schalter.');
    settings[name] = value[name];
  }
  if (settings.showName && !settings.name) throw new Error('Bitte einen Newsletter-Namen eingeben oder die Anzeige ausschalten.');
  return settings;
}

export function newsletterExcerpt(body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 420) return text;
  const prefix = text.slice(0, 419);
  const sentence = [...prefix.matchAll(/[.!?](?=\s)/g)].at(-1);
  const end = sentence && sentence.index >= 200 ? sentence.index + 1 : prefix.lastIndexOf(' ');
  return prefix.slice(0, end > 0 ? end : 419).trimEnd() + '…';
}
export function newsletterSource(publication) {
  const snapshot = publication?.snapshot;
  if (!snapshot || snapshot.kind !== 'stadium' || !publication.published_at || !Number.isInteger(publication.issue_version) || publication.issue_version < 1) throw new Error('Dieses Stadionheft ist noch nicht veröffentlicht.');
  return {
    issue_id: publication.issue_id, issue_version: publication.issue_version,
    title: snapshot.title, published_at: publication.published_at,
    articles: (snapshot.articles || []).filter(article => article.status === 'ready' && article.body?.trim()).map(article => ({
      id: article.id, title: article.title, author: article.author || '', excerpt: newsletterExcerpt(article.body),
    })),
  };
}
export function newsletterSelection(source, articleIds) {
  if (!Array.isArray(articleIds) || articleIds.length > 30 || new Set(articleIds).size !== articleIds.length || articleIds.some(id => typeof id !== 'string' || !source.articles.some(article => article.id === id))) throw new Error('Bitte bis zu 30 verfügbare Artikel aus diesem Heft auswählen.');
  if (!articleIds.length) return null;
  return {...source, articles:source.articles.filter(article => articleIds.includes(article.id)).map(article => ({...article}))};
}
export function newsletterArticleUrl(selection, article, origin = 'https://bsv-story-automatik.jerome-ernsberger.chatgpt.site') {
  return `${origin}/stadionheft/${encodeURIComponent(selection.issue_id)}?version=${encodeURIComponent(selection.issue_version)}#artikel/${encodeURIComponent(article.id)}`;
}

// The mail shell is derived from the Nordstern Post website edition.
// No browser scripts or stadium reader assets are included in a newsletter.
export function renderEditorialNewsletter(snapshot, template, { preview = true, stadiumIssues = [], stadiumOrigin = 'https://bsv-story-automatik.jerome-ernsberger.chatgpt.site', unsubscribePreviewUrl = 'https://bsv-story-automatik.jerome-ernsberger.chatgpt.site/newsletter/abmelden?vorschau=1' } = {}) {
  if (snapshot.kind !== 'newsletter') throw new Error('Bitte eine Newsletter-Ausgabe auswählen.');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const articles = (snapshot.articles || []).filter(article => article.status !== 'waived');
  const selection = snapshot.newsletter_selection;
  const imported = selection?.articles || [];
  if (!preview && ((!articles.length && !imported.length) || articles.some(article => article.status !== 'ready' || !article.body?.trim()))) {
    throw new Error('Bitte alle Newsletter-Beiträge ausfüllen und freigeben, bevor du die Versanddateien exportierst.');
  }
  const linkText = value => String(value ?? '').split(/(https?:\/\/[^\s<>"']+)/g).map(part => {
    if (!/^https?:\/\//.test(part)) return escape(part).replaceAll('\n', '<br />');
    let url;
    try { url = new URL(part); } catch { return escape(part); }
    if (url.username || url.password) return escape(part);
    return `<a href="${escape(url.href)}" style="color:#17613a;overflow-wrap:anywhere;">${escape(part)}</a>`;
  }).join('');
  const month = new Date(`${snapshot.publishes_on}T12:00:00Z`).toLocaleDateString('de-DE', {month:'long',year:'numeric', timeZone:'Europe/Berlin'});
  const settings = normalizeNewsletterSettings(newsletterDefaults(snapshot));
  const title = settings.subject || snapshot.title;
  const preheader = settings.preheader || articles.find(article => article.body?.trim())?.body.trim().replace(/\s+/g, ' ').slice(0, 160) || imported[0]?.excerpt.slice(0, 160) || settings.intro;
  const edition = [settings.showNumber && settings.number ? `Ausgabe ${settings.number}` : '', settings.showDate ? month : ''].filter(Boolean).join(' · ');
  const text = [settings.showName ? `✦ ${settings.name}` : '', edition,
    settings.showKicker ? settings.kicker : '', settings.showHeadline ? settings.headline : '', settings.showIntro ? settings.intro : ''].filter(Boolean);
  const rows = articles.map((article, index) => {
    const state = preview && article.status !== 'ready' ? '<p style="color:#865700;font-size:13px;">Entwurf · noch nicht freigegeben</p>' : '';
    const body = String(article.body || '').split(/\n\s*\n/).map(paragraph => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;">${linkText(paragraph)}</p>`).join('');
    const images = (article.galleries || []).flatMap(group => group.images || []);
    const photos = images.map(image => {
      const url = image.photo_url || '';
      // Storage URLs used by the magazine expire. They cannot be sent in email.
      if (!/^https:\/\//.test(url) || /\/object\/sign\/|[?&](token|signature|expires)=/i.test(url)) {
        if (!preview) throw new Error(`„${article.title}“ enthält ein Bild ohne dauerhaften öffentlichen Link. Für die E-Mail bitte zuerst eine dauerhafte Bildadresse bereitstellen.`);
      }
      if (!/^https?:\/\//.test(url)) return '';
      text.push(`${image.alt || article.title}: ${url}`);
      return `<p><img src="${escape(url)}" alt="${escape(image.alt || article.title)}" width="632" style="display:block;width:100%;max-width:632px;height:auto;border:0;" /></p>`;
    }).join('');
    text.push(`\n${article.title}\n${article.author ? article.author + '\n' : ''}\n${article.body || ''}`);
    return `<tr><td class="section" style="padding:36px 40px;background-color:${index % 2 ? '#edf0e9' : '#ffffff'};">${state}<h2 style="margin:0 0 18px;color:#17613a;font-size:28px;line-height:34px;">${escape(article.title)}</h2>${article.author ? `<p style="font-size:13px;">${escape(article.author)}</p>` : ''}${body}${photos}</td></tr>`;
  });
  for (const article of imported) {
    const url = newsletterArticleUrl(selection, article, stadiumOrigin);
    rows.push(`<tr><td class="section" data-newsletter-excerpt="${escape(article.id)}" style="padding:36px 40px;border-top:1px solid #dce4d9;background-color:#ffffff;"><p style="margin:0 0 12px;color:#17613a;font-size:12px;line-height:18px;font-weight:bold;">AUS DEM STADIONHEFT · ${escape(selection.title)}</p><h2 style="margin:0 0 18px;color:#17613a;font-size:28px;line-height:34px;">${escape(article.title)}</h2><p style="margin:0 0 20px;font-size:16px;line-height:26px;">${escape(article.excerpt)}</p><p style="margin:0;font-size:16px;line-height:26px;"><a href="${escape(url)}" style="color:#17613a;font-weight:bold;">Weiterlesen im Stadionheft →</a></p></td></tr>`);
    text.push(`\nAUS DEM STADIONHEFT · ${selection.title}\n\n${article.title}\n\n${article.excerpt}\n\nWeiterlesen im Stadionheft: ${url}`);
  }
  // This section is mandatory, even for an empty draft. Use publication dates
  // instead of editable issue titles so later draft changes stay out of the mail.
  const published = [...new Map(stadiumIssues.filter(issue =>
    issue.kind === 'stadium' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(issue.id) &&
    issue.published_at && Number.isFinite(Date.parse(issue.published_at)) &&
    Number.isInteger(issue.published_version) && issue.published_version > 0,
  ).map(issue => [issue.id, issue])).values()]
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id));
  const magazineLinks = published.map(issue => ({
    title: `Stadionheft · veröffentlicht am ${new Date(issue.published_at).toLocaleDateString('de-DE', {timeZone:'Europe/Berlin'})}`,
    url: `https://bsv-story-automatik.jerome-ernsberger.chatgpt.site/stadionheft/${issue.id}`,
  }));
  magazineLinks.push({title:'Digitales Stadionheft durchblättern',url:'https://gerinjo.github.io/bsv-stadionheft-pages/'});
  rows.push(`<tr><td class="section" data-newsletter-stadium-magazines style="padding:36px 40px;background-color:#edf0e9;"><p style="margin:0 0 12px;color:#17613a;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:2px;">NORDSTERN NEWS</p><h2 style="margin:0 0 18px;color:#17613a;font-size:28px;line-height:34px;">Unsere Stadionhefte</h2><p style="margin:0 0 20px;font-size:16px;line-height:26px;">Mannschaften, Menschen und Geschichten aus dem Vereinsleben: Hier geht es zu unseren digitalen Stadionheften.</p>${magazineLinks.map(link => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;"><a href="${escape(link.url)}" style="color:#17613a;font-weight:bold;">${escape(link.title)} →</a></p>`).join('')}</td></tr>`);
  text.push('\nNORDSTERN NEWS · UNSERE STADIONHEFTE\n\nMannschaften, Menschen und Geschichten aus dem Vereinsleben: Hier geht es zu unseren digitalen Stadionheften.\n\n' + magazineLinks.map(link => `${link.title}: ${link.url}`).join('\n'));
  const unsubscribeUrl = preview ? unsubscribePreviewUrl : NEWSLETTER_UNSUBSCRIBE_LINK;
  text.push('\nBSV Nordstern e.V. Radolfzell\nSchlesierstraße 43 · 78315 Radolfzell\ninfo@bsvnordstern.de\nImpressum https://bsvnordstern.de/impressum\nDatenschutz https://bsvnordstern.de/datenschutz\nNewsletter abmelden: ' + unsubscribeUrl);
  const values = {
    TITLE:escape(title), PREHEADER:escape(preheader), EDITION:escape(['BSV Nordstern Radolfzell',edition].filter(Boolean).join(' · ')),
    BRAND:settings.showName && settings.name ? `<p class="newsletter-brand" style="margin:0 0 8px;color:#f4d638;font-size:22px;line-height:28px;font-weight:bold;letter-spacing:1px;">✦ ${escape(settings.name)}</p>` : '',
    KICKER:settings.showKicker && settings.kicker ? `<p style="margin:0 0 18px;color:#f4d638;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:2px;">${escape(settings.kicker)}</p>` : '',
    HEADLINE:settings.showHeadline && settings.headline ? `<h1 class="headline" style="margin:0 0 24px;color:#ffffff;font-size:46px;line-height:50px;letter-spacing:-1px;overflow-wrap:anywhere;">${escape(settings.headline)}</h1>` : '',
    INTRO:settings.showIntro && settings.intro ? `<p style="margin:0;color:#ffffff;font-size:17px;line-height:27px;">${escape(settings.intro).replaceAll('\n','<br />')}</p>` : '',
    UNSUBSCRIBE_URL:escape(unsubscribeUrl),
    CONTENT:rows.join('\n'),
  };
  const html = template.replace(/\{\{(TITLE|PREHEADER|EDITION|BRAND|KICKER|HEADLINE|INTRO|CONTENT|UNSUBSCRIBE_URL)\}\}/g, (_, key) => values[key]);
  return { html, text: text.join('\n\n'), subject: title, preheader };
}
