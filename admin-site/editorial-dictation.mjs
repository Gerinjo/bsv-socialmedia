// Browser speech recognition starts only after an explicit microphone click.
export function createEditorialDictation({button, status, hint, textarea, onChange, onActiveChange, canStart, scope = window}) {
  const Recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  const supported = Boolean(Recognition && scope.isSecureContext);
  let enabled = true, session = null;
  hint.textContent = supported
    ? 'Deutsch diktieren: Der Text wird an der Cursorposition eingefügt. Je nach Browser verarbeitet dessen Spracherkennungsdienst die Audiodaten. Danach speichern & überarbeiten.'
    : 'Die Spracherkennung ist in diesem Browser nicht verfügbar. Bitte einen unterstützten Browser über HTTPS oder localhost verwenden; Texteingabe bleibt möglich.';
  function paint() {
    button.disabled = !supported || !enabled || Boolean(session?.stopping);
    button.setAttribute('aria-pressed', String(Boolean(session)));
    button.querySelector('span').textContent = session ? 'Diktat stoppen' : 'Diktieren';
  }
  function finish(current) {
    if (session !== current) return;
    clearTimeout(current.timer);
    session = null;
    onActiveChange(false);
    status.textContent = current.message || (current.inserted ? 'Diktat eingefügt. Bitte prüfen und speichern & überarbeiten.' : 'Kein Text erkannt. Du kannst das Diktat erneut starten.');
    paint();
  }
  function stop() {
    const current = session;
    if (!current || current.stopping) return;
    current.stopping = true;
    status.textContent = 'Diktat wird abgeschlossen …';
    paint();
    current.timer = setTimeout(() => {
      if (session !== current) return;
      current.message ||= 'Diktat beendet. Bereits eingefügter Text bleibt erhalten.';
      current.recognition.abort();
      finish(current);
    }, 5000);
    try { current.recognition.stop(); } catch { finish(current); }
  }
  function reset() {
    if (session) {
      const current = session;
      session = null;
      clearTimeout(current.timer);
      current.recognition.abort();
      onActiveChange(false);
    }
    status.textContent = '';
    paint();
  }
  button.onclick = () => {
    if (session) { stop(); return; }
    if (!supported || !enabled || !canStart()) return;
    let recognition;
    try { recognition = new Recognition(); }
    catch { status.textContent = 'Die Spracherkennung konnte nicht gestartet werden.'; return; }
    const current = {recognition, cursor: textarea.selectionStart ?? textarea.value.length, processed: new Set(), inserted: false, stopping: false};
    recognition.lang = 'de-DE';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (session === current && !current.stopping) status.textContent = 'Mikrofon aktiv – du kannst jetzt sprechen.';
    };
    recognition.onresult = event => {
      if (session !== current || current.message) return;
      const interim = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i], text = String(result[0]?.transcript || '').trim();
        if (!result.isFinal) { if (text) interim.push(text); continue; }
        if (current.processed.has(i)) continue;
        current.processed.add(i);
        if (!text) continue;
        const left = textarea.value.slice(0,current.cursor), right = textarea.value.slice(current.cursor);
        const leading = left && !/\s$/.test(left) && !/^[,.;:!?]/.test(text) ? ' ' : '';
        const trailing = right && !/^[\s,.;:!?]/.test(right) ? ' ' : '';
        const inserted = leading + text + trailing;
        if (textarea.value.length + inserted.length > (textarea.maxLength > 0 ? textarea.maxLength : 30000)) {
          current.message = 'Die maximale Textlänge ist erreicht. Bitte den Beitrag kürzen; der letzte Diktatabschnitt wurde nicht eingefügt.';
          stop();
          break;
        }
        textarea.setRangeText(inserted,current.cursor,current.cursor,'end');
        current.cursor += leading.length + text.length;
        current.inserted = true;
        onChange();
      }
      if (!current.stopping) status.textContent = interim.length ? `Erkannt: ${interim.join(' ')}` : 'Mikrofon aktiv – du kannst weiter sprechen.';
    };
    recognition.onerror = event => {
      if (session !== current) return;
      current.message = ({'not-allowed':'Mikrofonzugriff wurde nicht erlaubt. Bitte die Browserberechtigung prüfen.', 'service-not-allowed':'Der Browser erlaubt diesen Spracherkennungsdienst nicht.', 'audio-capture':'Kein verfügbares Mikrofon gefunden. Bitte das Eingabegerät prüfen.', 'network':'Spracherkennung nicht erreichbar. Bitte die Internetverbindung prüfen.', 'no-speech':'Keine Sprache erkannt. Bitte das Diktat erneut starten.', 'language-not-supported':'Deutsch wird von diesem Spracherkennungsdienst nicht unterstützt.', 'aborted':'Diktat beendet.'})[event.error] || 'Die Spracherkennung wurde unterbrochen. Bereits eingefügter Text bleibt erhalten.';
      recognition.abort();
      finish(current);
    };
    recognition.onend = () => finish(current);
    session = current;
    onActiveChange(true);
    paint();
    status.textContent = 'Mikrofon wird gestartet …';
    try { recognition.start(); }
    catch { current.message = 'Das Mikrofon konnte nicht gestartet werden. Bitte Browserberechtigung und Eingabegerät prüfen.'; finish(current); }
  };
  paint();
  return {get active() {return Boolean(session);}, stop, reset, setEnabled(value) {enabled = value; paint();}};
}
