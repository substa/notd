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
    vimEnabled: false, vimMode: 'normal', currentId: null, pendingAction: null, saveTimer: null
  };
  let activeSourceBlock = null;
  let paletteContext = null;
  let filteredCommands = [];
  let selectedCommand = 0;
  let vimPending = '';
  let vimDesiredColumn = null;
  let vimInsertSnapshot = null;
  const vimUndoStack = [];
  const vimRedoStack = [];
  const WELCOME_VERSION = '11';

  const starter = `# Welcome to markd

markd is a minimal **Markdown** editor: everything stays in your browser or in the files you choose to open.

## Contextual editing

Select a block to view and edit its Markdown source. When you move to another block, the content is formatted again automatically. Use **Arrow Up/Down** at the text boundaries or **Alt + Arrow Up/Down** to move between blocks without a mouse.

## Quick commands

In Vim mode, press **/** to open commands; while typing, use it at the start of an empty line. You can also use **⌘/Ctrl + K** or **⌘/Ctrl + Shift + P** anywhere. Type a command name, move with the arrow keys, and press Enter.

## Vim mode

Enable **Vim mode** from the command palette. In Normal mode, use \`h/j/k/l\`, \`w/b/e\`, \`0/$\`, and \`gg/G\` to move; \`Ctrl-D\` and \`Ctrl-U\` jump forward or backward across several blocks. Press \`i\`, \`a\`, \`I\`, \`A\`, \`o\`, or \`O\` to type, and \`Esc\` to return to Normal mode. You can also use \`x\`, \`dd\`, \`D\`, \`C\`, and \`r\` to edit text, \`u\` to undo, and \`Ctrl-R\` to redo.

## Essential syntax

- \`# Heading\`, \`## Subheading\`, \`### Section\`
- \`**bold**\` and \`*italic*\`
- \`\`inline code\`\` and \`~~strikethrough~~\`
- \`- item\`, \`1. item\`, and \`- [ ] task\`
- \`> quote\` and \`---\` for a divider
- \`[text](https://example.com)\` for a link
- Three backticks for a code block

> Tip: press Enter after a list item to create another one; press Enter on an empty item to end the list.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘/Ctrl + N | New document |
| ⌘/Ctrl + O | Open file |
| ⌘/Ctrl + S | Save |
| ⌘/Ctrl + Shift + E | Export HTML |
| ⌘/Ctrl + F | Find |
| ⌘/Ctrl + K, ⌘/Ctrl + Shift + P, or F1 | Open commands |
| F2 | Rename document |
| ⌘/Ctrl + / | Show full source |
| ⌘/Ctrl + B | Bold |
| ⌘/Ctrl + I | Italic |
| ⌘/Ctrl + 1, 2, 3 | Heading 1, 2, 3 |
| ⌘/Ctrl + Shift + 7 | Numbered list |
| ⌘/Ctrl + Shift + 8 | Bulleted list |
| Alt + Arrow Up/Down | Previous or next block |
| Ctrl + D / Ctrl + U (Vim) | Jump forward or backward several blocks |
| U / Ctrl + R (Vim) | Undo or redo a change |
| ⌘/Ctrl + Enter | Commit the block and move to the next one |
| Esc | Close commands or return to Normal mode in Vim |

## Files and privacy

Open, save, export, and reach recent documents or headings from the command palette. An automatic copy is stored locally; no text is sent to external servers.
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

  function moveToAdjacentBlock(direction, createIfMissing = false, preferredColumn = null) {
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
      let offset = direction < 0 ? activeSourceBlock.value.length : 0;
      if (preferredColumn !== null) {
        const value = activeSourceBlock.value;
        const lineStart = direction < 0 ? value.lastIndexOf('\n') + 1 : 0;
        const lineEnd = direction < 0 ? value.length : (value.indexOf('\n') < 0 ? value.length : value.indexOf('\n'));
        offset = lineStart + Math.min(preferredColumn, Math.max(0, lineEnd - lineStart - 1));
      }
      if (state.vimEnabled && state.vimMode === 'normal') showVimCursor(activeSourceBlock, offset);
      else activeSourceBlock.setSelectionRange(offset, offset);
      activeSourceBlock.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function vimField() {
    if (activeSourceBlock?.isConnected) return activeSourceBlock;
    return state.sourceMode ? sourceEditor : null;
  }

  function captureVimSnapshot(field = vimField()) {
    return {
      markdown: currentMarkdown(),
      blockIndex: field === activeSourceBlock ? [...editor.children].indexOf(field) : 0,
      cursor: field?.selectionStart || 0
    };
  }

  function pushVimSnapshot(stack, snapshot) {
    if (!snapshot || stack[stack.length - 1]?.markdown === snapshot.markdown) return;
    stack.push(snapshot);
    if (stack.length > 100) stack.shift();
  }

  function recordVimChange(field) {
    pushVimSnapshot(vimUndoStack, captureVimSnapshot(field));
    vimRedoStack.length = 0;
  }

  function finishVimInsertChange(field = vimField()) {
    if (!vimInsertSnapshot) return;
    const snapshot = vimInsertSnapshot;
    vimInsertSnapshot = null;
    if (snapshot.markdown !== currentMarkdown()) {
      pushVimSnapshot(vimUndoStack, snapshot);
      vimRedoStack.length = 0;
    }
  }

  function restoreVimSnapshot(snapshot) {
    vimInsertSnapshot = null;
    state.vimMode = 'normal';
    vimPending = '';
    vimDesiredColumn = null;
    if (state.sourceMode) {
      sourceEditor.value = snapshot.markdown;
      setVimMode('normal', sourceEditor, snapshot.cursor);
    } else {
      activeSourceBlock = null;
      editor.innerHTML = markdownToHtml(snapshot.markdown);
      const blocks = [...editor.children];
      const block = blocks[Math.max(0, Math.min(snapshot.blockIndex, blocks.length - 1))];
      if (block) {
        activateSourceBlock(block);
        requestAnimationFrame(() => activeSourceBlock && showVimCursor(activeSourceBlock, snapshot.cursor));
      } else focusVimEditor();
    }
    changed(); updateStats(); updateOutline();
  }

  function applyVimHistory(redo = false) {
    const source = redo ? vimRedoStack : vimUndoStack;
    const destination = redo ? vimUndoStack : vimRedoStack;
    const snapshot = source.pop();
    if (!snapshot) { toast(redo ? 'Nothing to redo' : 'Nothing to undo'); return; }
    pushVimSnapshot(destination, captureVimSnapshot());
    restoreVimSnapshot(snapshot);
  }

  function vimLineBounds(field, position = field.selectionStart) {
    const start = field.value.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
    const nextBreak = field.value.indexOf('\n', position);
    return { start, end: nextBreak < 0 ? field.value.length : nextBreak };
  }

  function showVimCursor(field, position = field.selectionStart) {
    if (!field?.isConnected) return;
    const maximum = field.value.endsWith('\n') ? field.value.length : Math.max(0, field.value.length - 1);
    const cursor = Math.max(0, Math.min(position, maximum));
    field.setSelectionRange(cursor, Math.min(cursor + 1, field.value.length));
  }

  function updateVimUi() {
    const status = $('#vimStatus');
    status.hidden = !state.vimEnabled;
    const pending = vimPending ? ` ${vimPending}` : '';
    status.textContent = state.vimMode === 'insert' ? '-- INSERT --' : `-- NORMAL --${pending}`;
    app.classList.toggle('vim-enabled', state.vimEnabled);
  }

  function setVimMode(mode, field = vimField(), cursor = null) {
    if (mode === 'normal' && state.vimMode === 'insert') finishVimInsertChange(field);
    if (mode === 'insert' && state.vimMode !== 'insert' && !vimInsertSnapshot) vimInsertSnapshot = captureVimSnapshot(field);
    state.vimMode = mode;
    vimPending = '';
    vimDesiredColumn = null;
    $$('.md-source-block, #sourceEditor').forEach(item => item.classList.remove('vim-normal', 'vim-insert'));
    if (field?.isConnected) {
      field.classList.add(mode === 'normal' ? 'vim-normal' : 'vim-insert');
      field.focus();
      if (mode === 'normal') showVimCursor(field, cursor ?? field.selectionStart);
      else {
        const position = cursor ?? field.selectionStart;
        field.setSelectionRange(position, position);
      }
    }
    updateVimUi();
  }

  function focusVimEditor() {
    if (!state.vimEnabled) return;
    if (state.sourceMode) { setVimMode(state.vimMode, sourceEditor); return; }
    if (activeSourceBlock) { setVimMode(state.vimMode, activeSourceBlock); return; }
    let block = editor.firstElementChild;
    if (!block) {
      block = document.createElement('p'); block.append(document.createElement('br')); editor.append(block);
    }
    activateSourceBlock(block);
  }

  function setVimEnabled(enabled = !state.vimEnabled, refocus = true) {
    if (state.vimEnabled && state.vimMode === 'insert') finishVimInsertChange();
    state.vimEnabled = enabled;
    state.vimMode = 'normal';
    vimPending = '';
    $$('.md-source-block, #sourceEditor').forEach(item => item.classList.remove('vim-normal', 'vim-insert'));
    updateVimUi();
    saveSettings({ vimEnabled: enabled });
    if (enabled && refocus) requestAnimationFrame(focusVimEditor);
    if (!enabled) {
      const field = vimField();
      if (field) {
        field.setSelectionRange(field.selectionStart, field.selectionStart);
        if (refocus) field.focus();
      } else if (refocus) editor.focus();
    }
    if (refocus) toast(enabled ? 'Vim mode enabled' : 'Vim mode disabled');
  }

  function replaceVimRange(field, start, end, text = '', record = true) {
    if (record && (start !== end || text)) recordVimChange(field);
    field.setRangeText(text, start, end, 'start');
    notifyMarkdownField(field);
  }

  function vimWordKind(character) {
    if (!character || /\s/.test(character)) return 'space';
    return /[\p{L}\p{N}_]/u.test(character) ? 'word' : 'symbol';
  }

  function nextVimWord(value, position) {
    let cursor = Math.min(position + 1, value.length);
    const kind = vimWordKind(value[position]);
    while (cursor < value.length && kind !== 'space' && vimWordKind(value[cursor]) === kind) cursor++;
    while (cursor < value.length && vimWordKind(value[cursor]) === 'space') cursor++;
    return cursor;
  }

  function previousVimWord(value, position) {
    let cursor = Math.max(0, position - 1);
    while (cursor > 0 && vimWordKind(value[cursor]) === 'space') cursor--;
    const kind = vimWordKind(value[cursor]);
    while (cursor > 0 && vimWordKind(value[cursor - 1]) === kind) cursor--;
    return cursor;
  }

  function endVimWord(value, position) {
    let cursor = position;
    if (cursor < value.length - 1 && vimWordKind(value[cursor + 1]) === vimWordKind(value[cursor]) && vimWordKind(value[cursor]) !== 'space') cursor++;
    else {
      cursor++;
      while (cursor < value.length && vimWordKind(value[cursor]) === 'space') cursor++;
    }
    const kind = vimWordKind(value[cursor]);
    while (cursor < value.length - 1 && vimWordKind(value[cursor + 1]) === kind) cursor++;
    return cursor;
  }

  function moveVimVertically(field, direction, firstNonBlank = false) {
    const bounds = vimLineBounds(field);
    const column = vimDesiredColumn ?? field.selectionStart - bounds.start;
    vimDesiredColumn = column;
    let targetStart;
    if (direction < 0) {
      if (bounds.start === 0) {
        if (field === activeSourceBlock) moveToAdjacentBlock(-1, false, column);
        return;
      }
      const previousEnd = bounds.start - 1;
      targetStart = field.value.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1;
    } else {
      if (bounds.end === field.value.length) {
        if (field === activeSourceBlock) moveToAdjacentBlock(1, false, column);
        return;
      }
      targetStart = bounds.end + 1;
    }
    const targetBreak = field.value.indexOf('\n', targetStart);
    const targetEnd = targetBreak < 0 ? field.value.length : targetBreak;
    let target = targetStart + Math.min(column, Math.max(0, targetEnd - targetStart - 1));
    if (firstNonBlank) target = targetStart + (field.value.slice(targetStart, targetEnd).match(/^\s*/)?.[0].length || 0);
    showVimCursor(field, target);
  }

  function moveVimByPage(field, direction) {
    const bounds = vimLineBounds(field);
    const column = field.selectionStart - bounds.start;
    if (field === sourceEditor) {
      const lines = field.value.split('\n');
      const currentLine = field.value.slice(0, bounds.start).split('\n').length - 1;
      const lineHeight = parseFloat(getComputedStyle(field).lineHeight) || 24;
      const jump = Math.max(5, Math.floor(markdWrap.clientHeight / lineHeight / 2));
      const targetLine = Math.max(0, Math.min(lines.length - 1, currentLine + direction * jump));
      const lineStart = lines.slice(0, targetLine).reduce((total, line) => total + line.length + 1, 0);
      showVimCursor(field, lineStart + Math.min(column, Math.max(0, lines[targetLine].length - 1)));
      centerCaret(); return;
    }
    const blocks = [...editor.children];
    const currentIndex = blocks.indexOf(activeSourceBlock);
    if (currentIndex < 0) return;
    const target = blocks[Math.max(0, Math.min(blocks.length - 1, currentIndex + direction * 5))];
    if (!target || target === activeSourceBlock) return;
    commitActiveBlock();
    if (!target.isConnected) return;
    activateSourceBlock(target);
    requestAnimationFrame(() => {
      if (!activeSourceBlock) return;
      showVimCursor(activeSourceBlock, Math.min(column, Math.max(0, vimLineBounds(activeSourceBlock, 0).end - 1)));
      activeSourceBlock.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  function moveVimToDocumentEdge(field, end) {
    if (field === sourceEditor) {
      const position = end ? vimLineBounds(field, field.value.length).start : 0;
      showVimCursor(field, position); centerCaret(); return;
    }
    const source = activeSourceBlock;
    if (!source) return;
    const target = end ? editor.lastElementChild : editor.firstElementChild;
    if (!target || target === source) { showVimCursor(field, end ? field.value.length - 1 : 0); return; }
    commitActiveBlock(); activateSourceBlock(end ? editor.lastElementChild : editor.firstElementChild);
    requestAnimationFrame(() => {
      if (!activeSourceBlock) return;
      const position = end ? vimLineBounds(activeSourceBlock, activeSourceBlock.value.length).start : 0;
      showVimCursor(activeSourceBlock, position);
      activeSourceBlock.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  function deleteVimLine(field) {
    const bounds = vimLineBounds(field);
    let start = bounds.start; let end = bounds.end;
    if (end < field.value.length) end++;
    else if (start > 0) start--;
    replaceVimRange(field, start, end);
    showVimCursor(field, Math.min(start, field.value.length - 1));
  }

  function processVimNormalKey(field, key) {
    const value = field.value;
    const position = field.selectionStart;
    const bounds = vimLineBounds(field, position);
    const finish = target => { vimPending = ''; vimDesiredColumn = null; showVimCursor(field, target); updateVimUi(); };

    if (vimPending === 'g') {
      vimPending = '';
      if (key === 'g') moveVimToDocumentEdge(field, false);
      updateVimUi(); return;
    }
    if (vimPending === 'd') {
      vimPending = '';
      if (key === 'd') deleteVimLine(field);
      else if (key === 'w') { replaceVimRange(field, position, nextVimWord(value, position)); showVimCursor(field, position); }
      else if (key === '$') { replaceVimRange(field, position, bounds.end); showVimCursor(field, position); }
      updateVimUi(); return;
    }
    if (vimPending === 'r') {
      vimPending = '';
      if (key.length === 1 && position < value.length && value[position] !== '\n') {
        replaceVimRange(field, position, position + 1, key); showVimCursor(field, position);
      }
      updateVimUi(); return;
    }

    if (key === 'Ctrl+d') { moveVimByPage(field, 1); return; }
    if (key === 'Ctrl+u') { moveVimByPage(field, -1); return; }
    if (key === 'u') { applyVimHistory(false); return; }
    if (key === 'Ctrl+r') { applyVimHistory(true); return; }

    if (key !== 'j' && key !== 'k' && key !== 'ArrowDown' && key !== 'ArrowUp') vimDesiredColumn = null;
    if (key === 'h' || key === 'ArrowLeft') finish(Math.max(bounds.start, position - 1));
    else if (key === 'l' || key === 'ArrowRight') finish(Math.min(Math.max(bounds.start, bounds.end - 1), position + 1));
    else if (key === 'j' || key === 'ArrowDown') moveVimVertically(field, 1);
    else if (key === 'k' || key === 'ArrowUp') moveVimVertically(field, -1);
    else if (key === 'w') finish(nextVimWord(value, position));
    else if (key === 'b') finish(previousVimWord(value, position));
    else if (key === 'e') finish(endVimWord(value, position));
    else if (key === '0' || key === 'Home') finish(bounds.start);
    else if (key === '^') finish(bounds.start + (value.slice(bounds.start, bounds.end).match(/^\s*/)?.[0].length || 0));
    else if (key === '$' || key === 'End') finish(Math.max(bounds.start, bounds.end - 1));
    else if (key === 'g') { vimPending = 'g'; updateVimUi(); }
    else if (key === 'G') moveVimToDocumentEdge(field, true);
    else if (key === 'Enter') moveVimVertically(field, 1, true);
    else if (key === 'i') setVimMode('insert', field, position);
    else if (key === 'a') setVimMode('insert', field, Math.min(position + (value[position] === '\n' ? 0 : 1), value.length));
    else if (key === 'I') setVimMode('insert', field, bounds.start + (value.slice(bounds.start, bounds.end).match(/^\s*/)?.[0].length || 0));
    else if (key === 'A') setVimMode('insert', field, bounds.end);
    else if (key === 'o' || key === 'O') {
      const insertion = key === 'o' ? bounds.end : bounds.start;
      vimInsertSnapshot = captureVimSnapshot(field);
      replaceVimRange(field, insertion, insertion, '\n', false);
      setVimMode('insert', field, key === 'o' ? insertion + 1 : insertion);
    } else if (key === 'x' || key === 'Delete') {
      if (position < value.length && value[position] !== '\n') replaceVimRange(field, position, position + 1);
      showVimCursor(field, Math.min(position, field.value.length - 1));
    } else if (key === 'X' || key === 'Backspace') {
      if (position > bounds.start) replaceVimRange(field, position - 1, position);
      showVimCursor(field, Math.max(bounds.start, position - 1));
    } else if (key === 'd') { vimPending = 'd'; updateVimUi(); }
    else if (key === 'D' || key === 'C') {
      if (key === 'C') vimInsertSnapshot = captureVimSnapshot(field);
      replaceVimRange(field, position, bounds.end, '', key !== 'C');
      if (key === 'C') setVimMode('insert', field, position); else showVimCursor(field, position);
    } else if (key === 'r') { vimPending = 'r'; updateVimUi(); }
    else if (key === '/') showCommandPalette();
    else if (key === ':') showCommandPalette();
  }

  function handleVimKeydown(event) {
    if (!state.vimEnabled || !$('#commandPalette').hidden || !$('#confirmDialog').hidden) return;
    const field = event.target === sourceEditor ? sourceEditor : (event.target === activeSourceBlock ? activeSourceBlock : null);
    const ctrlEscape = event.ctrlKey && event.key === '[';
    const ctrlCommand = event.ctrlKey && !event.metaKey && !event.altKey && ['d', 'u', 'r'].includes(event.key.toLowerCase());
    const vimKey = ctrlCommand ? `Ctrl+${event.key.toLowerCase()}` : event.key;
    if (state.vimMode === 'insert') {
      if (!field || (event.key !== 'Escape' && !ctrlEscape)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const position = Math.max(0, (field?.selectionStart || 0) - 1);
      setVimMode('normal', field, position); return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      if (!ctrlEscape && !ctrlCommand) return;
    }
    const handledKey = event.key.length === 1 || ['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Backspace', 'Delete'].includes(event.key);
    if (!handledKey) return;
    if (!field && (event.target === editor || editor.contains(event.target))) {
      event.preventDefault(); event.stopImmediatePropagation();
      focusVimEditor();
      requestAnimationFrame(() => { const active = vimField(); if (active && event.key !== 'Escape') processVimNormalKey(active, vimKey); });
      return;
    }
    if (!field) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape' || ctrlEscape) { vimPending = ''; updateVimUi(); return; }
    processVimNormalKey(field, vimKey);
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
    requestAnimationFrame(() => {
      placeCaretInSource(source, pointer?.x ?? -1, pointer?.y ?? -1);
      if (state.vimEnabled) setVimMode(state.vimMode, source, source.selectionStart);
    });
  }

  function commitActiveBlock() {
    const source = activeSourceBlock;
    if (!source) return;
    if (state.vimEnabled && state.vimMode === 'insert') finishVimInsertChange(source);
    activeSourceBlock = null;
    if (state.vimEnabled) {
      state.vimMode = 'normal'; vimPending = ''; vimDesiredColumn = null; updateVimUi();
    }
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

  function loadMarkdown(markdown, name = 'Untitled', options = {}) {
    state.markdown = markdown;
    activeSourceBlock = null;
    vimUndoStack.length = 0; vimRedoStack.length = 0; vimInsertSnapshot = null;
    state.fileHandle = options.handle || null;
    state.currentId = options.id || crypto.randomUUID?.() || String(Date.now());
    state.dirty = false;
    editor.innerHTML = markdownToHtml(markdown);
    sourceEditor.value = markdown;
    fileName.value = name.replace(/\.(md|markdown|txt)$/i, '');
    document.title = `${fileName.value} — markd`;
    app.classList.remove('dirty');
    updateStats(); updateOutline(); persistLocal(false);
    saveState.textContent = 'Ready';
    requestAnimationFrame(() => state.vimEnabled ? focusVimEditor() : editor.focus());
  }

  function changed() {
    state.dirty = true;
    state.markdown = currentMarkdown();
    app.classList.add('dirty');
    saveState.textContent = 'Modified';
    document.title = `• ${fileName.value || 'Untitled'} — markd`;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { persistLocal(true); updateStats(); updateOutline(); }, 450);
  }

  function getStoredDocs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }

  function persistLocal(showStatus = true) {
    if (!state.currentId) return;
    const docs = getStoredDocs().filter(d => d.id !== state.currentId);
    docs.unshift({ id: state.currentId, name: fileName.value || 'Untitled', markdown: currentMarkdown(), updated: Date.now() });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(docs.slice(0, 10)));
      if (showStatus) saveState.textContent = 'Local copy saved';
    } catch { saveState.textContent = 'Local storage is full'; }
  }

  function relativeDate(time) {
    const seconds = Math.floor((Date.now() - time) / 1000);
    if (seconds < 60) return 'now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(time);
  }

  function updateStats() {
    const text = currentMarkdown().replace(/```[\s\S]*?```|[#>*_`~\[\]()|\-]/g, ' ').trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.replace(/\s/g, '').length;
    $('#wordCount').textContent = `${words} ${words === 1 ? 'word' : 'words'} · ${chars} characters`;
  }

  function updateOutline() {
    if (state.sourceMode) return;
    $$('h1,h2,h3,h4,h5,h6', editor).forEach((heading, index) => heading.id = `heading-${index}`);
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
    } catch (error) { if (error.name !== 'AbortError') toast('Could not open the file'); }
  }

  async function saveFile() {
    let markdown = currentMarkdown();
    let name = (fileName.value.trim() || 'Untitled').replace(/\.(md|markdown)$/i, '') + '.md';
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
      document.title = `${fileName.value} — markd`; saveState.textContent = 'Saved'; persistLocal(false); toast('Document saved');
      return true;
    } catch (error) { if (error.name !== 'AbortError') toast('Could not save the document'); return false; }
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

  function newDocument() { loadMarkdown('', 'Untitled'); }

  function toggleSource(force) {
    const shouldEnable = typeof force === 'boolean' ? force : !state.sourceMode;
    if (shouldEnable === state.sourceMode) return;
    if (shouldEnable) { commitActiveBlock(); sourceEditor.value = editorToMarkdown(); editor.hidden = true; sourceEditor.hidden = false; }
    else { editor.innerHTML = markdownToHtml(sourceEditor.value); sourceEditor.hidden = true; editor.hidden = false; }
    state.sourceMode = shouldEnable; app.classList.toggle('source-mode', shouldEnable);
    updateStats(); updateOutline();
    if (state.vimEnabled) requestAnimationFrame(focusVimEditor);
    else (shouldEnable ? sourceEditor : editor).focus();
  }

  function applyInlineTag(tag) {
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return toast('Select some text first');
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const element = document.createElement(tag);
    try { range.surroundContents(element); selection.removeAllRanges(); selection.addRange(range); changed(); } catch { toast('This selection cannot be formatted'); }
  }

  function addLink() {
    if (state.sourceMode) return wrapSource('[', '](https://)');
    const selection = getSelection();
    const label = selection.toString();
    if (!label) return toast('Select the text to link');
    const url = prompt('Link address:', 'https://');
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
    const title = escapeHtml(fileName.value || 'Document');
    const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;color:#333;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}h1{border-bottom:1px solid #ddd}a{color:#4183c4}blockquote{border-left:3px solid #ddd;padding-left:18px;color:#777}code,pre{font-family:monospace;background:#f5f5f5;border-radius:4px}code{padding:2px 4px}pre{padding:16px;overflow:auto}pre code{padding:0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:7px}img{max-width:100%}</style><body>${body}</body></html>`;
    downloadBlob(page, `${fileName.value || 'document'}.html`, 'text/html'); toast('HTML exported');
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
      const replacement = transform(selected || 'text');
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

  function wrapMarkdownSelection(before, after = before, placeholder = 'text') {
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
    { label: 'Rename document', shortcut: 'F2', keywords: 'title name file', run: () => { commitActiveBlock(); fileName.focus(); fileName.select(); } },
    { label: 'Find in document', shortcut: '⌘ F', keywords: 'search', run: showFind },
    { label: 'Full Markdown source', shortcut: '⌘ /', keywords: 'source code', run: () => toggleSource() },
    { label: 'Toggle Vim mode', keywords: 'vim keyboard normal insert', run: () => setVimEnabled() },
    { label: 'Normal text', keywords: 'paragraph', run: () => transformMarkdownBlock(text => text.replace(/^#{1,6}\s+/, '').replace(/^>\s+/gm, '')) },
    { label: 'Heading 1', shortcut: '⌘ 1', keywords: 'heading h1', run: () => headingCommand(1) },
    { label: 'Heading 2', shortcut: '⌘ 2', keywords: 'heading h2', run: () => headingCommand(2) },
    { label: 'Heading 3', shortcut: '⌘ 3', keywords: 'heading h3', run: () => headingCommand(3) },
    { label: 'Bold', shortcut: '⌘ B', keywords: 'bold', run: () => wrapMarkdownSelection('**') },
    { label: 'Italic', shortcut: '⌘ I', keywords: 'italic', run: () => wrapMarkdownSelection('*') },
    { label: 'Inline code', shortcut: '⌘ `', keywords: 'code', run: () => wrapMarkdownSelection('`') },
    { label: 'Strikethrough', keywords: 'strike', run: () => wrapMarkdownSelection('~~') },
    { label: 'Link', keywords: 'link url', run: () => wrapMarkdownSelection('[', '](https://)', 'text') },
    { label: 'Image', keywords: 'photo image url', run: () => wrapMarkdownSelection('![', '](https://)', 'description') },
    { label: 'Bulleted list', shortcut: '⇧⌘ 8', keywords: 'list bullet', run: () => prefixMarkdownLines('- ') },
    { label: 'Numbered list', shortcut: '⇧⌘ 7', keywords: 'list ordered', run: () => prefixMarkdownLines('', true) },
    { label: 'Task', keywords: 'task checkbox', run: () => prefixMarkdownLines('- [ ] ') },
    { label: 'Quote', keywords: 'quote blockquote', run: () => prefixMarkdownLines('> ') },
    { label: 'Code block', keywords: 'code fence', run: () => transformMarkdownBlock(text => `\`\`\`\n${text}\n\`\`\``) },
    { label: 'Table', keywords: 'table rows columns', run: () => transformMarkdownBlock(() => '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |') },
    { label: 'Divider', keywords: 'separator line hr', run: () => transformMarkdownBlock(() => '---') },
    { label: 'Light theme', keywords: 'appearance light', run: () => setTheme('light') },
    { label: 'Sepia theme', keywords: 'appearance sepia', run: () => setTheme('sepia') },
    { label: 'Dark theme', keywords: 'appearance dark', run: () => setTheme('dark') }
  ];

  function goToHeading(index, line) {
    if (state.sourceMode) {
      const position = sourceEditor.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
      sourceEditor.focus(); sourceEditor.setSelectionRange(position, position); centerCaret(); return;
    }
    commitActiveBlock();
    const heading = $$('h1,h2,h3,h4,h5,h6', editor)[index];
    heading?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function contextualCommands(query) {
    const markdown = currentMarkdown();
    const recentCommands = getStoredDocs().map(doc => ({
      label: `Recent: ${doc.name}`,
      shortcut: relativeDate(doc.updated),
      keywords: 'recent files documents open',
      run: () => requestAction(() => loadMarkdown(doc.markdown, doc.name, { id: doc.id }))
    }));
    const headingCommands = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match, index) => ({
      label: `Outline: ${match[2].replace(/[*_`]/g, '')}`,
      shortcut: `H${match[1].length}`,
      keywords: 'outline title heading section',
      run: () => goToHeading(index, markdown.slice(0, match.index).split('\n').length)
    }));
    const removeCommands = query.includes('remove') ? getStoredDocs().map(doc => ({
      label: `Remove recent: ${doc.name}`,
      keywords: 'remove delete recent',
      run: () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getStoredDocs().filter(item => item.id !== doc.id)));
        toast('Document removed from recent files');
      }
    })) : [];
    return [...recentCommands, ...headingCommands, ...removeCommands];
  }

  function renderCommandList() {
    const query = $('#commandInput').value.trim().toLowerCase();
    filteredCommands = [...commands, ...contextualCommands(query)].filter(command => `${command.label} ${command.keywords || ''}`.toLowerCase().includes(query));
    selectedCommand = Math.max(0, Math.min(selectedCommand, filteredCommands.length - 1));
    $('#commandList').innerHTML = filteredCommands.length ? filteredCommands.map((command, index) =>
      `<button class="command-item${index === selectedCommand ? ' selected' : ''}" data-command-index="${index}" role="option" aria-selected="${index === selectedCommand}"><span>${escapeHtml(command.label)}</span>${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ''}</button>`
    ).join('') : '<div class="command-empty">No commands found</div>';
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
  document.addEventListener('pointerdown', event => {
    if (activeSourceBlock && !editor.contains(event.target) && !$('#commandPalette').contains(event.target)) commitActiveBlock();
  }, true);
  editor.addEventListener('focusout', () => setTimeout(() => {
    if (activeSourceBlock && $('#commandPalette').hidden && !editor.contains(document.activeElement)) commitActiveBlock();
  }));
  const quickCommands = {
    new: () => requestAction(newDocument),
    open: () => requestAction(openFile),
    save: saveFile,
    export: exportHtml
  };
  $('#commandQuickActions').addEventListener('click', event => {
    const button = event.target.closest('[data-quick-command]');
    const command = button && quickCommands[button.dataset.quickCommand];
    if (!command) return;
    closeCommandPalette(false); command(); paletteContext = null;
  });
  $('#commandButton').addEventListener('click', showCommandPalette);
  document.addEventListener('keydown', handleVimKeydown, true);
  document.addEventListener('pointerup', event => {
    if (!state.vimEnabled || state.vimMode !== 'normal') return;
    const field = event.target === sourceEditor ? sourceEditor : (event.target === activeSourceBlock ? activeSourceBlock : null);
    if (field) requestAnimationFrame(() => showVimCursor(field, field.selectionStart));
  });
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
  fileName.addEventListener('blur', () => { if (!fileName.value.trim()) fileName.value = 'Untitled'; persistLocal(false); });
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

  function setTheme(theme) {
    app.classList.remove('theme-sepia', 'theme-dark'); if (theme !== 'light') app.classList.add(`theme-${theme}`);
    saveSettings({ theme });
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
    if (event.key === 'F1' || (mod && key === 'k') || (mod && event.shiftKey && key === 'p')) { event.preventDefault(); showCommandPalette(); return; }
    if (!$('#commandPalette').hidden) return;
    if (mod && event.shiftKey && key === 'e') { event.preventDefault(); exportHtml(); return; }
    if (mod && event.shiftKey && event.code === 'Digit7') { event.preventDefault(); prefixMarkdownLines('', true); return; }
    if (mod && event.shiftKey && event.code === 'Digit8') { event.preventDefault(); prefixMarkdownLines('- '); return; }
    if (mod && ['1', '2', '3'].includes(event.key)) { event.preventDefault(); headingCommand(Number(event.key)); return; }
    if (mod && key === 's') { event.preventDefault(); saveFile(); return; }
    if (mod && key === 'o') { event.preventDefault(); requestAction(openFile); return; }
    if (mod && key === 'n') { event.preventDefault(); requestAction(newDocument); return; }
    if (mod && key === 'f') { event.preventDefault(); showFind(); return; }
    if (mod && key === 'b') { event.preventDefault(); wrapMarkdownSelection('**'); return; }
    if (mod && key === 'i') { event.preventDefault(); wrapMarkdownSelection('*'); return; }
    if (mod && event.key === '`') { event.preventDefault(); wrapMarkdownSelection('`'); return; }
    if (mod && event.key === '/') { event.preventDefault(); toggleSource(); return; }
    if (event.key === 'Escape') $('#findbar').hidden = true;
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
  setVimEnabled(Boolean(settings.vimEnabled), false);
  let docs = getStoredDocs();
  if (settings.welcomeVersion !== WELCOME_VERSION) {
    const welcome = docs.find(doc => doc.name === 'Welcome' || doc.name === 'Benvenuto');
    if (welcome) { welcome.name = 'Welcome'; welcome.markdown = starter; welcome.updated = Date.now(); }
    else if (docs.length) docs = [...docs.slice(0, 9), { id: 'markd-welcome', name: 'Welcome', markdown: starter, updated: Date.now() }];
    if (docs.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(docs.slice(0, 10)));
    saveSettings({ welcomeVersion: WELCOME_VERSION });
  }
  docs = getStoredDocs();
  if (docs.length) loadMarkdown(docs[0].markdown, docs[0].name, { id: docs[0].id });
  else loadMarkdown(starter, 'Welcome');

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
