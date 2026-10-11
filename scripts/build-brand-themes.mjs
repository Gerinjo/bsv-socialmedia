// PNG fallbacks keep seasonal motifs readable in mail clients without SVG support.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import {BSV_THEMES,brandThemeSvg} from '../src/brand-themes.mjs';
await initWasm(await readFile(new URL('../node_modules/@resvg/resvg-wasm/index_bg.wasm',import.meta.url)));
const directory=new URL('../admin-site/assets/brand-themes/',import.meta.url);
await mkdir(directory,{recursive:true});
for(const theme of BSV_THEMES){const renderer=new Resvg(brandThemeSvg(theme.key),{fitTo:{mode:'width',value:640}});const png=renderer.render();await writeFile(new URL(theme.key+'-v1.png',directory),png.asPng());png.free();renderer.free();}
