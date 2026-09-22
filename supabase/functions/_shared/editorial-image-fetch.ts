// Follow only redirects within the club's known image inventories.
export async function fetchEditorialImage(source: URL, fetchImpl = fetch) {
  let url = source;
  const signal = AbortSignal.timeout(15000);
  const visited = new Set<string>();
  for (let redirects = 0; redirects <= 3; redirects++) {
    const trusted = url.protocol === 'https:' && !url.username && !url.password && !url.port && (
      url.hostname === 'gerinjo.github.io' && url.pathname.startsWith('/bsv-website/images/') ||
      ['bsvnordstern.de', 'www.bsvnordstern.de'].includes(url.hostname) && url.pathname.startsWith('/images/')
    );
    if (!trusted) throw new Error('Das Bild muss aus dem Vereins-Bildbestand stammen.');
    if (visited.has(url.href)) throw new Error('Die Bildadresse enthält eine Weiterleitungsschleife.');
    visited.add(url.href);
    const response = await fetchImpl(url, { redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Die Bildweiterleitung enthält keine Zieladresse.');
    url = new URL(location, url);
  }
  throw new Error('Die Bildadresse enthält zu viele Weiterleitungen.');
}
