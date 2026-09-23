import { packAdvertisements } from './ad-layout.mjs';

// Compare several text densities against the entire advertising inventory.
// Short articles share sheets; long paragraphs continue without losing text.
export function paginateEditorial(articles, ads, measure) {
  const pageHeight = 1040 * 841.89 / 595.276;
  const sources = articles.filter(article => article.blocks.length);
  function flow(targetRows, maxSections = Infinity) {
    const pages = [];
    let segments = [];
    function make(parts = segments) {
      const first = parts[0];
      return { ...first, articleId: first.articleId || first.id, segments: parts,
        articleIds: [...new Set(parts.flatMap(part => [part.articleId || part.id, ...(part.articleIds || [])]))],
        blocks: parts.flatMap(part => part.blocks), paged: true, editorialPaged: true };
    }
    function finish() {
      if (!segments.length) return;
      const page = make(), measuredHeight = measure(page);
      pages.push({ ...page, measuredHeight, contentRows: Math.min(6, Math.ceil((measuredHeight + 24) / pageHeight * 6)) });
      segments = [];
    }
    for (const article of sources) {
      if (segments.length >= maxSections || segments.length && segments[0].sectionKey !== article.sectionKey) finish();
      if (article.fullPage || article.keepTogether || article.blocks.some(block => /sports/.test(block.type))) {
        finish();
        const page = { ...article, articleId: article.id, paged: true, editorialPaged: true };
        const measuredHeight = measure(page);
        pages.push({ ...page, measuredHeight, contentMask: !article.fullPage ? measure.contentMask?.(page) : undefined, contentRows: article.fullPage ? 6 : Math.min(6, Math.ceil((measuredHeight + 24) / pageHeight * 6)), paged: measuredHeight <= pageHeight - 24, editorialPaged: measuredHeight <= pageHeight - 24 });
        continue;
      }
      let remaining = article.blocks.map(block => ({ ...block })), part = 0;
      while (remaining.length) {
        const segment = { ...article, id: part ? `${article.id}-fortsetzung-${part}` : article.id, articleId: article.id, continuation: part > 0, blocks: [] };
        const limit = pageHeight * targetRows / 6 - 28;
        const candidateHeight = blocks => measure(make([...segments, { ...segment, blocks }]));
        while (remaining.length) {
          const block = remaining[0];
          if (candidateHeight([...segment.blocks, block]) <= limit) { segment.blocks.push(remaining.shift()); continue; }
          if (block.type === 'paragraph') {
            const words = block.text.match(/\S+\s*/g) || [];
            let low = 0, high = words.length;
            while (low < high) {
              const middle = Math.ceil((low + high) / 2);
              if (candidateHeight([...segment.blocks, { ...block, text: words.slice(0, middle).join('') }]) <= limit) low = middle;
              else high = middle - 1;
            }
            if (low >= Math.min(16, words.length)) {
              segment.blocks.push({ ...block, text: words.slice(0, low).join('') });
              if (low === words.length) remaining.shift();
              else remaining[0] = { ...block, text: words.slice(low).join('') };
            }
          }
          break;
        }
        if (!segment.blocks.length) {
          if (segments.length) { finish(); continue; }
          // A portrait plus heading, or another indivisible block, may need a
          // taller page. Keep it intact and use its measured remaining space.
          segment.blocks.push(remaining.shift());
        }
        // Do not strand a portrait on its own sheet.
        if (segment.blocks.every(block => block.type === 'person-portraits') && remaining[0]?.type === 'paragraph') {
          if (segments.length) { remaining.unshift(...segment.blocks); finish(); continue; }
          const block = remaining[0], words = block.text.match(/\S+\s*/g) || [];
          let low = 0, high = words.length;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (candidateHeight([...segment.blocks, {...block,text:words.slice(0,middle).join('')}]) <= pageHeight - 28) low = middle;
            else high = middle - 1;
          }
          if (low) {
            segment.blocks.push({...block,text:words.slice(0,low).join('')});
            if (low === words.length) remaining.shift(); else remaining[0]={...block,text:words.slice(low).join('')};
          }
        }
        segments.push(segment);
        part++;
        if (remaining.length) finish();
      }
    }
    finish();
    return pages;
  }
  let best;
  const seen = new Set();
  for (const maxSections of [Infinity, 3, 2, 1]) for (const target of [6, 4, 3]) {
    const pages = flow(target, maxSections);
    const fingerprint = JSON.stringify(pages.map(page => [page.articleIds || page.id, page.contentRows, page.contentMask, page.blocks]));
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const layout = packAdvertisements(ads, pages, { maxAdsPerPage: 3 });
    const total = pages.length + layout.extraPages.length;
    if (!best || total < best.total || total === best.total && layout.extraPages.length < best.layout.extraPages.length) best = { pages, layout, total };
  }
  const pages = best.pages.map((page, i) => ({ ...page, adSlots: best.layout.placements[i] }));
  // Distribute full-page bookings and unavoidable overflow across the issue.
  const count = pages.length;
  for (let i = best.layout.extraPages.length - 1; i >= 0; i--) {
    const slots = best.layout.extraPages[i];
    let insertion = Math.ceil((i + 1) * count / (best.layout.extraPages.length + 1));
    while (insertion > 0 && pages[insertion - 1]?.keepWithNext) insertion--;
    pages.splice(insertion, 0,
      { id: `anzeige-${slots[0].ad.id}`, title: slots.map(slot => slot.ad.name).join(' · '), category: 'Unsere Werbepartner', advertising: true, paged: true, blocks: [], adSlots: slots });
  }
  pages.forEach((page, i) => { page.folio = i + 2; });
  return pages;
}

// The directory always closes the issue, after all advertisement placements.
// Measure complete groups so names and roles never split across sheets.
export function paginateEditorialContacts(directory, measure, firstFolio = 2) {
  const pages = [], limit = 1040 * 841.89 / 595.276 - 24;
  const make = groups => ({id: pages.length ? `kontakte-${pages.length + 1}` : 'kontakte',
    title: pages.length ? 'Kontakte · Fortsetzung' : 'Wir sind für euch da.',
    category: 'Kontakte & Ansprechpersonen', lead: 'Menschen, die unseren Verein bewegen. Der Pfeil führt zur jeweiligen Person auf unserer Homepage.',
    approved: true, fullPage: true, contactPage: true, paged: true, editorialPaged: true,
    folio: firstFolio + pages.length, blocks: [{type:'contact-directory', wide:true, groups, verifiedAt:directory.verifiedAt}], adSlots: []});
  let groups = [];
  const finish = () => {
    if (!groups.length) return;
    const page = make(groups), fits = measure(page) <= limit;
    pages.push({...page,paged:fits,editorialPaged:fits});
    groups = [];
  };
  for (const group of directory?.groups || []) {
    if (groups.length && measure(make([...groups,group])) > limit) finish();
    groups.push(group);
  }
  finish();
  return pages;
}
