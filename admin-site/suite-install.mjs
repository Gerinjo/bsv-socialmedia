export function suiteInstallInstructions(navigator, secureContext) {
  if (!secureContext) return {
    intro: 'Öffne die Suite über ihre HTTPS-Adresse, um sie als App zu installieren.',
    steps: ['Öffne die Online-Adresse der Suite in deinem Browser.', 'Wähle dort erneut „App installieren“.'],
  };
  const appleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (appleMobile) return {
    intro: 'Auf dem iPhone oder iPad fügst du die Suite über das Teilen-Menü hinzu.',
    steps: ['Öffne die Suite in Safari.', 'Tippe auf „Teilen“ und dann auf „Zum Home-Bildschirm“.', 'Aktiviere „Als Web-App öffnen“, falls angezeigt, und bestätige mit „Hinzufügen“.'],
  };
  if (/Android/i.test(navigator.userAgent || '')) return {
    intro: 'Installiere die Suite über das Menü deines Browsers.',
    steps: ['Öffne das Browsermenü (⋮).', 'Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.', 'Bestätige die Installation. Danach öffnest du die Suite über ihr App-Symbol.'],
  };
  return {
    intro: 'Installiere die Suite über das Menü oder das Installationssymbol in der Adressleiste.',
    steps: ['In Chrome oder Edge: Öffne das Browsermenü und wähle „BSV Suite installieren“ oder „Diese Seite als App installieren“.', 'Auf dem Mac in Safari: Wähle „Ablage“ → „Zum Dock hinzufügen“.', 'Bestätige die Installation und öffne die Suite anschließend über ihr App-Symbol.'],
  };
}

// Independent of login: capture the browser's one-use prompt before the SDK loads.
export function createSuiteInstaller({ window: target, document: doc }) {
  const buttons = [...doc.querySelectorAll('[data-suite-install]')];
  const labels = [...doc.querySelectorAll('[data-suite-install-title]')];
  const statusNodes = [...doc.querySelectorAll('[data-suite-install-status]')];
  const dialog = doc.querySelector('#suiteInstallDialog');
  const action = doc.querySelector('#suiteInstallAction');
  const actionLabel = doc.querySelector('#suiteInstallActionLabel');
  const guides = doc.querySelector('#suiteInstallGuides');
  const displayMode = target.matchMedia('(display-mode: standalone)');
  const appleMobile = /iPad|iPhone|iPod/i.test(target.navigator.userAgent || '') || (target.navigator.platform === 'MacIntel' && target.navigator.maxTouchPoints > 1);
  const platform = appleMobile ? 'apple' : /Android/i.test(target.navigator.userAgent || '') ? 'android' : 'desktop';
  for (const guide of doc.querySelectorAll('[data-suite-install-guide]')) guide.open = guide.dataset.suiteInstallGuide === platform;
  let deferredPrompt = null, busy = false, installed = false, message = '';
  const standalone = () => installed || displayMode.matches || target.navigator.standalone === true;
  const update = () => {
    const ready = standalone();
    for (const label of labels) label.textContent = ready ? 'App installiert' : 'App installieren';
    for (const button of buttons) {
      button.disabled = busy;
      button.setAttribute('aria-label', ready ? 'Installierte App' : 'App installieren');
      button.setAttribute('title', ready ? 'Installierte App' : 'App installieren');
    }
    action.hidden = ready || !deferredPrompt;
    action.classList.toggle('hidden', action.hidden);
    action.disabled = busy;
    action.setAttribute('aria-busy', String(busy));
    actionLabel.textContent = busy ? 'Installation läuft …' : 'Jetzt installieren';
    guides.hidden = ready;
    guides.classList.toggle('hidden', ready);
    doc.querySelector('#suiteInstallTitle').textContent = ready ? 'Deine BSV Suite' : 'BSV Suite als App installieren';
    const text = ready ? 'Die BSV Suite ist bereit. Öffne sie über das grüne BSV-Symbol auf deinem Startbildschirm oder in deiner App-Liste.' : message || (!target.isSecureContext ? suiteInstallInstructions(target.navigator, false).intro : 'Wähle die Anleitung für dein Gerät. Öffne diese Seite dafür direkt im Browser, zum Beispiel außerhalb von WhatsApp oder Instagram.');
    statusNodes.forEach(node => { node.textContent = text; });
  };
  const status = text => { message = text; update(); };
  function showInstructions() {
    update();
    if (!dialog.open) dialog.showModal();
  }
  async function install() {
    if (busy || standalone()) return;
    if (!deferredPrompt) { showInstructions(); return; }
    // Browsers permit this event to be used once, including after dismissal.
    const prompt = deferredPrompt;
    deferredPrompt = null;
    busy = true; update();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      status(choice?.outcome === 'accepted' ? 'Die Installation wurde gestartet. Öffne die Suite anschließend über ihr App-Symbol.' : 'Installation abgebrochen. Du kannst die App jederzeit über das Browser-Menü installieren. Die Anleitung findest du unten.');
    } catch {
      status('Das Installationsfenster konnte nicht geöffnet werden. Nutze die Anleitung für dein Gerät oder das Browsermenü.');
      showInstructions();
    } finally { busy = false; update(); }
  }
  const onPrompt = event => { if (standalone()) return; event.preventDefault(); deferredPrompt = event; message = ''; update(); };
  const onInstalled = () => { installed = true; deferredPrompt = null; update(); };
  target.addEventListener('beforeinstallprompt', onPrompt);
  target.addEventListener('appinstalled', onInstalled);
  displayMode.addEventListener('change', update);
  buttons.forEach(button => button.addEventListener('click', showInstructions));
  action.addEventListener('click', install);
  doc.querySelector('#closeSuiteInstall').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  if (target.isSecureContext && 'serviceWorker' in target.navigator) target.navigator.serviceWorker.register('/suite-sw.js', { scope: '/' }).catch(() => {});
  update();
  return { install, showInstructions };
}
