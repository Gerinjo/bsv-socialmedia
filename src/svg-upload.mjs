const svgNamespace = 'http://www.w3.org/2000/svg';
const svgActiveElements = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'animatemotion', 'animatetransform', 'set', 'discard', 'handler', 'listener']);

/** Check CSS after decoding escapes and comments, including inside style elements. */
export function validateSvgCss(value) {
  const css = String(value)
    .replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_, hex, character) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : character)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, '');
  if (/@import\b|(?:expression|(?:-webkit-)?image-set|src)\s*\(|(?:behavior|-moz-binding)\s*:/i.test(css)) {
    throw new Error('Die SVG-Datei darf keine externen oder ausführbaren Styles enthalten.');
  }
  for (const match of css.matchAll(/url\s*\(([^)]*)\)/gi)) {
    // Accept only references to gradients, masks and other elements in this SVG.
    if (!/^\s*(['"]?)#[^\s'"()]+\1\s*$/.test(match[1])) {
      throw new Error('Die SVG-Datei darf keine externen Inhalte laden.');
    }
  }
}

/** Validate on both client and server; return a standalone SVG without editor metadata.
 * @param {string} source
 * @param {any} parser
 * @param {any} serializer
 */
export function prepareSvgSource(source, parser, serializer) {
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('SVG-Dateien mit eigenen XML-Entitäten werden nicht unterstützt.');
  let doc;
  try { doc = parser.parseFromString(source, 'image/svg+xml'); }
  catch { throw new Error('Die SVG-Datei ist ungültig.'); }
  const root = doc?.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== svgNamespace || doc.getElementsByTagName('parsererror').length) {
    throw new Error('Die SVG-Datei ist ungültig.');
  }
  // A stack avoids recursion limits for deeply nested files.
  const pending = [root];
  while (pending.length) {
    const element = pending.pop();
    const name = element.localName.toLowerCase();
    if (svgActiveElements.has(name)) throw new Error('Die SVG-Datei enthält ausführbare oder eingebettete Inhalte. Bitte als statisches SVG exportieren.');
    if (element.namespaceURI !== svgNamespace || name === 'metadata') {
      element.parentNode.removeChild(element);
      continue;
    }
    if (name === 'style') validateSvgCss(element.textContent);
    for (const attribute of Array.from(element.attributes)) {
      const key = attribute.localName.toLowerCase();
      const value = attribute.value.trim();
      if (key.startsWith('on')) throw new Error('Die SVG-Datei enthält nicht erlaubte Ereignissteuerung.');
      if (key === 'base') throw new Error('Die SVG-Datei darf keine externe Basisadresse festlegen.');
      if (key === 'href' || key === 'src') {
        const embeddedImage = name === 'image' && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
        if (value && !value.startsWith('#') && !embeddedImage) throw new Error('Die SVG-Datei darf keine externen Inhalte laden.');
      }
      validateSvgCss(value);
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) pending.push(child);
      else if (child.nodeType === 7) element.removeChild(child);
    }
  }
  // Serializing the root omits XML processing instructions and external DOCTYPEs.
  return serializer.serializeToString(root);
}
