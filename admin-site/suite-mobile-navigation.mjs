export function createSuiteMobileNavigation({window: win, document: doc}) {
  const app = doc.querySelector('#app');
  const sidebar = doc.querySelector('.suite-sidebar');
  const trigger = doc.querySelector('#suiteMobileMenuButton');
  const dialog = doc.querySelector('#suiteMobileMenu');
  const mount = doc.querySelector('#suiteMobileMenuContent');
  const media = win.matchMedia('(max-width: 980px)');

  function close() { if (dialog.open) dialog.close(); }
  function sync() {
    const loggedIn = !app.classList.contains('hidden');
    trigger.hidden = !loggedIn;
    if (!media.matches || !loggedIn) close();
    if (media.matches) mount.append(sidebar);
    else if (sidebar.parentElement !== app) app.prepend(sidebar);
  }
  trigger.addEventListener('click', () => {
    if (!media.matches || trigger.hidden) return;
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    doc.documentElement.classList.add('suite-menu-open');
  });
  doc.querySelector('#closeSuiteMobileMenu').addEventListener('click', close);
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    doc.documentElement.classList.remove('suite-menu-open');
  });
  // Close before the action runs, so profile/install dialogs receive focus normally.
  dialog.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !sidebar.contains(button)) return;
    if (button.matches('[data-suite-area][aria-controls]')) return;
    close();
  }, true);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  media.addEventListener('change', sync);
  new win.MutationObserver(sync).observe(app, {attributes:true, attributeFilter:['class']});
  sync();
}
