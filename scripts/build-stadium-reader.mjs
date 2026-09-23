import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const read = (name) =>
  readFile(new URL(`admin-site/stadium-reader/${name}`, root), "utf8");
let [template, css, script, crest] = await Promise.all(
  ["index.html", "style.css", "app.js", "wappen.svg"].map(read),
);
const contacts = JSON.parse(await readFile(new URL('config/editorial-contacts.json', root), 'utf8'));
const advertisingScript = (await readFile(new URL('src/stadium-magazine/platform-sponsors.mjs', root), 'utf8')).replaceAll('export ', '') + '\n' +
  (await readFile(new URL('src/stadium-magazine/ad-layout.mjs', root), 'utf8')).replace(/^import .*;\n/, '').replaceAll('export ', '') + '\n' +
  (await readFile(new URL('src/stadium-magazine/editorial-layout.mjs', root), 'utf8')).replace(/^import .*;\n/, '').replaceAll('export ', '') + `
  async function prepareEditorialTeamImages() {
    const photos = editions[0].editorialPages.flatMap(page => page.blocks.flatMap(block => [block.photo, ...(block.teams || []).map(team => team.photo)]).filter(Boolean));
    await Promise.all([...new Set(photos.map(photo => photo.src))].map(src => new Promise(resolve => {
      const picture = new Image();
      imageDimensions[src] = [1600, 900];
      const done = () => {
        clearTimeout(timer);
        if (picture.naturalWidth && picture.naturalHeight) imageDimensions[src] = [picture.naturalWidth, picture.naturalHeight];
        picture.onload = picture.onerror = null;
        resolve();
      };
      const timer = setTimeout(done, 8000);
      picture.onload = picture.onerror = done;
      picture.src = src;
    })));
  }
  function layoutEditorialMagazine() {
    const measure = document.createElement('article');
    measure.className = 'article paper paged-article editorial-paged editorial-measure';
    measure.style.cssText = 'position:absolute;left:-100000px;top:0;width:1040px;visibility:hidden;pointer-events:none';
    document.body.append(measure);
    try {
      const measurePage = page => {
        measure.innerHTML = sheetEditorialMarkup(page, editions[0]);
        return measure.querySelector('.sheet-editorial').getBoundingClientRect().height;
      };
      measurePage.contentMask = page => {
        measurePage(page);
        const cards = [...measure.querySelectorAll('.youth-sports-card')];
        if(cards.length !== 2) return undefined;
        const top=measure.getBoundingClientRect().top, height=1040*841.89/595.276;
        return cards.reduce((mask,card,column)=>{
          const rows=Math.min(6,Math.ceil((card.getBoundingClientRect().bottom-top+24)/height*6));
          for(let row=0;row<rows;row++)mask|=1<<(row*2+column);
          return mask;
        },0);
      };
      editions[0].pages = paginateEditorial(editions[0].editorialPages, editions[0].magazineAds, measurePage);
      editions[0].pages.push(...paginateEditorialContacts(editions[0].contacts, measurePage, editions[0].pages.length + 2));
    } finally { measure.remove(); }
  }
`;
script = script.replace('renderArchive();\nroute();', "document.querySelector('#main').hidden=true;prepareEditorialTeamImages().then(()=>{layoutEditorialMagazine();document.querySelector('#main').hidden=false;renderArchive();route();editorialLabels();});");

template = template
  .replace(/<script\b[^>]*src=[^>]*><\/script>/g, "")
  .replace(/<link rel="stylesheet"[^>]*>/, "<style>%%READER_STYLE%%</style>")
  .replaceAll(
    "assets/wappen.svg",
    `data:image/svg+xml;base64,${Buffer.from(crest).toString("base64")}`,
  );
// Adapt the existing reader's sample/archival labels without changing its navigation or layout.
script += `\nfunction editorialLabels(){
  const edition=editions[0];
  document.querySelectorAll('.issue-reference').forEach(node=>node.textContent='STADIONHEFT · '+edition.date);
  document.querySelector('#reader-context').textContent=edition.editorialPreview?'REDAKTIONSVORSCHAU · NOCH NICHT VERÖFFENTLICHT':'VERÖFFENTLICHTE AUSGABE';
  document.querySelector('#reader-footnote').textContent=edition.note;
  document.querySelector('#article-source').textContent='';
  document.querySelector('#edition-select').options[0].textContent=edition.focus;
  document.querySelectorAll('.archive-meta span:last-child').forEach(el=>el.textContent=edition.editorialPreview?'VORSCHAU':'VERÖFFENTLICHT');
  if(edition.editorialPreview){const active=edition.pages?.find(a=>(embeddedPath || location.hash).endsWith('artikel/'+a.id)||a.articleIds?.some(id=>(embeddedPath||location.hash).endsWith('artikel/'+id)));if(active)document.querySelector('#article-meta').textContent+=(active.approved?(active.automaticSports?' · Automatisch freigegeben':' · Freigegeben'):' · Noch nicht freigegeben');}
}
window.addEventListener('hashchange',editorialLabels);window.addEventListener('editorialnavigate',editorialLabels);\n`;
await writeFile(
  new URL("src/stadium-reader-assets.mjs", root),
  `// Generated from the existing bsv-stadionheft reader by scripts/build-stadium-reader.mjs.\nexport const stadiumReaderAssets=${JSON.stringify({ template, css, script, advertisingScript, contacts }).replaceAll("<", "\\u003c")};\n`,
);
