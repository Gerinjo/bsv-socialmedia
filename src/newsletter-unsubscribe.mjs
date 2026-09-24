export const NEWSLETTER_UNSUBSCRIBE_PAGE = 'https://bsv-story-automatik.jerome-ernsberger.chatgpt.site/newsletter/abmelden';
export const NEWSLETTER_UNSUBSCRIBE_LINK = `${NEWSLETTER_UNSUBSCRIBE_PAGE}#{{{RESEND_UNSUBSCRIBE_URL}}}`;

// The personal provider URL stays in the fragment: it is never sent to the Suite server.
export function resendUnsubscribeTarget(fragment) {
  try {
    let value = fragment.replace(/^#/, '');
    if (!value.startsWith('https://')) value = decodeURIComponent(value);
    if (value.length > 8192 || /[\s<>"{}]/.test(value)) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'resend.com' || url.hostname.endsWith('.resend.com')) || url.pathname === '/') return null;
    return url.href;
  } catch { return null; }
}

export function unsubscribeConfirmationEmail() {
  const subject = 'Nordstern Post: Deine Abmeldung ist bestätigt';
  const text = 'Deine Abmeldung ist bestätigt.\n\nDu bist jetzt von der Nordstern Post abgemeldet und erhältst keine weiteren Newsletter von uns. Du musst nichts weiter tun.\n\nDiese E-Mail bestätigt ausschließlich deine Abmeldung.\n\nGrün-weiße Grüße\nDein BSV Nordstern Radolfzell\n\nBSV Nordstern e.V. Radolfzell\nSchlesierstraße 43 · 78315 Radolfzell\ninfo@bsvnordstern.de\nImpressum: https://bsvnordstern.de/impressum\nDatenschutz: https://bsvnordstern.de/datenschutz';
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#edf0e9;color:#193c2c;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" style="max-width:640px;background:#fff;border:4px solid #17613a;"><tr><td style="padding:28px;background:#092f20;border-top:6px solid #f4d638;color:#f4d638;font-size:20px;font-weight:bold;">✦ NORDSTERN POST</td></tr><tr><td style="padding:28px;font-size:16px;line-height:1.7;"><h1 style="font-size:28px;line-height:1.2;color:#17613a;">Deine Abmeldung ist bestätigt.</h1><p>Du bist jetzt von der Nordstern Post abgemeldet und erhältst keine weiteren Newsletter von uns. Du musst nichts weiter tun.</p><p>Diese E-Mail bestätigt ausschließlich deine Abmeldung.</p><p>Grün-weiße Grüße<br><strong>Dein BSV Nordstern Radolfzell</strong></p></td></tr><tr><td style="padding:24px 28px;background:#edf0e9;font-size:12px;line-height:1.7;">BSV Nordstern e.V. Radolfzell<br>Schlesierstraße 43 · 78315 Radolfzell<br>info@bsvnordstern.de<br><a href="https://bsvnordstern.de/impressum" style="color:#17613a;">Impressum</a> · <a href="https://bsvnordstern.de/datenschutz" style="color:#17613a;">Datenschutz</a></td></tr></table></td></tr></table></body></html>`;
  return {subject,html,text};
}

export function renderNewsletterUnsubscribePage() {
  const email = unsubscribeConfirmationEmail();
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Newsletter abmelden · BSV Nordstern</title><style>*{box-sizing:border-box}body{margin:0;background:#edf0e9;color:#193c2c;font:17px/1.65 Arial,Helvetica,sans-serif}main{max-width:640px;margin:8vh auto;padding:0 18px}.card{background:white;border:4px solid #17613a;border-top:6px solid #f4d638}.brand{padding:24px 30px;background:#092f20;color:#f4d638;font-weight:bold;letter-spacing:1px}.content{padding:30px}h1{font-size:32px;line-height:1.2;margin:0 0 24px;color:#17613a}p{margin:0 0 20px}button,.button{display:inline-block;background:#17613a;color:#fff;border:0;padding:15px 22px;font:inherit;font-weight:bold;cursor:pointer;text-decoration:none;border-radius:4px}button:disabled{opacity:.6;cursor:wait}a{color:#17613a}a:focus-visible,button:focus-visible{outline:3px solid #c39100;outline-offset:4px}footer{padding:20px 0;font-size:13px}.small{font-size:14px;color:#516158}.demo{padding:12px;background:#fff2bd;font-size:14px}details{margin-top:24px}iframe{width:100%;height:620px;border:1px solid #ccd6cf}[hidden]{display:none!important}@media(max-width:440px){main{margin:24px auto}.content,.brand{padding:24px}h1{font-size:28px}}</style></head><body><main><p class="demo" id="demo" hidden>Vorschau · Es wird niemand abgemeldet und keine E-Mail versendet.</p><section class="card"><div class="brand">✦ NORDSTERN POST</div><div class="content"><h1 id="heading">Möchtest du dich abmelden?</h1><div id="intro"><p>Wenn du die Nordstern Post nicht mehr erhalten möchtest, bestätige hier deine Abmeldung.</p><p class="small">Erst mit deiner Bestätigung wirst du abgemeldet. Anschließend erhältst du eine Bestätigung per E-Mail.</p></div><form id="unsubscribe"><button type="submit" id="confirm" disabled>Abmeldung bestätigen</button></form><p id="status" role="status" aria-live="polite"></p><p><a href="https://bsvnordstern.de/" id="cancel">Newsletter behalten · Zur Vereinswebsite</a></p><noscript><p>Bitte aktiviere JavaScript, um deinen persönlichen Abmeldelink zu öffnen. Bei Fragen hilft dir <a href="mailto:info@bsvnordstern.de">info@bsvnordstern.de</a>.</p></noscript><details id="email-preview" hidden><summary>Bestätigungsmail ansehen</summary><iframe title="Vorschau der Abmeldebestätigung" sandbox></iframe></details></div></section><footer>BSV Nordstern e.V. Radolfzell<br><a href="https://bsvnordstern.de/impressum">Impressum</a> · <a href="https://bsvnordstern.de/datenschutz">Datenschutz</a></footer></main><script>
const target = (${resendUnsubscribeTarget.toString()})(location.hash);
const preview = new URLSearchParams(location.search).get('vorschau') === '1';
const form = document.querySelector('#unsubscribe'), button = document.querySelector('#confirm');
document.querySelector('#demo').hidden = !preview;
if (preview || target) button.disabled = false;
else {
  document.querySelector('#heading').textContent = 'Persönlicher Abmeldelink fehlt';
  document.querySelector('#intro').textContent = 'Bitte öffne den Abmeldelink direkt aus deiner Newsletter-E-Mail. Bei Fragen erreichst du uns unter info@bsvnordstern.de.';
  form.hidden = true;
}
form.addEventListener('submit', event => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  if (preview) {
    form.hidden = true;
    document.querySelector('#intro').hidden = true;
    document.querySelector('#heading').textContent = 'Du bist abgemeldet.';
    document.querySelector('#status').textContent = 'So sieht der Abschluss aus: Du erhältst keine weiteren Newsletter. Eine Bestätigung deiner Abmeldung kommt per E-Mail.';
    document.querySelector('#cancel').textContent = 'Zur Vereinswebsite';
    document.querySelector('#email-preview').hidden = false;
    document.querySelector('#email-preview iframe').srcdoc = ${JSON.stringify(email.html).replaceAll('<','\\u003c')};
  } else if (target) {
    document.querySelector('#status').textContent = 'Deine Abmeldung wird bei Resend bestätigt …';
    location.replace(target);
  }
});
</script></body></html>`;
}
