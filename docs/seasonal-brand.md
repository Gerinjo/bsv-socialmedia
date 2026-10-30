# Saisonmotive und Schneefall

Die freigestellten Weihnachts- und Ostermotive wurden mit dem integrierten Imagegen-Werkzeug als Bearbeitung der vorhandenen v2-Motive erstellt. Originalausgaben mit Alpha liegen unter:

- `admin-site/assets/brand-themes/sources/christmas-v3.png`
- `admin-site/assets/brand-themes/sources/easter-v3.png`

Die optimierten PNGs und WebPs liegen daneben unter `admin-site/assets/brand-themes/`. `src/brand-theme-versions.mjs` bestimmt die aktuellen Varianten. `node scripts/build-brand-theme-art.mjs` erzeugt die optimierten Motive und die eingebetteten WebPs für SVG-Vorschauen. Frühere v1/v2-Dateien bleiben für vorhandene Newsletterlinks erhalten. Neue Weihnachts- und Osternachrichten verwenden v3-PNGs; Fußball und Sommer bleiben bei v2.

Die Vereinshomepage verwendet eigene 1024-Pixel-WebPs unter `bsv-website/public/images/brand-themes/`. Das zentrale Theme wird dort wie bisher über die öffentliche Designkonfiguration übernommen; die neue Grafik enthält eine Krippe mit Maria, Josef und Jesus sowie Geschenke beziehungsweise zusätzliche Eier, Nest und Glocken.

`src/seasonal-snow.mjs` und `admin-site/seasonal-snow.css` sind mit `bsv-website/src/utils/seasonal-snow.mjs` und `src/styles/seasonal-snow.css` abgestimmt. Der Schnee erscheint nur bei Weihnachten, in der Homepage-Beispielkarte und deren Vergrößerung sowie über der tatsächlichen Vereinshomepage. Die dekorative Ebene blockiert keine Klicks, ist für Screenreader ausgeblendet und wird bei reduzierter Bewegung, im Hintergrund oder im Druck deaktiviert. Ein Themewechsel entfernt die Schneeflocken. Vorschauänderungen speichern kein Theme automatisch.

## Verwendete Bildprompts

Modus: integriertes Imagegen, jeweils Bildbearbeitung mit dem vorhandenen v2-Motiv als Referenz und `transparent_background=true`.

### Weihnachten

Use case: precise-object-edit. Edit target: the attached photographic Christmas tree cutout used as a club website motif. Preserve this exact realistic evergreen tree, golden star, warm white fairy lights and gold ornaments, with the complete tree visible and uncropped. Add a harmonious scene at the foot of the tree: a clearly recognizable small wooden Christmas nativity stable with Mary, Joseph and baby Jesus in the manger, plus six wrapped gifts of different sizes in forest green, cream and gold with ribbon bows around and beside the stable. The tree remains the dominant subject; the nativity and gifts form a compact but clearly visible foreground across the bottom quarter. Match the existing photographic lighting and perspective. A square composition with small transparent margins and natural contact shadows only under the objects, no floor or background panel. Genuinely transparent alpha background throughout the empty space. No text, logos, watermark, border, or snow animation. Return one finished standalone image.

### Ostern

Use case: precise-object-edit. Edit target: the attached photographic Easter hare cutout used as a club website motif. Keep the same realistic friendly hare, its fur, ears, pose, expression, lighting, and the existing green-and-cream patterned eggs. Enrich the scene at the hare's feet with about ten additional beautiful Easter eggs in varied sizes, mainly cream, sage green, forest green and soft gold, several delicate botanical and striped patterns, a low small nest with a few eggs, and two small golden decorative Easter bells with soft green ribbons. Arrange everything naturally as a lush but compact spring display at the base, without covering the hare's face or ears. Keep the whole hare and objects uncropped. Match the high quality photographic style and soft lighting of the edit target. A square composition with small transparent margins. Genuinely transparent alpha background, no background scene or floor, only subtle contact shadows beneath the objects. No text, logos, watermark or border. Return one finished standalone image.
