(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const app = $('#app');
  const editor = $('#editor');
  const sourceEditor = $('#sourceEditor');
  const markdWrap = $('#markdWrap');
  const fileName = $('#fileName');
  const fileInput = $('#fileInput');
  const saveState = $('#saveState');
  const STORAGE_KEY = 'markd-markdown-documents-v1';
  const SETTINGS_KEY = 'markd-markdown-settings-v1';

  let state = {
    markdown: '', fileHandle: null, dirty: false, sourceMode: false,
    currentId: null, pendingAction: null, saveTimer: null
  };
  let activeSourceBlock = null;
  let paletteContext = null;
  let filteredCommands = [];
  let selectedCommand = 0;
  const WELCOME_VERSION = '6';

  const starter = `# Benvenuto in markd

markd è un editor **Markdown** minimale: tutto resta nel browser o nei file che scegli di aprire.

## Modifica contestuale

Seleziona un blocco per vedere e modificare il suo codice Markdown. Quando passi a un altro blocco, il contenuto torna automaticamente formattato. Usa **Freccia su/giù** ai confini del testo oppure **Alt + Freccia su/giù** per muoverti tra i blocchi senza usare il mouse.

## Comandi rapidi

Digita **/** all’inizio di una riga vuota per aprire i comandi. Puoi anche usare **⌘/Ctrl + Shift + P** da qualsiasi punto. Scrivi il nome di un comando, spostati con le frecce e premi Invio.

## Sintassi essenziale

- \`# Titolo\`, \`## Sottotitolo\`, \`### Sezione\`
- \`**grassetto**\` e \`*corsivo*\`
- \`\`codice inline\`\` e \`~~testo barrato~~\`
- \`- elemento\`, \`1. elemento\` e \`- [ ] attività\`
- \`> citazione\` e \`---\` per un separatore
- \`[testo](https://esempio.it)\` per un collegamento
- Tre backtick per un blocco di codice

> Suggerimento: premi Invio dopo un elemento di lista per crearne un altro; Invio su un elemento vuoto termina la lista.

## Scorciatoie da tastiera

| Scorciatoia | Azione |
| --- | --- |
| ⌘/Ctrl + N | Nuovo documento |
| ⌘/Ctrl + O | Apri file |
| ⌘/Ctrl + S | Salva |
| ⌘/Ctrl + Shift + E | Esporta HTML |
| ⌘/Ctrl + F | Trova |
| ⌘/Ctrl + Shift + L | Mostra o nasconde la sidebar |
| ⌘/Ctrl + Shift + P oppure F1 | Apre i comandi |
| F2 | Rinomina il documento |
| ⌘/Ctrl + / | Mostra il sorgente completo |
| ⌘/Ctrl + B | Grassetto |
| ⌘/Ctrl + I | Corsivo |
| ⌘/Ctrl + K | Collegamento |
| ⌘/Ctrl + 1, 2, 3 | Titolo 1, 2, 3 |
| ⌘/Ctrl + Shift + 7 | Elenco numerato |
| ⌘/Ctrl + Shift + 8 | Elenco puntato |
| Alt + Freccia su/giù | Blocco precedente o successivo |
| ⌘/Ctrl + Invio | Conferma il blocco e passa al successivo |
| Esc | Chiude il comando o conferma il blocco |

## File e privacy

Apri, salva ed esporta dalla sidebar, visibile avvicinandoti al bordo sinistro. Una copia automatica viene conservata localmente; nessun testo viene inviato a server esterni.
`;

  function escapeHtml(value = '') {
    return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function safeUrl(url) {
    const decoded = url.trim().replace(/&amp;/g, '&');
    return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(decoded) ? escapeHtml(decoded) : '#';
  }

  function inlineMarkdown(text) {
    let value = escapeHtml(text);
    const code = [];
    value = value.replace(/`([^`]+)`/g, (_, content) => {
      code.push(`<code>${content}</code>`);
      return `\u0000CODE${code.length - 1}\u0000`;
    });
    value = value.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g,
      (_, alt, url, title) => `<img src="${safeUrl(url)}" alt="${alt}"${title ? ` title="${title}"` : ''}>`);
    value = value.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g,
      (_, label, url, title) => `<a href="${safeUrl(url)}"${title ? ` title="${title}"` : ''}>${label}</a>`);
    value = value.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong>$1$2</strong>');
    value = value.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    value = value.replace(/(^|[^*])\*([^*\n]+)\*|(^|[^_])_([^_\n]+)_/g, (_, a, b, c, d) => `${a || c}<em>${b || d}</em>`);
    value = value.replace(/ {2}$/g, '<br>');
    value = value.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
    return value;
  }

  function isBlockStart(lines, i) {
    const line = lines[i] || '';
    const next = lines[i + 1] || '';
    return /^\s*(#{1,6})\s+/.test(line) || /^\s*(```|~~~)/.test(line) || /^\s*>/.test(line) ||
      /^\s*([-+*]|\d+\.)\s+/.test(line) || /^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line) ||
      (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(next));
  }

  function markdownToHtml(markdown) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let i = 0;

    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) {
        html.push(`<div class="frontmatter">${escapeHtml(lines.slice(1, end).join('\n'))}</div>`);
        i = end + 1;
      }
    }

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      const fence = line.match(/^\s*(```|~~~)\s*([^\s]*)/);
      if (fence) {
        const marker = fence[1];
        const lang = fence[2] || '';
        const content = [];
        i++;
        while (i < lines.length && !new RegExp(`^\\s*${marker}`).test(lines[i])) content.push(lines[i++]);
        if (i < lines.length) i++;
        html.push(`<pre${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(content.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); i++; continue;
      }

      if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
        html.push('<hr>'); i++; continue;
      }

      if (/^\s*>/.test(line)) {
        const quote = [];
        while (i < lines.length && (/^\s*>/.test(lines[i]) || !lines[i].trim())) {
          quote.push(lines[i].replace(/^\s*>\s?/, '')); i++;
        }
        html.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`); continue;
      }

      const listMatch = line.match(/^\s*([-+*]|\d+\.)\s+(.+)/);
      if (listMatch) {
        const ordered = /\d+\./.test(listMatch[1]);
        const tag = ordered ? 'ol' : 'ul';
        const items = [];
        while (i < lines.length) {
          const match = lines[i].match(/^\s*([-+*]|\d+\.)\s+(.+)/);
          if (!match || (/\d+\./.test(match[1]) !== ordered)) break;
          let item = match[2];
          const task = item.match(/^\[([ xX])\]\s*(.*)/);
          if (task) item = `<input type="checkbox"${task[1].toLowerCase() === 'x' ? ' checked' : ''}>${inlineMarkdown(task[2])}`;
          else item = inlineMarkdown(item);
          items.push(`<li${task ? ' class="task-list-item"' : ''}>${item}</li>`); i++;
        }
        html.push(`<${tag}>${items.join('')}</${tag}>`); continue;
      }

      if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
        const splitRow = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const heads = splitRow(line); i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
        html.push(`<table><thead><tr>${heads.map(x => `<th>${inlineMarkdown(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(x => `<td>${inlineMarkdown(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }

      const paragraph = [line]; i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) paragraph.push(lines[i++]);
      html.push(`<p>${inlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }
    return html.join('\n');
  }

  function inlineToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\u00a0/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const inner = [...node.childNodes].map(inlineToMarkdown).join('');
    switch (node.tagName) {
      case 'STRONG': case 'B': return `**${inner}**`;
      case 'EM': case 'I': return `*${inner}*`;
      case 'S': case 'STRIKE': return `~~${inner}~~`;
      case 'CODE': return node.parentElement?.tagName === 'PRE' ? inner : `\`${inner}\``;
      case 'A': return `[${inner}](${node.getAttribute('href') || ''}${node.title ? ` "${node.title}"` : ''})`;
      case 'IMG': return `![${node.alt || ''}](${node.getAttribute('src') || ''}${node.title ? ` "${node.title}"` : ''})`;
      case 'BR': return '  \n';
      default: return inner;
    }
  }

  function sourceBlockText(node) {
    const text = 'value' in node ? node.value : (node.innerText ?? node.textContent);
    return text.replace(/\u00a0/g, ' ').replace(/\n$/, '');
  }

  function editorToMarkdown(root = editor) {
    const blocks = [];
    const block = node => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.trim() ? node.nodeValue : '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName;
      if (node.classList.contains('md-source-block')) return sourceBlockText(node);
      if (node.classList.contains('frontmatter')) return `---\n${node.textContent}\n---`;
      if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineToMarkdown(node)}`;
      if (tag === 'P' || tag === 'DIV') return inlineToMarkdown(node);
      if (tag === 'HR') return '---';
      if (tag === 'PRE') return `\`\`\`${node.dataset.lang || ''}\n${node.textContent.replace(/\n$/, '')}\n\`\`\``;
      if (tag === 'BLOCKQUOTE') return editorToMarkdown(node).split('\n').map(x => x ? `> ${x}` : '>').join('\n');
      if (tag === 'UL' || tag === 'OL') {
        return [...node.children].filter(x => x.tagName === 'LI').map((li, index) => {
          const checkbox = $('input[type="checkbox"]', li);
          const clone = li.cloneNode(true);
          clone.querySelectorAll('ul,ol').forEach(x => x.remove());
          clone.querySelectorAll('input').forEach(x => x.remove());
          const prefix = tag === 'OL' ? `${index + 1}.` : '-';
          return `${prefix} ${checkbox ? `[${checkbox.checked ? 'x' : ' '}] ` : ''}${inlineToMarkdown(clone).trim()}`;
        }).join('\n');
      }
      if (tag === 'TABLE') {
        const rows = [...node.rows].map(row => [...row.cells].map(cell => inlineToMarkdown(cell).replace(/\|/g, '\\|').trim()));
        if (!rows.length) return '';
        return `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |${rows.slice(1).map(row => `\n| ${row.join(' | ')} |`).join('')}`;
      }
      return inlineToMarkdown(node);
    };
    [...root.childNodes].forEach(node => {
      const result = block(node);
      if (result !== '') blocks.push(result);
    });
    return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  function currentMarkdown() {
    return state.sourceMode ? sourceEditor.value : editorToMarkdown();
  }

  function markdownForBlock(block) {
    const holder = document.createElement('div');
    holder.append(block.cloneNode(true));
    return editorToMarkdown(holder);
  }

  function resizeSourceBlock(source) {
    source.style.height = '0';
    source.style.height = `${Math.max(source.scrollHeight, 31)}px`;
  }

  function placeCaretInSource(source, x, y) {
    source.focus();
    let offset = source.value.length;
    if (x >= 0 && y >= 0) {
      const style = getComputedStyle(source); const rect = source.getBoundingClientRect();
      const lines = source.value.split('\n'); const lineHeight = parseFloat(style.lineHeight) || 24;
      const lineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor((y - rect.top - parseFloat(style.paddingTop)) / lineHeight)));
      const targetX = Math.max(0, x - rect.left - parseFloat(style.paddingLeft));
      const context = document.createElement('canvas').getContext('2d'); context.font = style.font;
      let column = lines[lineIndex].length;
      for (let i = 0; i < lines[lineIndex].length; i++) {
        if (context.measureText(lines[lineIndex].slice(0, i + 1)).width > targetX) { column = i; break; }
      }
      offset = lines.slice(0, lineIndex).reduce((total, line) => total + line.length + 1, 0) + column;
    }
    source.setSelectionRange(offset, offset);
  }

  function moveToAdjacentBlock(direction, createIfMissing = false) {
    const source = activeSourceBlock;
    if (!source) return;
    let target = direction < 0 ? source.previousElementSibling : source.nextElementSibling;
    if (!target && createIfMissing && direction > 0) {
      target = document.createElement('p'); target.append(document.createElement('br')); source.after(target);
    }
    if (!target) return;
    commitActiveBlock();
    if (!target.isConnected) return;
    activateSourceBlock(target);
    requestAnimationFrame(() => {
      if (!activeSourceBlock) return;
      const offset = direction < 0 ? activeSourceBlock.value.length : 0;
      activeSourceBlock.setSelectionRange(offset, offset);
      activeSourceBlock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function handleSourceBlockKeydown(event) {
    const source = event.currentTarget; const start = source.selectionStart; const end = source.selectionEnd;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); commitActiveBlock(); editor.focus(); return;
    }
    if ((event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) ||
        (event.key === 'ArrowUp' && start === 0 && end === 0) ||
        (event.key === 'ArrowDown' && start === source.value.length && end === source.value.length)) {
      event.preventDefault(); event.stopPropagation(); moveToAdjacentBlock(event.key === 'ArrowUp' ? -1 : 1, event.key === 'ArrowDown'); return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault(); event.stopPropagation(); moveToAdjacentBlock(1, true); return;
    }
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && source.value.slice(0, start).split('\n').pop().trim() === '') {
      event.preventDefault(); event.stopPropagation(); showCommandPalette(); return;
    }
    if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey) return;
    const currentLine = source.value.slice(0, start).split('\n').pop();
    const unordered = currentLine.match(/^(\s*)([-+*])\s+(.*)$/);
    const ordered = currentLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
    const match = unordered || ordered;
    if (!match) return;
    event.preventDefault(); event.stopPropagation();
    let inserted;
    if (!match[3]) {
      inserted = '\n'; source.setRangeText(inserted, start - currentLine.length, end, 'end');
    } else {
      const prefix = unordered ? `${match[1]}${match[2]} ` : `${match[1]}${Number(match[2]) + 1}. `;
      inserted = `\n${prefix}`; source.setRangeText(inserted, start, end, 'end');
    }
    source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: inserted }));
  }

  function activateSourceBlock(block, pointer = null) {
    if (state.sourceMode || !block || block === activeSourceBlock || block.parentElement !== editor) return;
    commitActiveBlock();
    const source = document.createElement('textarea');
    source.className = 'md-source-block';
    source.setAttribute('spellcheck', 'true');
    source.dataset.block = block.tagName.toLowerCase();
    source.value = markdownForBlock(block);
    source.addEventListener('keydown', handleSourceBlockKeydown);
    source.addEventListener('input', () => resizeSourceBlock(source));
    block.replaceWith(source);
    activeSourceBlock = source;
    resizeSourceBlock(source);
    requestAnimationFrame(() => placeCaretInSource(source, pointer?.x ?? -1, pointer?.y ?? -1));
  }

  function commitActiveBlock() {
    const source = activeSourceBlock;
    if (!source) return;
    activeSourceBlock = null;
    if (!source.isConnected) return;
    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(sourceBlockText(source));
    const nodes = [...container.childNodes];
    if (!nodes.length) {
      const paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); nodes.push(paragraph);
    }
    source.replaceWith(...nodes);
    updateOutline();
  }

  function loadMarkdown(markdown, name = 'Senza titolo', options = {}) {
    state.markdown = markdown;
    activeSourceBlock = null;
    state.fileHandle = options.handle || null;
    state.currentId = options.id || crypto.randomUUID?.() || String(Date.now());
    state.dirty = false;
    editor.innerHTML = markdownToHtml(markdown);
    sourceEditor.value = markdown;
    fileName.value = name.replace(/\.(md|markdown|txt)$/i, '');
    document.title = `${fileName.value} — markd`;
    app.classList.remove('dirty');
    updateStats(); updateOutline(); persistLocal(false); renderRecents();
    saveState.textContent = 'Pronto';
    requestAnimationFrame(() => editor.focus());
  }

  function changed() {
    state.dirty = true;
    state.markdown = currentMarkdown();
    app.classList.add('dirty');
    saveState.textContent = 'Modificato';
    document.title = `• ${fileName.value || 'Senza titolo'} — markd`;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { persistLocal(true); updateStats(); updateOutline(); }, 450);
  }

  function getStoredDocs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }

  function persistLocal(showStatus = true) {
    if (!state.currentId) return;
    const docs = getStoredDocs().filter(d => d.id !== state.currentId);
    docs.unshift({ id: state.currentId, name: fileName.value || 'Senza titolo', markdown: currentMarkdown(), updated: Date.now() });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(docs.slice(0, 10)));
      if (showStatus) { saveState.textContent = 'Copia locale salvata'; $('#storageStatus').innerHTML = '<i class="status-dot"></i> Salvato in locale'; }
      renderRecents();
    } catch { $('#storageStatus').textContent = 'Spazio locale esaurito'; }
  }

  function renderRecents() {
    const container = $('#recentFiles');
    const docs = getStoredDocs();
    if (!docs.length) { container.innerHTML = '<div class="empty-state">I documenti aperti di recente<br>appariranno qui.</div>'; return; }
    container.innerHTML = docs.map(doc => `<div class="recent-item${doc.id === state.currentId ? ' active' : ''}" data-id="${escapeHtml(doc.id)}" role="button" tabindex="0">
      <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h5"/></svg>
      <div class="recent-meta"><div class="recent-name">${escapeHtml(doc.name)}</div><div class="recent-date">${relativeDate(doc.updated)}</div></div>
      <button class="recent-remove" aria-label="Rimuovi">×</button></div>`).join('');
  }

  function relativeDate(time) {
    const seconds = Math.floor((Date.now() - time) / 1000);
    if (seconds < 60) return 'adesso';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min fa`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h fa`;
    return new Intl.DateTimeFormat('it', { day: 'numeric', month: 'short' }).format(time);
  }

  function updateStats() {
    const text = currentMarkdown().replace(/```[\s\S]*?```|[#>*_`~\[\]()|\-]/g, ' ').trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.replace(/\s/g, '').length;
    $('#wordCount').textContent = `${words} ${words === 1 ? 'parola' : 'parole'} · ${chars} caratteri`;
  }

  function updateOutline() {
    if (state.sourceMode) {
      const headings = [...sourceEditor.value.matchAll(/^(#{1,6})\s+(.+)$/gm)];
      $('#outline').innerHTML = headings.length ? headings.map((m, i) => `<a href="#" class="level-${m[1].length}" data-source-line="${sourceEditor.value.slice(0, m.index).split('\n').length}">${escapeHtml(m[2].replace(/[*_`]/g, ''))}</a>`).join('') : '<div class="outline-empty">Aggiungi un titolo per creare l’indice.</div>';
      return;
    }
    const headings = $$('h1,h2,h3,h4,h5,h6', editor);
    headings.forEach((h, i) => h.id = `heading-${i}`);
    $('#outline').innerHTML = headings.length ? headings.map(h => `<a href="#${h.id}" class="level-${h.tagName[1]}">${escapeHtml(h.textContent)}</a>`).join('') : '<div class="outline-empty">Aggiungi un titolo per creare l’indice.</div>';
  }

  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  async function openFile() {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] } }], multiple: false });
        const file = await handle.getFile();
        loadMarkdown(await file.text(), file.name, { handle });
      } else fileInput.click();
    } catch (error) { if (error.name !== 'AbortError') toast('Impossibile aprire il file'); }
  }

  async function saveFile() {
    let markdown = currentMarkdown();
    let name = (fileName.value.trim() || 'Senza titolo').replace(/\.(md|markdown)$/i, '') + '.md';
    try {
      if (state.fileHandle) {
        const writable = await state.fileHandle.createWritable();
        await writable.write(markdown); await writable.close();
      } else if ('showSaveFilePicker' in window) {
        state.fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] });
        const writable = await state.fileHandle.createWritable();
        await writable.write(markdown); await writable.close();
      } else {
        downloadBlob(markdown, name, 'text/markdown');
      }
      state.markdown = markdown; state.dirty = false; app.classList.remove('dirty');
      document.title = `${fileName.value} — markd`; saveState.textContent = 'Salvato'; persistLocal(false); toast('Documento salvato');
      return true;
    } catch (error) { if (error.name !== 'AbortError') toast('Salvataggio non riuscito'); return false; }
  }

  function downloadBlob(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function requestAction(action) {
    if (!state.dirty) return action();
    state.pendingAction = action; $('#confirmDialog').hidden = false;
  }

  function newDocument() { loadMarkdown('', 'Senza titolo'); }

  function toggleSource(force) {
    const shouldEnable = typeof force === 'boolean' ? force : !state.sourceMode;
    if (shouldEnable === state.sourceMode) return;
    if (shouldEnable) { commitActiveBlock(); sourceEditor.value = editorToMarkdown(); editor.hidden = true; sourceEditor.hidden = false; }
    else { editor.innerHTML = markdownToHtml(sourceEditor.value); sourceEditor.hidden = true; editor.hidden = false; }
    state.sourceMode = shouldEnable; app.classList.toggle('source-mode', shouldEnable);
    updateStats(); updateOutline(); (shouldEnable ? sourceEditor : editor).focus();
  }

  function applyInlineTag(tag) {
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return toast('Seleziona prima del testo');
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const element = document.createElement(tag);
    try { range.surroundContents(element); selection.removeAllRanges(); selection.addRange(range); changed(); } catch { toast('Non è possibile formattare questa selezione'); }
  }

  function addLink() {
    if (state.sourceMode) return wrapSource('[', '](https://)');
    const selection = getSelection();
    const label = selection.toString();
    if (!label) return toast('Seleziona il testo da collegare');
    const url = prompt('Indirizzo del collegamento:', 'https://');
    if (url) { document.execCommand('createLink', false, url); changed(); }
  }

  function wrapSource(before, after) {
    const start = sourceEditor.selectionStart, end = sourceEditor.selectionEnd;
    const selected = sourceEditor.value.slice(start, end);
    sourceEditor.setRangeText(before + selected + after, start, end, 'end');
    sourceEditor.focus(); changed();
  }

  function formatBlock(tag) {
    if (state.sourceMode) return;
    document.execCommand('formatBlock', false, tag === 'p' ? 'p' : tag);
    changed();
  }

  function transformInlineMarkdown() {
    if (state.sourceMode) return false;
    const selection = getSelection();
    if (!selection.rangeCount || !selection.isCollapsed || selection.anchorNode?.nodeType !== Node.TEXT_NODE) return false;
    const node = selection.anchorNode;
    if (!editor.contains(node) || node.parentElement?.closest('.md-source-block')) return false;
    const offset = selection.anchorOffset;
    const before = node.nodeValue.slice(0, offset);
    const patterns = [
      { regex: /\*\*([^*\n]+)\*\*$/, tag: 'strong' },
      { regex: /__([^_\n]+)__$/, tag: 'strong' },
      { regex: /~~([^~\n]+)~~$/, tag: 's' },
      { regex: /`([^`\n]+)`$/, tag: 'code' },
      { regex: /(^|[^*])\*([^*\n]+)\*$/, tag: 'em', prefix: true },
      { regex: /(^|[^_])_([^_\n]+)_$/, tag: 'em', prefix: true }
    ];
    for (const pattern of patterns) {
      const match = before.match(pattern.regex);
      if (!match) continue;
      const prefixLength = pattern.prefix ? match[1].length : 0;
      const fullStart = offset - match[0].length;
      const start = fullStart + prefixLength;
      const content = pattern.prefix ? match[2] : match[1];
      if (!content?.trim()) return false;
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, offset); range.deleteContents();
      const element = document.createElement(pattern.tag); element.textContent = content;
      range.insertNode(element);
      range.setStartAfter(element); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      return true;
    }
    return false;
  }

  function markdownShortcut(event) {
    if (state.sourceMode || event.target.matches?.('.md-source-block') || ![' ', 'Enter'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const selection = getSelection();
    if (!selection.rangeCount || !selection.isCollapsed) return;
    const anchorElement = selection.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode;
    const listItem = anchorElement?.closest?.('li');
    if (event.key === 'Enter' && listItem && editor.contains(listItem)) {
      event.preventDefault();
      const list = listItem.parentElement;
      if (!listItem.textContent.trim()) {
        const paragraph = document.createElement('p'); paragraph.append(document.createElement('br'));
        list.after(paragraph); listItem.remove(); if (!list.children.length) list.remove();
        const range = document.createRange(); range.selectNodeContents(paragraph); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
      } else {
        const caret = selection.getRangeAt(0);
        const tail = document.createRange(); tail.setStart(caret.startContainer, caret.startOffset); tail.setEnd(listItem, listItem.childNodes.length);
        const remainder = tail.extractContents();
        if (!listItem.textContent && !listItem.querySelector('*')) listItem.append(document.createElement('br'));
        const nextItem = document.createElement('li');
        if (remainder.textContent || remainder.querySelector?.('*')) nextItem.append(remainder);
        else nextItem.append(document.createElement('br'));
        listItem.after(nextItem);
        const range = document.createRange(); range.selectNodeContents(nextItem); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
      }
      changed(); return;
    }
    let block = anchorElement;
    while (block && block.parentElement !== editor) block = block.parentElement;
    if (!block || !/^(P|DIV)$/.test(block.tagName)) return;
    const text = block.textContent;
    if (event.key === 'Enter') {
      const fence = text.match(/^```\s*([\w+-]*)$/);
      if (fence) {
        event.preventDefault();
        const pre = document.createElement('pre');
        if (fence[1]) pre.dataset.lang = fence[1];
        const code = document.createElement('code'); code.append(document.createElement('br')); pre.append(code); block.replaceWith(pre);
        const range = document.createRange(); range.selectNodeContents(code); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); changed();
      } else if (/^(---|\*\*\*)$/.test(text)) {
        event.preventDefault();
        const hr = document.createElement('hr'); const paragraph = document.createElement('p'); paragraph.append(document.createElement('br'));
        block.replaceWith(hr, paragraph);
        const range = document.createRange(); range.selectNodeContents(paragraph); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); changed();
      }
      return;
    }
    const heading = text.match(/^(#{1,6})$/);
    if (heading) {
      event.preventDefault();
      const h = document.createElement(`h${heading[1].length}`); h.innerHTML = '<br>'; block.replaceWith(h);
      const range = document.createRange(); range.selectNodeContents(h); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); changed();
    } else if (/^[-*+]$/.test(text)) {
      event.preventDefault();
      const list = document.createElement('ul');
      const item = document.createElement('li'); item.append(document.createElement('br')); list.append(item); block.replaceWith(list);
      const range = document.createRange(); range.selectNodeContents(item); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); changed();
    } else if (/^1\.$/.test(text)) {
      event.preventDefault();
      const list = document.createElement('ol');
      const item = document.createElement('li'); item.append(document.createElement('br')); list.append(item); block.replaceWith(list);
      const range = document.createRange(); range.selectNodeContents(item); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); changed();
    } else if (text === '>') {
      event.preventDefault();
      const quote = document.createElement('blockquote'); const paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); quote.append(paragraph); block.replaceWith(quote);
      const range = document.createRange(); range.selectNodeContents(paragraph); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); changed();
    }
  }

  function centerCaret() {
    const selection = getSelection();
    if (state.sourceMode) {
      const lineHeight = parseFloat(getComputedStyle(sourceEditor).lineHeight);
      const line = sourceEditor.value.slice(0, sourceEditor.selectionStart).split('\n').length;
      markdWrap.scrollTop = Math.max(0, line * lineHeight - markdWrap.clientHeight / 2);
    } else if (selection.rangeCount && editor.contains(selection.anchorNode)) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      markdWrap.scrollBy({ top: rect.top - innerHeight / 2, behavior: 'smooth' });
    }
  }

  function showFind() { $('#findbar').hidden = false; $('#findInput').focus(); $('#findInput').select(); }
  function find(direction = false) {
    const value = $('#findInput').value; if (!value) return;
    if (window.find) window.find(value, false, direction, true, false, false, false);
  }

  function exportHtml() {
    const body = markdownToHtml(currentMarkdown());
    const title = escapeHtml(fileName.value || 'Documento');
    const page = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;color:#333;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}h1{border-bottom:1px solid #ddd}a{color:#4183c4}blockquote{border-left:3px solid #ddd;padding-left:18px;color:#777}code,pre{font-family:monospace;background:#f5f5f5;border-radius:4px}code{padding:2px 4px}pre{padding:16px;overflow:auto}pre code{padding:0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:7px}img{max-width:100%}</style><body>${body}</body></html>`;
    downloadBlob(page, `${fileName.value || 'documento'}.html`, 'text/html'); toast('HTML esportato');
  }

  function activeMarkdownField() {
    if (paletteContext?.field?.isConnected) return paletteContext.field;
    if (activeSourceBlock?.isConnected) return activeSourceBlock;
    return state.sourceMode ? sourceEditor : null;
  }

  function notifyMarkdownField(field) {
    if (field === activeSourceBlock) resizeSourceBlock(field);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    field.focus();
  }

  function withMarkdownField(callback) {
    const existing = activeMarkdownField();
    if (existing) { callback(existing); return; }
    let block = getSelection().anchorNode;
    if (block?.nodeType === Node.TEXT_NODE) block = block.parentElement;
    while (block && block.parentElement !== editor) block = block.parentElement;
    if (!block || block === editor) {
      block = document.createElement('p'); block.append(document.createElement('br')); editor.append(block);
    }
    activateSourceBlock(block);
    requestAnimationFrame(() => activeSourceBlock && callback(activeSourceBlock));
  }

  function fieldRange(field) {
    let start = field.selectionStart ?? 0; let end = field.selectionEnd ?? start;
    if (field === sourceEditor) {
      start = field.value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = field.value.indexOf('\n', end); end = lineEnd < 0 ? field.value.length : lineEnd;
    } else if (start === end) { start = 0; end = field.value.length; }
    return { start, end };
  }

  function transformMarkdownBlock(transform) {
    withMarkdownField(field => {
      const range = fieldRange(field); const selected = field.value.slice(range.start, range.end);
      const replacement = transform(selected || 'testo');
      field.setRangeText(replacement, range.start, range.end, 'select');
      notifyMarkdownField(field);
    });
  }

  function prefixMarkdownLines(prefix, ordered = false) {
    transformMarkdownBlock(text => text.split('\n').map((line, index) => {
      const clean = line.replace(/^\s*(?:#{1,6}\s+|>\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, '');
      return `${ordered ? `${index + 1}. ` : prefix}${clean}`;
    }).join('\n'));
  }

  function headingCommand(level) {
    transformMarkdownBlock(text => `${'#'.repeat(level)} ${text.replace(/^#{1,6}\s+/, '').trim()}`);
  }

  function wrapMarkdownSelection(before, after = before, placeholder = 'testo') {
    withMarkdownField(field => {
      const start = field.selectionStart; const end = field.selectionEnd;
      const selected = field.value.slice(start, end) || placeholder;
      const replacement = `${before}${selected}${after}`;
      field.setRangeText(replacement, start, end, 'end');
      const selectionStart = start + before.length; field.setSelectionRange(selectionStart, selectionStart + selected.length);
      notifyMarkdownField(field);
    });
  }

  const commands = [
    { label: 'Nuovo documento', shortcut: '⌘ N', keywords: 'file crea', run: () => requestAction(newDocument) },
    { label: 'Apri file…', shortcut: '⌘ O', keywords: 'file importa', run: () => requestAction(openFile) },
    { label: 'Salva', shortcut: '⌘ S', keywords: 'file', run: saveFile },
    { label: 'Esporta HTML', shortcut: '⇧⌘ E', keywords: 'file html', run: exportHtml },
    { label: 'Rinomina documento', shortcut: 'F2', keywords: 'titolo nome file', run: () => { commitActiveBlock(); fileName.focus(); fileName.select(); } },
    { label: 'Trova nel documento', shortcut: '⌘ F', keywords: 'cerca', run: showFind },
    { label: 'Mostra o nascondi sidebar', shortcut: '⇧⌘ L', keywords: 'pannello recenti', run: () => toggleSidebar() },
    { label: 'Mostra documenti recenti', keywords: 'sidebar file', run: () => showSidebarTab('files') },
    { label: 'Mostra indice', keywords: 'sidebar titoli outline', run: () => showSidebarTab('outline') },
    { label: 'Sorgente Markdown completo', shortcut: '⌘ /', keywords: 'codice', run: () => toggleSource() },
    { label: 'Testo normale', keywords: 'paragrafo paragraph', run: () => transformMarkdownBlock(text => text.replace(/^#{1,6}\s+/, '').replace(/^>\s+/gm, '')) },
    { label: 'Titolo 1', shortcut: '⌘ 1', keywords: 'heading h1', run: () => headingCommand(1) },
    { label: 'Titolo 2', shortcut: '⌘ 2', keywords: 'heading h2', run: () => headingCommand(2) },
    { label: 'Titolo 3', shortcut: '⌘ 3', keywords: 'heading h3', run: () => headingCommand(3) },
    { label: 'Grassetto', shortcut: '⌘ B', keywords: 'bold', run: () => wrapMarkdownSelection('**') },
    { label: 'Corsivo', shortcut: '⌘ I', keywords: 'italic', run: () => wrapMarkdownSelection('*') },
    { label: 'Codice inline', shortcut: '⌘ `', keywords: 'code', run: () => wrapMarkdownSelection('`') },
    { label: 'Testo barrato', keywords: 'strike', run: () => wrapMarkdownSelection('~~') },
    { label: 'Collegamento', shortcut: '⌘ K', keywords: 'link url', run: () => wrapMarkdownSelection('[', '](https://)', 'testo') },
    { label: 'Immagine', keywords: 'foto image url', run: () => wrapMarkdownSelection('![', '](https://)', 'descrizione') },
    { label: 'Elenco puntato', shortcut: '⇧⌘ 8', keywords: 'lista bullet', run: () => prefixMarkdownLines('- ') },
    { label: 'Elenco numerato', shortcut: '⇧⌘ 7', keywords: 'lista ordered', run: () => prefixMarkdownLines('', true) },
    { label: 'Attività', keywords: 'task checkbox', run: () => prefixMarkdownLines('- [ ] ') },
    { label: 'Citazione', keywords: 'quote blockquote', run: () => prefixMarkdownLines('> ') },
    { label: 'Blocco di codice', keywords: 'code fence', run: () => transformMarkdownBlock(text => `\`\`\`\n${text}\n\`\`\``) },
    { label: 'Tabella', keywords: 'table righe colonne', run: () => transformMarkdownBlock(() => '| Colonna 1 | Colonna 2 |\n| --- | --- |\n| Cella | Cella |') },
    { label: 'Separatore', keywords: 'linea hr', run: () => transformMarkdownBlock(() => '---') },
    { label: 'Tema chiaro', keywords: 'aspetto light', run: () => setTheme('light') },
    { label: 'Tema seppia', keywords: 'aspetto sepia', run: () => setTheme('sepia') },
    { label: 'Tema scuro', keywords: 'aspetto dark', run: () => setTheme('dark') }
  ];

  function renderCommandList() {
    const query = $('#commandInput').value.trim().toLowerCase();
    filteredCommands = commands.filter(command => `${command.label} ${command.keywords || ''}`.toLowerCase().includes(query));
    selectedCommand = Math.max(0, Math.min(selectedCommand, filteredCommands.length - 1));
    $('#commandList').innerHTML = filteredCommands.length ? filteredCommands.map((command, index) =>
      `<button class="command-item${index === selectedCommand ? ' selected' : ''}" data-command-index="${index}" role="option" aria-selected="${index === selectedCommand}"><span>${escapeHtml(command.label)}</span>${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ''}</button>`
    ).join('') : '<div class="command-empty">Nessun comando trovato</div>';
    $('.command-item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  function showCommandPalette() {
    const field = activeMarkdownField();
    paletteContext = field ? { field, start: field.selectionStart, end: field.selectionEnd } : null;
    $('#commandPalette').hidden = false; $('#commandInput').value = ''; selectedCommand = 0; renderCommandList();
    requestAnimationFrame(() => $('#commandInput').focus());
  }

  function closeCommandPalette(refocus = true) {
    $('#commandPalette').hidden = true;
    if (refocus && paletteContext?.field?.isConnected) {
      paletteContext.field.focus(); paletteContext.field.setSelectionRange(paletteContext.start, paletteContext.end);
    }
  }

  function runSelectedCommand(index = selectedCommand) {
    const command = filteredCommands[index]; if (!command) return;
    closeCommandPalette(false); command.run(); paletteContext = null;
  }

  // UI events
  const sidebar = $('#sidebar');
  let sidebarTimer;
  let sidebarPinned = false;
  const showSidebar = () => { clearTimeout(sidebarTimer); app.classList.add('sidebar-visible'); };
  const closeSidebar = () => { sidebarPinned = false; clearTimeout(sidebarTimer); app.classList.remove('sidebar-visible'); };
  const hideSidebar = (delay = 180) => {
    if (sidebarPinned) return;
    clearTimeout(sidebarTimer); sidebarTimer = setTimeout(() => app.classList.remove('sidebar-visible'), delay);
  };
  const toggleSidebar = () => {
    const shouldShow = !app.classList.contains('sidebar-visible');
    sidebarPinned = shouldShow;
    app.classList.toggle('sidebar-visible', shouldShow);
  };
  function showSidebarTab(tab) {
    sidebarPinned = true; showSidebar();
    $(`.sidebar-tabs button[data-tab="${tab}"]`)?.click();
  }
  $('#sidebarReveal').addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') showSidebar(); });
  $('#sidebarReveal').addEventListener('click', () => matchMedia('(hover: hover)').matches ? showSidebar() : toggleSidebar());
  sidebar.addEventListener('pointerenter', showSidebar);
  sidebar.addEventListener('pointerleave', () => hideSidebar());
  document.addEventListener('pointermove', event => { if (event.pointerType === 'mouse' && event.clientX <= 12) showSidebar(); });
  $('#scrim').addEventListener('click', closeSidebar);
  document.addEventListener('pointerdown', event => {
    if (activeSourceBlock && !editor.contains(event.target) && !$('#commandPalette').contains(event.target)) commitActiveBlock();
  }, true);
  editor.addEventListener('focusout', () => setTimeout(() => {
    if (activeSourceBlock && $('#commandPalette').hidden && !editor.contains(document.activeElement)) commitActiveBlock();
  }));
  $('#openButton').addEventListener('click', () => requestAction(openFile));
  $('#newButton').addEventListener('click', () => requestAction(newDocument));
  $('#saveButton').addEventListener('click', saveFile);
  $('#exportButton').addEventListener('click', exportHtml);
  $('#findSidebar').addEventListener('click', () => { showFind(); closeSidebar(); });
  $('#sourceButton').addEventListener('click', toggleSource);
  $('#commandInput').addEventListener('input', () => { selectedCommand = 0; renderCommandList(); });
  $('#commandInput').addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'ArrowDown') { event.preventDefault(); selectedCommand = Math.min(selectedCommand + 1, filteredCommands.length - 1); renderCommandList(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); selectedCommand = Math.max(selectedCommand - 1, 0); renderCommandList(); }
    if (event.key === 'Enter') { event.preventDefault(); runSelectedCommand(); }
    if (event.key === 'Escape') { event.preventDefault(); closeCommandPalette(); }
  });
  $('#commandList').addEventListener('click', event => {
    const item = event.target.closest('[data-command-index]'); if (item) runSelectedCommand(Number(item.dataset.commandIndex));
  });
  $('#commandPalette').addEventListener('pointerdown', event => { if (event.target === $('#commandPalette')) closeCommandPalette(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (file) loadMarkdown(await file.text(), file.name); fileInput.value = '';
  });
  fileName.addEventListener('input', changed);
  fileName.addEventListener('blur', () => { if (!fileName.value.trim()) fileName.value = 'Senza titolo'; persistLocal(false); });
  editor.addEventListener('input', event => {
    if (!event.target.matches?.('.md-source-block') && event.inputType?.startsWith('insert')) transformInlineMarkdown();
    changed();
  });
  sourceEditor.addEventListener('input', changed);
  sourceEditor.addEventListener('keydown', event => {
    const line = sourceEditor.value.slice(0, sourceEditor.selectionStart).split('\n').pop();
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !line.trim()) {
      event.preventDefault(); showCommandPalette();
    }
  });
  editor.addEventListener('paste', event => {
    if (event.target.matches?.('.md-source-block')) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });
  editor.addEventListener('pointerdown', event => {
    if (state.sourceMode || event.target.matches('input[type="checkbox"]') || activeSourceBlock?.contains(event.target)) return;
    let block = event.target;
    while (block && block.parentElement !== editor) block = block.parentElement;
    if (!block || block === editor) { commitActiveBlock(); return; }
    event.preventDefault();
    activateSourceBlock(block, { x: event.clientX, y: event.clientY });
  });
  editor.addEventListener('keydown', markdownShortcut);
  editor.addEventListener('click', event => {
    if (event.target.matches('input[type="checkbox"]')) { event.target.toggleAttribute('checked', event.target.checked); changed(); }
  });

  $$('.sidebar-tabs button').forEach(button => button.addEventListener('click', () => {
    $$('.sidebar-tabs button').forEach(x => x.classList.toggle('active', x === button));
    $$('.sidebar-panel').forEach(x => x.classList.remove('active'));
    $(`#${button.dataset.tab}Panel`).classList.add('active');
    if (button.dataset.tab === 'outline') updateOutline();
  }));

  $('#recentFiles').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('.recent-item')) { event.preventDefault(); event.target.click(); }
  });
  $('#recentFiles').addEventListener('click', event => {
    const item = event.target.closest('.recent-item'); if (!item) return;
    if (event.target.closest('.recent-remove')) {
      event.stopPropagation(); localStorage.setItem(STORAGE_KEY, JSON.stringify(getStoredDocs().filter(d => d.id !== item.dataset.id))); renderRecents(); return;
    }
    const doc = getStoredDocs().find(d => d.id === item.dataset.id);
    if (doc) requestAction(() => { loadMarkdown(doc.markdown, doc.name, { id: doc.id }); if (innerWidth <= 720) closeSidebar(); });
  });

  $('#outline').addEventListener('click', event => {
    const link = event.target.closest('a'); if (!link) return; event.preventDefault();
    if (state.sourceMode) {
      const line = Number(link.dataset.sourceLine); const position = sourceEditor.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
      sourceEditor.focus(); sourceEditor.setSelectionRange(position, position); centerCaret();
    } else $(link.getAttribute('href'), editor)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('#themeSelect').addEventListener('change', event => setTheme(event.target.value));
  function setTheme(theme) {
    app.classList.remove('theme-sepia', 'theme-dark'); if (theme !== 'light') app.classList.add(`theme-${theme}`);
    $('#themeSelect').value = theme; saveSettings({ theme });
  }
  function saveSettings(change) {
    let settings = {}; try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, ...change }));
  }

  $('#findInput').addEventListener('keydown', event => { if (event.key === 'Enter') find(event.shiftKey); if (event.key === 'Escape') $('#findbar').hidden = true; });
  $('#findNext').addEventListener('click', () => find(false)); $('#findPrev').addEventListener('click', () => find(true)); $('#findClose').addEventListener('click', () => $('#findbar').hidden = true);

  $('#confirmDialog').addEventListener('click', async event => {
    const action = event.target.dataset.dialog; if (!action) return;
    if (action === 'cancel') { state.pendingAction = null; $('#confirmDialog').hidden = true; }
    if (action === 'discard') { const pending = state.pendingAction; state.pendingAction = null; $('#confirmDialog').hidden = true; pending?.(); }
    if (action === 'save') { if (await saveFile()) { const pending = state.pendingAction; state.pendingAction = null; $('#confirmDialog').hidden = true; pending?.(); } }
  });

  document.addEventListener('keydown', event => {
    const mod = event.metaKey || event.ctrlKey; const key = event.key.toLowerCase();
    if (event.key === 'F2') { event.preventDefault(); commitActiveBlock(); fileName.focus(); fileName.select(); return; }
    if (event.key === '/' && !mod && !event.altKey && !activeSourceBlock && !state.sourceMode && (event.target === editor || editor.contains(event.target))) {
      event.preventDefault(); withMarkdownField(() => showCommandPalette()); return;
    }
    if (event.key === 'F1' || (mod && event.shiftKey && key === 'p')) { event.preventDefault(); showCommandPalette(); return; }
    if (!$('#commandPalette').hidden) return;
    if (mod && event.shiftKey && key === 'e') { event.preventDefault(); exportHtml(); return; }
    if (mod && event.shiftKey && key === 'l') { event.preventDefault(); toggleSidebar(); return; }
    if (mod && event.shiftKey && event.code === 'Digit7') { event.preventDefault(); prefixMarkdownLines('', true); return; }
    if (mod && event.shiftKey && event.code === 'Digit8') { event.preventDefault(); prefixMarkdownLines('- '); return; }
    if (mod && ['1', '2', '3'].includes(event.key)) { event.preventDefault(); headingCommand(Number(event.key)); return; }
    if (mod && key === 's') { event.preventDefault(); saveFile(); return; }
    if (mod && key === 'o') { event.preventDefault(); requestAction(openFile); return; }
    if (mod && key === 'n') { event.preventDefault(); requestAction(newDocument); return; }
    if (mod && key === 'f') { event.preventDefault(); showFind(); return; }
    if (mod && key === 'b') { event.preventDefault(); wrapMarkdownSelection('**'); return; }
    if (mod && key === 'i') { event.preventDefault(); wrapMarkdownSelection('*'); return; }
    if (mod && key === 'k') { event.preventDefault(); wrapMarkdownSelection('[', '](https://)', 'testo'); return; }
    if (mod && event.key === '`') { event.preventDefault(); wrapMarkdownSelection('`'); return; }
    if (mod && event.key === '/') { event.preventDefault(); toggleSource(); return; }
    if (event.key === 'Escape') { $('#findbar').hidden = true; closeSidebar(); }
  });

  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  markdWrap.addEventListener('dragover', event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) event.preventDefault(); });
  markdWrap.addEventListener('drop', async event => {
    const file = [...event.dataTransfer.files].find(item => /\.(md|markdown|txt)$/i.test(item.name));
    if (!file) return;
    event.preventDefault();
    requestAction(async () => loadMarkdown(await file.text(), file.name));
  });

  // Initial state
  let settings = {}; try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
  setTheme(settings.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  let docs = getStoredDocs();
  if (settings.welcomeVersion !== WELCOME_VERSION) {
    const welcome = docs.find(doc => doc.name === 'Benvenuto');
    if (welcome) { welcome.markdown = starter; welcome.updated = Date.now(); }
    else if (docs.length) docs = [...docs.slice(0, 9), { id: 'markd-welcome', name: 'Benvenuto', markdown: starter, updated: Date.now() }];
    if (docs.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(docs.slice(0, 10)));
    saveSettings({ welcomeVersion: WELCOME_VERSION });
  }
  docs = getStoredDocs();
  if (docs.length) loadMarkdown(docs[0].markdown, docs[0].name, { id: docs[0].id });
  else loadMarkdown(starter, 'Benvenuto');

  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async launchParams => {
      const handle = launchParams.files?.[0];
      if (!handle) return;
      const file = await handle.getFile();
      requestAction(async () => loadMarkdown(await file.text(), file.name, { handle }));
    });
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
