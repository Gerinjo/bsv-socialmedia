export const cashbookManifest = {
  id: '/', name: 'BSV Nordstern · Club Suite', short_name: 'BSV Suite', lang: 'de',
  start_url: '/?area=cashbook', scope: '/', display: 'standalone',
  description: 'Die BSV Club Suite mit dem Kassenbuch und deinen freigeschalteten Vereinsbereichen.',
  prefer_related_applications: false,
  background_color: '#f7f9f8', theme_color: '#165c3d',
  icons: [192,512].map(size=>({src:`/kassenbuch/icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any maskable'})),
};
export const cashbookOfflineHtml = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kassenbuch · Verbindung fehlt</title><style>body{margin:40px 24px;background:#f7f9f8;color:#29332f;font:18px/1.5 Roboto,Inter,Arial,sans-serif}main{max-width:500px;margin:auto}a{color:#165c3d}</style></head><body><main><h1>Internetverbindung fehlt.</h1><p>Für den aktuellen Safe-Bestand und jede Geldbuchung brauchst du eine Verbindung. Stelle sie wieder her und öffne das Kassenbuch erneut.</p><a href="/?area=cashbook">Erneut öffnen</a></main></body></html>';
