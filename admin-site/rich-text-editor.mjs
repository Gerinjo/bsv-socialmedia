const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const boldAlphabet = [
  ...Array.from({ length: 26 }, (_, index) => String.fromCodePoint(0x1d400 + index)),
  ...Array.from({ length: 26 }, (_, index) => String.fromCodePoint(0x1d41a + index)),
].join('');
const italicAlphabet = [
  ...Array.from({ length: 26 }, (_, index) => String.fromCodePoint(0x1d434 + index)),
  ...Array.from({ length: 26 }, (_, index) => String.fromCodePoint(index === 7 ? 0x210e : 0x1d44e + index)),
].join('');
const digits = '0123456789';
const boldDigits = Array.from({ length: 10 }, (_, index) => String.fromCodePoint(0x1d7ce + index)).join('');

function characterMap(source, target) {
  const values = Array.from(target);
  return new Map(Array.from(source).map((character, index) => [character, values[index]]));
}

const styleMaps = {
  bold: new Map([...characterMap(alphabet, boldAlphabet), ...characterMap(digits, boldDigits)]),
  italic: characterMap(alphabet, italicAlphabet),
};

export const reportEmojis = ['⚽', '💚', '🤍', '💛', '🔥', '💪', '🙌', '👏', '🎉', '🏆', '✅', '📸', '📣', '⭐'];

export function stylizeReportText(value, style) {
  const map = styleMaps[style];
  if (!map) return String(value ?? '');
  return Array.from(String(value ?? '')).map(character => {
    const [base, ...marks] = Array.from(character.normalize('NFD'));
    return `${map.get(base) ?? base}${marks.join('')}`;
  }).join('');
}

export function bulletReportText(value) {
  return String(value ?? '').split('\n').map(line => {
    if (!line.trim()) return line;
    return `• ${line.replace(/^\s*[•-]\s*/, '')}`;
  }).join('\n');
}

function selectedWord(textarea) {
  let start = textarea.selectionStart;
  let end = textarea.selectionEnd;
  if (start !== end) return { start, end };
  while (start > 0 && !/\s/.test(textarea.value[start - 1])) start -= 1;
  while (end < textarea.value.length && !/\s/.test(textarea.value[end])) end += 1;
  return { start, end };
}

function selectedLines(textarea) {
  const start = textarea.value.lastIndexOf('\n', Math.max(0, textarea.selectionStart - 1)) + 1;
  const nextBreak = textarea.value.indexOf('\n', textarea.selectionEnd);
  return { start, end: nextBreak < 0 ? textarea.value.length : nextBreak };
}

function replaceSelection(textarea, replacement, start = textarea.selectionStart, end = textarea.selectionEnd, mode = 'select') {
  textarea.focus();
  textarea.setRangeText(replacement, start, end, mode);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function toolbarButton(text, title, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.dataset.editorAction = action;
  return button;
}

function applyFormat(textarea, style) {
  const range = selectedWord(textarea);
  if (range.start === range.end) return;
  replaceSelection(textarea, stylizeReportText(textarea.value.slice(range.start, range.end), style), range.start, range.end);
}

function applyBullets(textarea) {
  const range = selectedLines(textarea);
  replaceSelection(textarea, bulletReportText(textarea.value.slice(range.start, range.end)), range.start, range.end);
}

function changeEditorHeight(textarea, delta) {
  const height = Math.max(180, Math.min(720, textarea.offsetHeight + delta));
  textarea.style.height = `${height}px`;
  localStorage.setItem('bsv-report-editor-height', String(height));
}

export function wireRichTextEditors(root = document) {
  root.querySelectorAll('textarea.rich-report-field:not([data-rich-editor])').forEach(textarea => {
    textarea.dataset.richEditor = 'true';
    const editor = document.createElement('div');
    editor.className = 'rich-text-editor';
    const toolbar = document.createElement('div');
    toolbar.className = 'rich-text-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Spielbericht formatieren');
    toolbar.append(
      toolbarButton('B', 'Auswahl fett formatieren', 'bold'),
      toolbarButton('I', 'Auswahl kursiv formatieren', 'italic'),
      toolbarButton('• Liste', 'Auswahl als Aufzählung formatieren', 'bullets'),
    );
    const emoji = document.createElement('select');
    emoji.className = 'rich-emoji-picker';
    emoji.setAttribute('aria-label', 'Emoji einfügen');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Emoji 😊';
    emoji.append(placeholder, ...reportEmojis.map(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      return option;
    }));
    toolbar.append(
      emoji,
      toolbarButton('−', 'Editor niedriger machen', 'smaller'),
      toolbarButton('+', 'Editor höher machen', 'larger'),
    );
    const hint = document.createElement('div');
    hint.className = 'rich-editor-hint';
    hint.textContent = 'Text markieren und formatieren · Höhe mit −/+ oder am unteren Rand ändern';
    textarea.parentNode.insertBefore(editor, textarea);
    editor.append(toolbar, textarea, hint);

    const storedHeight = Number(localStorage.getItem('bsv-report-editor-height'));
    if (Number.isFinite(storedHeight) && storedHeight >= 180 && storedHeight <= 720) textarea.style.height = `${storedHeight}px`;
    toolbar.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.editorAction;
      if (action === 'bold' || action === 'italic') applyFormat(textarea, action);
      if (action === 'bullets') applyBullets(textarea);
      if (action === 'smaller') changeEditorHeight(textarea, -80);
      if (action === 'larger') changeEditorHeight(textarea, 80);
    });
    emoji.addEventListener('change', () => {
      if (emoji.value) replaceSelection(textarea, emoji.value, textarea.selectionStart, textarea.selectionEnd, 'end');
      emoji.value = '';
    });
    textarea.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const style = event.key.toLocaleLowerCase('de-DE') === 'b' ? 'bold' : event.key.toLocaleLowerCase('de-DE') === 'i' ? 'italic' : '';
      if (!style) return;
      event.preventDefault();
      applyFormat(textarea, style);
    });
    textarea.addEventListener('pointerup', () => {
      if (textarea.offsetHeight >= 180) localStorage.setItem('bsv-report-editor-height', String(Math.min(720, textarea.offsetHeight)));
    });
  });
}
