import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { prepareSvgSource } from '../src/svg-upload.mjs';

const wrap = content => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">${content}</svg>`;
const prepare = source => prepareSvgSource(source, new DOMParser({ onError: () => { throw new Error('Invalid XML'); } }), new XMLSerializer());

test('SVG styles, class names, text, gradients and local references remain vectors', () => {
  const svg = wrap(`<style>.st0{fill:#125522}.st1{fill:url('#gradient')} .st2{clip-path:url("#clip")}</style><defs><linearGradient id="gradient"><stop offset="0" stop-color="#fff"/></linearGradient><clipPath id="clip"><circle r="20"/></clipPath></defs><path class="st0" d="M0 0h100v100z"/><text x="2" y="20">Müller &amp; Söhne</text><use xlink:href="#clip"/>`);
  const result = prepare(svg);
  assert.match(result, /<style>/);
  assert.match(result, /class="st0"/);
  assert.match(result, /linearGradient/);
  assert.match(result, /Müller &amp; Söhne/);
  assert.doesNotMatch(result, /data:image\/png/);
});

test('SVG export metadata and standard DOCTYPE do not prevent uploading', () => {
  const result = prepare(`<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${wrap('<metadata xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:RDF/></metadata><path d="M0 0h10"/>')}`);
  assert.match(result, /<path/);
  assert.doesNotMatch(result, /DOCTYPE|metadata|rdf:RDF/);
});

for (const content of [
  '<script>alert(1)</script>', '<svg:script xmlns:svg="http://www.w3.org/2000/svg"/>',
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"/></foreignObject>',
  '<path onload="alert(1)"/>', '<image href="https://example.com/logo.png"/>',
  '<style>@import "https://example.com/a.css";</style>',
  '<style>.a{fill:url(https://example.com/a.svg)}</style>',
  '<style>.a{fill:u\\72l(https://example.com/a.svg)}</style>',
  '<style>@im/**/port "https://example.com/a.css";</style>',
  '<path style="fill:url(&quot;https://example.com/a.svg&quot;)"/>',
  '<style>.a{background:image-set("https://example.com/a.png" 1x)}</style>',
  '<animate attributeName="href" to="https://example.com"/>',
  '<g xml:base="https://example.com/"><use href="#logo"/></g>',
]) {
  test(`rejects active or external SVG content: ${content.slice(0, 60)}`, () => {
    assert.throws(() => prepare(wrap(content)), /SVG-Datei/);
  });
}

test('rejects malformed XML and entity declarations', () => {
  assert.throws(() => prepare('<svg>'), /ungültig/);
  assert.throws(() => prepare('<!DOCTYPE svg [<!ENTITY x "test">]>'+wrap('&x;')), /Entitäten/);
});

test('embedded raster images can remain inside an SVG', () => {
  const source = wrap('<image href="data:image/png;base64,AA=="/>');
  assert.match(prepare(source), /data:image\/png;base64,AA==/);
});
