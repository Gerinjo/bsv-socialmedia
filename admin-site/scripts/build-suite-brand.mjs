import { readFile, writeFile } from 'node:fs/promises';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

// The SVG is the source for both the interface and installed app icons.
const assets = new URL('../assets/', import.meta.url);
const icon = await readFile(new URL('social-media-club-suite-icon.svg', assets), 'utf8');
await initWasm(await readFile(new URL('../../node_modules/@resvg/resvg-wasm/index_bg.wasm', assets)));
for (const size of [192, 512]) {
  const renderer = new Resvg(icon, { fitTo: { mode: 'width', value: size } });
  const rendered = renderer.render();
  try {
    const png = rendered.asPng();
    await writeFile(new URL(`cashbook-icon-${size}.png`, assets), png);
    if (size === 512) await writeFile(new URL('social-media-club-suite-icon.png', assets), png);
  } finally {
    rendered.free();
    renderer.free();
  }
}
