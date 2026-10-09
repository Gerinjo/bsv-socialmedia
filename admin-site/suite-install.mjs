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
  const entries = [...doc.querySelectorAll('[data-suite-install-entry]')];
  const statusNodes = [...doc.querySelectorAll('[data-suite-install-status]')];
  const dialog = doc.querySelector('#suiteInstallDialog');
  const displayMode = target.matchMedia('(display-mode: standalone)');
  let deferredPrompt = null, busy = false, installed = false;
  const standalone = () => installed || displayMode.matches || target.navigator.standalone === true;
  const update = () => {
    for (const node of [...buttons, ...entries]) {
      node.hidden = standalone();
      node.classList.toggle('hidden', node.hidden);
    }
    for (const button of buttons) button.disabled = busy;
  };
  const status = message => statusNodes.forEach(node => { node.textContent = message; });
  function showInstructions(message = '') {
    const instructions = suiteInstallInstructions(target.navigator, target.isSecureContext);
    doc.querySelector('#suiteInstallIntro').textContent = instructions.intro;
    const steps = doc.querySelector('#suiteInstallSteps');
    steps.replaceChildren(...instructions.steps.map(text => { const li = doc.createElement('li'); li.textContent = text; return li; }));
    status(message);
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
      if (dialog.open) dialog.close();
      await prompt.prompt();
      const choice = await prompt.userChoice;
      status(choice?.outcome === 'accepted' ? 'Installation bestätigt. Öffne die Suite anschließend über ihr App-Symbol.' : 'Installation abgebrochen. Du kannst sie später erneut starten.');
    } catch {
      showInstructions('Das Installationsfenster konnte nicht geöffnet werden. Nutze das Browsermenü.');
    } finally { busy = false; update(); }
  }
  const onPrompt = event => { event.preventDefault(); deferredPrompt = event; update(); };
  const onInstalled = () => { installed = true; deferredPrompt = null; status('Die Suite wurde als App installiert.'); if (dialog.open) dialog.close(); update(); };
  target.addEventListener('beforeinstallprompt', onPrompt);
  target.addEventListener('appinstalled', onInstalled);
  displayMode.addEventListener('change', update);
  buttons.forEach(button => button.addEventListener('click', install));
  doc.querySelector('#closeSuiteInstall').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  if (target.isSecureContext && 'serviceWorker' in target.navigator) target.navigator.serviceWorker.register('/suite-sw.js', { scope: '/' }).catch(() => {});
  update();
  return { install };
}
