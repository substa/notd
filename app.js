(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const app = $('#app');
  const editor = $('#editor');
  const sourceEditor = $('#sourceEditor');
  const markdWrap = $('#markdWrap');
  const outliner = $('#outliner');
  const blockTree = $('#blockTree');
  const pageHierarchy = $('#pageHierarchy');
  const references = $('#references');
  const graphAutocomplete = $('#graphAutocomplete');
  const mobileBlockToolbar = $('#mobileBlockToolbar');
  const documentationView = $('#documentationView');
  const documentationContent = $('#documentationContent');
  const journalCalendar = $('#journalCalendar');
  const fileName = $('#fileName');
  const fileInput = $('#fileInput');
  const saveState = $('#saveState');
  const STORAGE_KEY = 'markd-markdown-documents-v1';
  const SETTINGS_KEY = 'markd-markdown-settings-v1';

  let state = {
    markdown: '', fileHandle: null, dirty: false, sourceMode: false,
    vimEnabled: false, vimMode: 'normal', currentId: null, pendingAction: null, saveTimer: null,
    graphMode: false, graphPage: null, graphDocument: null, graphZoomId: null, graphConflict: false,
    journalMode: false, journalLimit: 8
  };
  let journalDocuments = new Map();
  let graphHistory = [];
  let graphHistoryIndex = -1;
  let graphStore = null;
  let graphIndex = null;
  let paletteGraphStatsCache = null;
  let closeRemoteEvents = null;
  let remoteRefreshTimer = null;
  let remoteRefreshPending = false;
  let activeGraphBlock = null;
  let graphDraftTimer = null;
  let activeSourceBlock = null;
  let paletteContext = null;
  let filteredCommands = [];
  let expandedCommandSections = new Set();
  let selectedCommand = 0;
  let calendarViewDate = new Date();
  let calendarFocusDate = new Date();
  let calendarSelectAction = null;
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

Use **⌘/Ctrl + K** or **⌘/Ctrl + Shift + P** to open the command palette. Inside a graph block, type **/** for inline commands such as journals and date references. Type a command name, move with the arrow keys, and press Enter.

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
    return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(decoded) || !/^[a-z][a-z0-9+.-]*:/i.test(decoded) ? escapeHtml(decoded) : '#';
  }

  const syntaxKeywords = {
    javascript: new Set('as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch throw try typeof var void while with yield true false null undefined'.split(' ')),
    python: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' ')),
    shell: new Set('case do done elif else esac fi for function if in select then time until while'.split(' ')),
    json: new Set('true false null'.split(' ')),
    css: new Set('@charset @font-face @import @keyframes @media @page @supports important'.split(' ')),
    sql: new Set('all alter and as asc between by case create delete desc distinct drop else end exists from group having in inner insert into is join left like limit not null on or order outer right select set table then union update values when where'.split(' '))
  };

  const syntaxBuiltins = {
    javascript: new Set('Array Boolean console Date document Error JSON Map Math Number Object Promise RegExp Set String window'.split(' ')),
    python: new Set('bool dict enumerate filter float int len list map max min open print range set str sum tuple zip'.split(' ')),
    shell: new Set('alias cd echo env exec exit export printf pwd read set source test trap unset'.split(' ')),
    css: new Set('background border color display flex font gap grid height margin padding position transform transition width'.split(' ')),
    sql: new Set('avg count max min sum'.split(' '))
  };

  function syntaxLanguage(language = '') {
    const name = language.toLowerCase().replace(/[^a-z0-9+#-]/g, '');
    if (['js', 'jsx', 'ts', 'tsx', 'node'].includes(name)) return 'javascript';
    if (['py', 'python3'].includes(name)) return 'python';
    if (['sh', 'bash', 'zsh', 'fish', 'console', 'terminal'].includes(name)) return 'shell';
    if (['html', 'xml', 'svg', 'markup'].includes(name)) return 'html';
    if (['yml', 'yaml'].includes(name)) return 'shell';
    return name || 'plain';
  }

  function highlightCode(code, language = '') {
    const lang = syntaxLanguage(language);
    const pieces = [];
    let last = 0;
    const emitMatches = pattern => {
      for (const match of code.matchAll(pattern)) {
        pieces.push(escapeHtml(code.slice(last, match.index)));
        let type = '';
        const token = match[0];
        if (/^(?:\/\*|\/\/|#|--|<!--)/.test(token)) type = 'comment';
        else if (lang === 'html' && /^<\/?[A-Za-z]/.test(token)) type = 'tag';
        else if (/^["'`]/.test(token)) type = 'string';
        else if (/^(?:\d|\.\d)/.test(token)) type = 'number';
        else if (syntaxKeywords[lang]?.has(token) || syntaxKeywords[lang]?.has(token.toLowerCase())) type = 'keyword';
        else if (syntaxBuiltins[lang]?.has(token) || syntaxBuiltins[lang]?.has(token.toLowerCase())) type = 'builtin';
        else if (/^[+*/%=!<>&|?:~^$@-]+$/.test(token)) type = 'operator';
        pieces.push(type ? `<span class="syntax-${type}">${escapeHtml(token)}</span>` : escapeHtml(token));
        last = match.index + token.length;
      }
      pieces.push(escapeHtml(code.slice(last)));
      return pieces.join('');
    };

    if (lang === 'html') return emitMatches(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g);
    const comments = ['python', 'shell'].includes(lang) ? '#.*$' : lang === 'sql' ? '--.*$|\\/\\*[\\s\\S]*?\\*\\/' : lang === 'json' ? '(?!)' : '\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*$';
    const pattern = new RegExp(`${comments}|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`|\\b(?:0x[\\da-f]+|\\d+(?:\\.\\d+)?)\\b|[A-Za-z_$@][\\w$@-]*|[+*/%=!<>&|?:~^$@-]+`, 'gmi');
    return emitMatches(pattern);
  }

  function highlightedCodeBlock(code, language = '') {
    const label = language.trim();
    const safeLanguage = syntaxLanguage(label);
    return `<pre${label ? ` data-lang="${escapeHtml(label)}"` : ''} class="graph-code-block"><code class="language-${safeLanguage}">${highlightCode(code, label)}</code></pre>`;
  }

  function fenceOpening(line = '') {
    const opening = line.match(/^\s*(`{3,}|~{3,})[^\S\n]*([^\s`]*)[^\n]*$/);
    if (!opening) return null;
    return { marker: opening[1], language: opening[2] || '' };
  }

  function fenceClosing(line, marker) {
    return new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(line);
  }

  function orgQuoteOpening(line = '') { return /^\s*#\+BEGIN_QUOTE\b.*$/i.test(line); }
  function orgQuoteClosing(line = '') { return /^\s*#\+END_QUOTE\s*$/i.test(line); }

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
    value = value.replace(/\*\*\*([^*\n]+)\*\*\*|___([^_\n]+)___/g, '<strong><em>$1$2</em></strong>');
    value = value.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, '<strong>$1$2</strong>');
    value = value.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    value = value.replace(/(^|[^*])\*([^*\n]+)\*|(^|[^_])_([^_\n]+)_/g, (_, a, b, c, d) => `${a ?? c ?? ''}<em>${b ?? d}</em>`);
    value = value.replace(/ {2}$/g, '<br>');
    value = value.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
    return value;
  }

  function isBlockStart(lines, i) {
    const line = lines[i] || '';
    const next = lines[i + 1] || '';
    return /^\s*(#{1,6})\s+/.test(line) || /^\s*(```|~~~)/.test(line) || orgQuoteOpening(line) || /^\s*>/.test(line) ||
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
        const safeLanguage = syntaxLanguage(lang);
        html.push(`<pre${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code class="language-${safeLanguage}">${highlightCode(content.join('\n'), lang)}</code></pre>`);
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

      if (orgQuoteOpening(line)) {
        const quote = []; i++;
        while (i < lines.length && !orgQuoteClosing(lines[i])) quote.push(lines[i++]);
        if (i < lines.length) i++;
        html.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`); continue;
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
    if (state.graphMode) return state.sourceMode ? sourceEditor.value : MarkdGraph.serializeDocument(state.graphDocument);
    return state.sourceMode ? sourceEditor.value : editorToMarkdown();
  }

  function graphBlockLocation(id, blocks = state.graphDocument?.blocks || [], parent = null) {
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (block.id === id) return { block, blocks, index, parent };
      const nested = graphBlockLocation(id, block.children, block);
      if (nested) return nested;
    }
    return null;
  }

  function visibleGraphBlocks(blocks = state.graphDocument?.blocks || [], result = []) {
    for (const block of blocks) {
      result.push(block);
      if (!block.collapsed) visibleGraphBlocks(block.children, result);
    }
    return result;
  }

  function restoreGraphCollapse(document = state.graphDocument, page = state.graphPage) {
    let settings = {}; try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
    const collapsed = new Set(settings.graphCollapsed?.[page?.path] || []);
    MarkdGraph.flattenBlocks(document?.blocks).forEach(({ block }) => { block.collapsed = collapsed.has(block.id); });
  }

  function saveGraphCollapse() {
    if (!state.graphPage) return;
    let settings = {}; try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
    const ids = MarkdGraph.flattenBlocks(state.graphDocument?.blocks).filter(({ block }) => block.collapsed).map(({ block }) => block.id);
    saveSettings({ graphCollapsed: { ...(settings.graphCollapsed || {}), [state.graphPage.path]: ids } });
  }

  const hiddenGraphProperties = new Set([
    'alias', 'aliases', 'background-color', 'collapsed', 'created-at', 'exclude-from-graph-view',
    'heading', 'icon', 'id', 'public', 'tags', 'template', 'template-including-parent', 'title', 'type', 'updated-at'
  ]);

  function visibleGraphPreamble(lines = []) {
    let frontmatter = false;
    return lines.filter((line, index) => {
      if (/^\s*---\s*$/.test(line) && (frontmatter || index === 0)) { frontmatter = !frontmatter; return false; }
      if (frontmatter) return false;
      return !/^\s*[\w-]+::\s*/.test(line);
    }).join('\n').trim();
  }

  function graphTextHtml(text, block) {
    const value = text.replace(/^\n+|\n+$/g, '');
    if (!value) return '';
    const quote = value.split('\n').every(line => /^\s*>/.test(line));
    let html = quote
      ? `<blockquote>${inlineMarkdown(value.split('\n').map(line => line.replace(/^\s*>\s?/, '')).join('\n')).replace(/\n/g, '<br>')}</blockquote>`
      : inlineMarkdown(value).replace(/\n/g, '<br>');
    html = html.replace(/^(TODO|DOING|DONE)\b/, status => `<button class="graph-task graph-task-${status.toLowerCase()}" data-task-block="${escapeHtml(block.id)}">${status}</button>`);
    html = html.replace(/\[\[([^\]]+?)\]\]/g, (_, target) => {
      const [page, alias] = target.split('|');
      return `<button class="graph-page-ref" data-page="${escapeHtml(page.trim())}">${alias ? escapeHtml(alias.trim()) : escapeHtml(page.trim())}</button>`;
    });
    html = html.replace(/\(\(([0-9a-z-]{8,})\)\)/gi, (_, uuid) => {
      const resolved = graphIndex?.resolveBlock(uuid);
      const label = resolved ? resolved.content.split('\n')[0].replace(/^\s*(?:[\w-]+::.*)?$/, '').trim() || uuid : uuid;
      return `<button class="graph-block-ref" data-block-ref="${escapeHtml(uuid)}" title="${escapeHtml(uuid)}">${escapeHtml(label)}</button>`;
    });
    return html.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1<button class="graph-tag" data-page="$2">#$2</button>');
  }

  function graphMixedMarkdownHtml(value, block) {
    const lines = value.replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let text = [];
    const flushText = () => {
      const rendered = graphTextHtml(text.join('\n'), block);
      if (rendered) html.push(rendered);
      text = [];
    };
    for (let index = 0; index < lines.length;) {
      if (orgQuoteOpening(lines[index])) {
        flushText();
        const quote = []; index++;
        while (index < lines.length && !orgQuoteClosing(lines[index])) quote.push(lines[index++]);
        if (index < lines.length) index++;
        html.push(`<blockquote>${graphTextHtml(quote.join('\n'), block)}</blockquote>`);
        continue;
      }
      const opening = fenceOpening(lines[index]);
      if (opening) {
        flushText();
        const code = [];
        index++;
        while (index < lines.length && !fenceClosing(lines[index], opening.marker)) code.push(lines[index++]);
        if (index < lines.length) index++;
        html.push(highlightedCodeBlock(code.join('\n'), opening.language));
        continue;
      }
      const heading = lines[index].match(/^\s*(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
      if (heading) {
        flushText();
        const level = heading[1].length;
        html.push(`<h${level} class="graph-heading">${graphTextHtml(heading[2], block)}</h${level}>`);
        index++;
        continue;
      }
      text.push(lines[index]); index++;
    }
    flushText();
    return html.join('');
  }

  function graphDisplayContent(block) {
    const propertyLines = [];
    let activeFence = null; let activeOrgQuote = false;
    const visible = String(block.content || '').split('\n').filter(line => {
      if (!activeFence && !activeOrgQuote && orgQuoteOpening(line)) { activeOrgQuote = true; return true; }
      if (activeOrgQuote) { if (orgQuoteClosing(line)) activeOrgQuote = false; return true; }
      const opening = !activeFence && fenceOpening(line);
      if (opening) { activeFence = opening.marker; return true; }
      if (activeFence) {
        if (fenceClosing(line, activeFence)) activeFence = null;
        return true;
      }
      const property = line.match(/^\s*([\w-]+)::\s*(.*?)\s*$/);
      if (property) { if (!hiddenGraphProperties.has(property[1].toLowerCase())) propertyLines.push(property); return false; }
      return true;
    }).join('\n').trimEnd();
    let html = graphMixedMarkdownHtml(visible, block);
    if (propertyLines.length) html += `${html ? '<br>' : ''}${propertyLines.map(item => `<span class="graph-property">${escapeHtml(item[1])} · ${escapeHtml(item[2])}</span>`).join('')}`;
    return html;
  }

  function graphContentElement(block, page = state.graphPage) {
    const content = document.createElement('div');
    content.className = 'graph-block-content';
    content.dataset.blockId = block.id; content.dataset.pagePath = page?.path || '';
    content.innerHTML = graphDisplayContent(block);
    if (graphStore && page) {
      const fromFolder = page.path?.includes('/') ? page.path.split('/').slice(0, -1).join('/') : (page.folder || '');
      $$('img', content).forEach(image => {
        const source = image.getAttribute('src');
        if (source && !/^[a-z]+:/i.test(source)) graphStore.assetUrl(source, fromFolder).then(url => { if (image.isConnected) image.src = url; }).catch(() => {
          image.classList.add('asset-error'); image.title = `Image not found: ${source}`;
        });
      });
    }
    return content;
  }

  function orderedJournalPages() {
    if (!graphStore) return [];
    const today = MarkdGraph.journalInfo(new Date(), graphStore.config).date;
    return graphStore.pages.filter(page => page.journal)
      .sort((a, b) => {
        if (a.journalDate === today) return -1; if (b.journalDate === today) return 1;
        return (b.journalDate || b.name).localeCompare(a.journalDate || a.name);
      });
  }

  function cachedJournalDocument(page) {
    if (page.path === state.graphPage?.path) return state.graphDocument;
    if (!journalDocuments.has(page.path)) {
      const document = MarkdGraph.parseDocument(page.content); restoreGraphCollapse(document, page);
      journalDocuments.set(page.path, document);
    }
    return journalDocuments.get(page.path);
  }

  function renderGraphPage() {
    if (!state.graphMode || !state.graphDocument) return;
    activeGraphBlock = null; mobileBlockToolbar.hidden = true;
    const renderBlocks = (blocks, page = state.graphPage) => {
      const fragment = document.createDocumentFragment();
      for (const block of blocks) {
        const node = document.createElement('div');
        node.className = `block-node${block.children.length ? ' has-children' : ''}${block.collapsed ? ' collapsed' : ''}`;
        node.dataset.blockId = block.id; node.dataset.pagePath = page?.path || '';
        const row = document.createElement('div'); row.className = 'block-row';
        let toggle;
        if (block.children.length) {
          toggle = document.createElement('button'); toggle.className = 'block-toggle'; toggle.type = 'button';
          toggle.dataset.blockToggle = block.id;
          toggle.setAttribute('aria-label', block.collapsed ? 'Expand nested blocks' : 'Collapse nested blocks');
        } else {
          toggle = document.createElement('span'); toggle.className = 'block-toggle-spacer';
        }
        const bullet = document.createElement('button');
        bullet.className = 'block-bullet'; bullet.type = 'button'; bullet.dataset.blockBullet = block.id;
        bullet.setAttribute('aria-label', 'Zoom into block');
        const blockContent = graphContentElement(block, page);
        const firstHeading = blockContent.firstElementChild;
        if (firstHeading?.classList.contains('graph-heading')) row.classList.add('graph-heading-row', `graph-heading-row-${firstHeading.tagName.slice(1)}`);
        row.append(toggle, bullet, blockContent); node.append(row);
        if (block.children.length) {
          const children = document.createElement('div'); children.className = 'block-children'; children.append(renderBlocks(block.children, page)); node.append(children);
        }
        fragment.append(node);
      }
      return fragment;
    };

    const fragment = document.createDocumentFragment();
    if (state.journalMode && !state.graphZoomId) {
      const pages = orderedJournalPages().slice(0, state.journalLimit);
      const today = MarkdGraph.journalInfo(new Date(), graphStore.config).date;
      for (const page of pages) {
        const journalDocument = cachedJournalDocument(page); const section = document.createElement('section');
        section.className = `journal-entry${page.path === state.graphPage.path ? ' active' : ''}${page.journalDate === today ? ' today' : ''}`; section.dataset.journalPath = page.path;
        const heading = document.createElement('button'); heading.type = 'button'; heading.className = 'journal-heading';
        heading.dataset.journalPage = page.path; heading.textContent = page.title; section.append(heading);
        const preamble = visibleGraphPreamble(journalDocument.preamble);
        if (preamble) { const properties = document.createElement('div'); properties.className = 'journal-preamble'; properties.textContent = preamble; section.append(properties); }
        const tree = document.createElement('div'); tree.className = 'journal-blocks'; tree.append(renderBlocks(journalDocument.blocks, page)); section.append(tree); fragment.append(section);
      }
      if (pages.length < orderedJournalPages().length) {
        const more = document.createElement('div'); more.className = 'journal-more'; more.dataset.journalMore = ''; fragment.append(more);
      }
    } else {
      let roots = state.graphDocument.blocks;
      if (state.graphZoomId) roots = [graphBlockLocation(state.graphZoomId)?.block].filter(Boolean);
      fragment.append(renderBlocks(roots));
    }
    blockTree.replaceChildren(fragment);
    const preamble = $('#pagePreamble');
    const preambleText = visibleGraphPreamble(state.graphDocument.preamble);
    preamble.hidden = state.journalMode || !preambleText; preamble.textContent = preambleText;
    const breadcrumb = $('#zoomBreadcrumb');
    breadcrumb.hidden = !state.graphZoomId;
    breadcrumb.innerHTML = state.graphZoomId ? `<button type="button" data-clear-zoom>${escapeHtml(state.graphPage?.title || 'Page')}</button> / Block` : '';
    renderPageHierarchy(); renderReferences();
    if (state.journalMode && !state.graphZoomId && state.journalLimit < orderedJournalPages().length) requestAnimationFrame(() => {
      if (state.journalMode && markdWrap.scrollHeight <= markdWrap.clientHeight + 80) { state.journalLimit += 8; renderGraphPage(); }
    });
  }

  function resizeGraphEditor(field) {
    field.style.height = '0'; field.style.height = `${Math.max(32, field.scrollHeight)}px`;
  }

  function commitGraphBlock() {
    if (!activeGraphBlock) return;
    const { block, field, page } = activeGraphBlock;
    if (state.vimEnabled && state.vimMode === 'insert') finishVimInsertChange(field);
    activeGraphBlock = null; mobileBlockToolbar.hidden = true;
    if (state.vimEnabled) { state.vimMode = 'normal'; vimPending = ''; vimDesiredColumn = null; updateVimUi(); }
    hideGraphAutocomplete();
    if (field.isConnected) field.replaceWith(graphContentElement(block, page));
  }

  function activateGraphBlock(block, position = null, page = state.graphPage) {
    if (!block || state.sourceMode) return;
    if (activeGraphBlock?.block === block) return activeGraphBlock.field.focus();
    commitGraphBlock();
    const content = $$('.graph-block-content', blockTree).find(element => element.dataset.blockId === block.id && element.dataset.pagePath === (page?.path || ''));
    if (!content) return;
    const field = document.createElement('textarea');
    field.className = 'graph-block-editor'; field.spellcheck = true; field.value = block.content;
    if (field.value.split('\n').some(line => fenceOpening(line))) field.classList.add('graph-code-editor');
    else if (field.value && (field.value.split('\n').every(line => /^\s*>/.test(line)) || field.value.split('\n').some(orgQuoteOpening))) field.classList.add('graph-quote-editor');
    field.dataset.blockId = block.id;
    field.addEventListener('beforeinput', event => {
      if (matchMedia('(max-width:720px)').matches && /^(insert|delete)/.test(event.inputType || '')) recordVimChange(field);
    });
    field.addEventListener('input', handleGraphBlockInput);
    field.addEventListener('keydown', handleGraphBlockKeydown);
    field.addEventListener('keyup', event => {
      if (event.key.length === 1 || ['Backspace', 'Delete'].includes(event.key)) showGraphAutocomplete(field);
    });
    field.addEventListener('compositionend', () => showGraphAutocomplete(field));
    field.addEventListener('blur', () => setTimeout(() => {
      if (activeGraphBlock?.field === field && $('#commandPalette').hidden && !graphAutocomplete.contains(document.activeElement) && !journalCalendar.contains(document.activeElement) && !mobileBlockToolbar.contains(document.activeElement)) commitGraphBlock();
    }));
    field.dataset.pagePath = page?.path || '';
    content.replaceWith(field); activeGraphBlock = { block, field, page }; mobileBlockToolbar.hidden = false; resizeGraphEditor(field);
    const caret = position === null ? field.value.length : Math.max(0, Math.min(position, field.value.length));
    field.focus({ preventScroll: true }); field.setSelectionRange(caret, caret);
    if (state.vimEnabled) setVimMode(state.vimMode, field, caret);
  }

  function focusGraphBlock(id, position = null) {
    renderGraphPage();
    const focus = () => {
      const location = graphBlockLocation(id); if (!location) return false;
      activateGraphBlock(location.block, position);
      const field = activeGraphBlock?.block?.id === id ? activeGraphBlock.field : null;
      if (!field) return false;
      const caret = position === null ? field.value.length : Math.max(0, Math.min(position, field.value.length));
      field.focus({ preventScroll: true });
      if (state.vimEnabled && state.vimMode === 'normal') showVimCursor(field, caret); else field.setSelectionRange(caret, caret);
      return true;
    };
    focus();
    requestAnimationFrame(() => {
      if (document.activeElement !== activeGraphBlock?.field) focus();
      activeGraphBlock?.field.scrollIntoView({ block: 'nearest' });
    });
  }

  let graphIndexTimer = null;
  function updateGraphIndex() {
    if (!graphIndex || !state.graphPage) return;
    graphIndex.updatePage(state.graphPage, currentMarkdown());
    renderReferences();
  }

  function graphChanged() {
    if (!state.graphMode || !state.graphPage) return;
    state.dirty = true;
    saveState.textContent = state.graphConflict ? 'Conflict' : 'Modified';
    clearTimeout(state.saveTimer); state.saveTimer = setTimeout(() => flushGraphSave(false), 650);
    clearTimeout(graphDraftTimer); graphDraftTimer = setTimeout(() => {
      MarkdGraph.saveDraft(state.graphPage.path, { content: currentMarkdown(), modified: state.graphPage.lastModified }).catch(() => {});
    }, 120);
    clearTimeout(graphIndexTimer); graphIndexTimer = setTimeout(updateGraphIndex, 240);
    updateStats();
  }

  let graphSaving = null;
  async function flushGraphSave(interactive = false, force = false) {
    if (!state.graphMode || !state.graphPage || !state.dirty) return true;
    if (state.graphConflict && !force) {
      saveState.textContent = 'Conflict';
      if (!interactive || !confirm('The recovered draft conflicts with the file on disk. Overwrite the disk version?')) return false;
      force = true;
    }
    if (graphSaving) { await graphSaving; if (!state.dirty) return true; }
    const page = state.graphPage; const content = currentMarkdown();
    clearTimeout(graphDraftTimer);
    await MarkdGraph.saveDraft(page.path, { content, modified: page.lastModified }).catch(() => {});
    saveState.textContent = 'Saving…';
    graphSaving = (async () => {
      try {
        try { await graphStore.writePage(page, content, { force }); }
        catch (error) {
          if (error.name !== 'ConflictError') throw error;
          state.graphConflict = true; saveState.textContent = 'Conflict';
          if (!interactive || !confirm('This page changed on disk. Overwrite the external changes?')) return false;
          await graphStore.writePage(page, content, { force: true });
        }
        graphIndex.updatePage(page, content);
        await MarkdGraph.removeDraft(page.path).catch(() => {});
        if (state.graphPage === page && currentMarkdown() === content) {
          state.dirty = false; app.classList.remove('dirty'); saveState.textContent = 'Saved';
        }
        state.graphConflict = false;
        if (remoteRefreshPending) scheduleRemoteRefresh();
        return true;
      } catch (error) {
        saveState.textContent = 'Save failed'; if (interactive) toast(error.message || 'Could not save the page');
        return false;
      }
    })();
    const result = await graphSaving; graphSaving = null; return result;
  }

  function updateCurrentHistoryPosition() {
    const entry = graphHistory[graphHistoryIndex];
    if (!entry || entry.path !== state.graphPage?.path) return;
    entry.scrollTop = markdWrap.scrollTop; entry.blockId = state.graphZoomId || null; entry.journalMode = state.journalMode;
  }

  function recordGraphHistory(page, options) {
    if (options.historyNavigation) return;
    updateCurrentHistoryPosition();
    const entry = { path: page.path, title: page.title, journalMode: Boolean(options.journalMode), blockId: options.blockId || null, scrollTop: 0 };
    const current = graphHistory[graphHistoryIndex];
    if (current && current.path === entry.path && current.journalMode === entry.journalMode && current.blockId === entry.blockId) return;
    graphHistory = graphHistory.slice(0, graphHistoryIndex + 1); graphHistory.push(entry); graphHistoryIndex = graphHistory.length - 1;
  }

  function rememberGraphPage(page) {
    let settings = {}; try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
    const item = { graph: graphStore?.name || '', path: page.path, title: page.title };
    const recentGraphPages = [item, ...(settings.recentGraphPages || []).filter(recent => recent.graph !== item.graph || recent.path !== item.path)].slice(0, 20);
    saveSettings({ lastGraphPage: page.title, recentGraphPages });
  }

  function graphRoutePath(page) {
    const journal = page.journal || page.path.startsWith('journals/');
    let name = journal ? page.path.replace(/^journals\//, '').replace(/\.(?:md|markdown)$/i, '') : page.title;
    name = name.split('/').filter(Boolean).map(part => encodeURIComponent(part)).join('/');
    return `/${journal ? 'journals' : 'pages'}/${name}`;
  }

  function graphRoute() {
    const clean = location.pathname.match(/^\/(pages|journals)\/(.+?)\/?$/);
    if (clean) {
      try { return { cleanPath: `/${clean[1]}/${decodeURIComponent(clean[2])}`, journalMode: clean[1] === 'journals' }; }
      catch { return null; }
    }
    const legacy = location.hash.match(/^#\/(page|journal)\/(.+)$/);
    if (!legacy) return null;
    try { return { path: decodeURIComponent(legacy[2]), journalMode: legacy[1] === 'journal', legacy: true }; }
    catch { return null; }
  }

  function syncGraphRoute(page, options = {}) {
    if (!page || options.routeNavigation) return;
    const path = graphRoutePath(page);
    if (location.pathname === path && !location.hash) return;
    const method = options.replaceRoute || options.historyNavigation ? 'replaceState' : 'pushState';
    history[method]({ markdPage: page.path }, '', `${path}${location.search}`);
  }

  function pageFromGraphRoute(route) {
    if (!route) return null;
    if (route.path) return graphStore?.pages.find(page => page.path === route.path);
    return graphStore?.pages.find(page => {
      try { return decodeURIComponent(graphRoutePath(page)) === route.cleanPath; }
      catch { return false; }
    }) || null;
  }

  async function openGraphLanding(options = {}) {
    const route = graphRoute();
    const page = pageFromGraphRoute(route);
    if (page) return loadGraphPage(page, { journalMode: route.journalMode, routeNavigation: !route.legacy, replaceRoute: Boolean(route.legacy) });
    await openToday(true, { replaceRoute: Boolean(options.replaceRoute) });
  }

  async function navigateGraphHistory(direction) {
    if (!state.graphMode) return;
    updateCurrentHistoryPosition();
    const targetIndex = graphHistoryIndex + direction; const entry = graphHistory[targetIndex];
    if (!entry) return toast(direction < 0 ? 'No previous page' : 'No next page');
    const page = graphStore.pages.find(item => item.path === entry.path) || graphIndex.resolvePage(entry.title);
    if (!page) return toast('Page no longer exists');
    await loadGraphPage(page, { journalMode: entry.journalMode, blockId: entry.blockId, historyNavigation: true });
    if (state.graphPage?.path !== page.path || state.journalMode !== entry.journalMode) return;
    graphHistoryIndex = targetIndex;
    requestAnimationFrame(() => { markdWrap.scrollTop = entry.scrollTop || 0; });
  }

  async function loadGraphPage(pageOrTitle, options = {}) {
    if (!graphStore || !graphIndex) return;
    if (state.graphMode && state.dirty && !(await flushGraphSave(true))) return;
    if (state.journalMode && state.graphPage && state.graphDocument) journalDocuments.set(state.graphPage.path, state.graphDocument);
    let page = typeof pageOrTitle === 'string' ? graphIndex.resolvePage(pageOrTitle) : pageOrTitle;
    if (!page && typeof pageOrTitle === 'string' && options.create !== false) {
      page = await graphStore.createPage(pageOrTitle, options);
      graphIndex.rebuild(graphStore.pages);
    }
    if (!page) return toast('Page not found');
    const draft = await MarkdGraph.getDraft(page.path).catch(() => null);
    const content = draft?.content ?? page.content;
    const draftConflict = Boolean(draft?.modified && draft.modified !== page.lastModified);
    recordGraphHistory(page, options);
    state.graphMode = true; state.graphPage = page; state.graphDocument = MarkdGraph.parseDocument(content); restoreGraphCollapse();
    state.journalMode = Boolean(options.journalMode); state.journalLimit = options.resetJournalLimit ? 8 : state.journalLimit;
    if (state.journalMode) journalDocuments.set(page.path, state.graphDocument);
    state.graphZoomId = options.blockId || null; state.sourceMode = false; state.dirty = Boolean(draft); state.graphConflict = draftConflict; state.fileHandle = null;
    activeSourceBlock = null; activeGraphBlock = null;
    vimUndoStack.length = 0; vimRedoStack.length = 0; vimInsertSnapshot = null; state.vimMode = 'normal';
    editor.hidden = true; sourceEditor.hidden = true; outliner.hidden = false;
    app.classList.add('graph-mode'); app.classList.toggle('journal-mode', state.journalMode); app.classList.toggle('dirty', Boolean(draft));
    updateVimUi();
    fileName.value = page.title; fileName.readOnly = Boolean(page.journal); document.title = `${page.title} — ${graphStore.name} — markd`;
    rememberGraphPage(page);
    syncGraphRoute(page, options);
    renderGraphPage(); updateStats();
    saveState.textContent = draftConflict ? 'Recovery conflict' : (draft ? 'Recovered draft' : 'Ready');
    requestAnimationFrame(() => {
      if (options.blockId) blockTree.querySelector(`[data-block-id="${CSS.escape(options.blockId)}"]`)?.scrollIntoView({ block: 'center' });
      if (state.vimEnabled) focusVimEditor();
    });
  }

  async function openGraph() {
    try {
      if (state.graphMode && state.dirty && !(await flushGraphSave(true))) return;
      saveState.textContent = 'Opening graph…';
      closeRemoteEvents?.(); closeRemoteEvents = null;
      graphStore?.disposeAssets(); graphStore = await MarkdGraph.GraphStore.open();
      const pages = await graphStore.scan(); graphIndex = new MarkdGraph.GraphIndex(pages);
      journalDocuments.clear(); graphHistory = []; graphHistoryIndex = -1; await openGraphLanding();
      toast(`Opened ${graphStore.name}`);
    } catch (error) { if (error.name !== 'AbortError') toast(error.message || 'Could not open the graph'); }
  }

  async function openJournalDate(date, options = {}) {
    if (!graphStore) return openGraph();
    const journal = MarkdGraph.journalInfo(date, graphStore.config);
    let page = graphStore.pages.find(item => item.journalDate === journal.date) || graphIndex.resolvePage(journal.title);
    if (!page) {
      page = await graphStore.createPage(journal.title, { journal: true, journalDate: journal.value, filename: journal.filename });
      graphIndex.rebuild(graphStore.pages);
    }
    await loadGraphPage(page, { journalMode: true, resetJournalLimit: Boolean(options.reset), replaceRoute: Boolean(options.replaceRoute) });
    const index = orderedJournalPages().findIndex(item => item.path === page.path);
    if (index >= state.journalLimit) { state.journalLimit = index + 1; renderGraphPage(); }
    requestAnimationFrame(() => {
      const entry = blockTree.querySelector(`[data-journal-path="${CSS.escape(page.path)}"]`);
      if (options.reset) markdWrap.scrollTop = 0; else entry?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (state.vimEnabled) focusVimEditor();
    });
    return page;
  }

  function relativeJournalDate(days) {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + days); return date;
  }

  async function openSingleJournalDate(date) {
    if (!graphStore) await openGraph();
    if (!graphStore) return;
    const journal = MarkdGraph.journalInfo(date, graphStore.config);
    let page = graphStore.pages.find(item => item.journalDate === journal.date) || graphIndex.resolvePage(journal.title);
    if (!page) {
      page = await graphStore.createPage(journal.title, { journal: true, journalDate: journal.value, filename: journal.filename });
      graphIndex.rebuild(graphStore.pages);
    }
    await loadGraphPage(page, { journalMode: false });
    markdWrap.scrollTop = 0;
  }

  function renderJournalCalendar() {
    const year = calendarViewDate.getFullYear(); const month = calendarViewDate.getMonth();
    $('#calendarMonth').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(calendarViewDate);
    const first = new Date(year, month, 1, 12); const offset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset, 12);
    const today = MarkdGraph.journalInfo(new Date(), graphStore?.config).date;
    const current = state.graphPage?.journalDate;
    const focused = MarkdGraph.journalInfo(calendarFocusDate, graphStore?.config).date;
    $('#calendarDays').innerHTML = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start); date.setDate(start.getDate() + index);
      const value = MarkdGraph.journalInfo(date, graphStore?.config).date;
      const classes = [date.getMonth() !== month ? 'outside' : '', value === today ? 'today' : '', value === current ? 'current' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${classes}" data-calendar-date="${value}" tabindex="${value === focused ? '0' : '-1'}" aria-label="${escapeHtml(date.toLocaleDateString(undefined, { dateStyle: 'full' }))}">${date.getDate()}</button>`;
    }).join('');
  }

  function focusCalendarDate(date) {
    calendarFocusDate = new Date(date); calendarFocusDate.setHours(12, 0, 0, 0);
    calendarViewDate = new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth(), 1, 12);
    renderJournalCalendar();
    requestAnimationFrame(() => $('#calendarDays [tabindex="0"]')?.focus());
  }

  function moveCalendarMonth(months) {
    const day = calendarFocusDate.getDate();
    const target = new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth() + months, 1, 12);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
    target.setDate(Math.min(day, lastDay)); focusCalendarDate(target);
  }

  function toggleJournalCalendar(selectAction = null, anchor = null) {
    const opening = journalCalendar.hidden || selectAction;
    journalCalendar.hidden = !opening; $('#journalCalendarButton').setAttribute('aria-expanded', String(opening));
    if (opening) {
      calendarSelectAction = selectAction; calendarFocusDate = new Date(); calendarFocusDate.setHours(12, 0, 0, 0);
      calendarViewDate = new Date(calendarFocusDate); calendarViewDate.setDate(1);
      journalCalendar.classList.toggle('inline', Boolean(anchor));
      journalCalendar.style.left = anchor ? `${Math.min(innerWidth - 250, Math.max(8, anchor.left))}px` : '';
      journalCalendar.style.top = anchor ? `${Math.min(innerHeight - 280, anchor.bottom + 4)}px` : '';
      renderJournalCalendar();
      requestAnimationFrame(() => $('#calendarDays [tabindex="0"]')?.focus());
    }
  }

  function closeJournalCalendar() {
    journalCalendar.hidden = true; journalCalendar.classList.remove('inline'); journalCalendar.style.left = ''; journalCalendar.style.top = '';
    calendarSelectAction = null; $('#journalCalendarButton').setAttribute('aria-expanded', 'false');
  }

  async function openToday(reset = false, options = {}) {
    return openJournalDate(new Date(), { reset, ...options });
  }

  async function closeGraph() {
    if (state.dirty && !(await flushGraphSave(true))) return;
    closeRemoteEvents?.(); closeRemoteEvents = null; graphStore?.disposeAssets();
    state.graphMode = false; state.graphPage = null; state.graphDocument = null; state.graphZoomId = null; state.journalMode = false; journalDocuments.clear(); graphHistory = []; graphHistoryIndex = -1;
    outliner.hidden = true; app.classList.remove('graph-mode', 'journal-mode');
    const docs = getStoredDocs();
    if (docs.length) loadMarkdown(docs[0].markdown, docs[0].name, { id: docs[0].id });
    else loadMarkdown('', 'Untitled');
  }

  function namespacePageTitle(page = state.graphPage) {
    if (!page) return '';
    if (String(page.title).includes('/')) return page.title;
    const filename = page.name || page.path?.split('/').at(-1) || '';
    const inferred = MarkdGraph.pageTitle('', filename);
    return inferred.includes('/') ? inferred : page.title;
  }

  function hierarchyBreadcrumb(title, current = false) {
    const segments = title.split('/').map(segment => segment.trim()).filter(Boolean);
    return segments.map((segment, index) => {
      const target = segments.slice(0, index + 1).join('/');
      if (current && index === segments.length - 1) return `<span>${escapeHtml(segment)}</span>`;
      return `<button type="button" class="graph-page-ref" data-page="${escapeHtml(target)}">${escapeHtml(segment)}</button>`;
    }).join('<i aria-hidden="true">/</i>');
  }

  function renderPageHierarchy() {
    if (!state.graphMode || !graphIndex || !state.graphPage || state.journalMode) { pageHierarchy.hidden = true; pageHierarchy.innerHTML = ''; return; }
    const currentTitle = namespacePageTitle(); const currentParts = currentTitle.split('/');
    const children = graphIndex.allPages().map(page => ({ page, title: namespacePageTitle(page) }))
      .filter(item => {
        const parts = item.title.split('/');
        return parts.length === currentParts.length + 1 && MarkdGraph.normalizePage(parts.slice(0, -1).join('/')) === MarkdGraph.normalizePage(currentTitle);
      }).sort((a, b) => a.title.localeCompare(b.title));
    const rows = [];
    if (currentParts.length > 1) rows.push(`<div class="hierarchy-path current">${hierarchyBreadcrumb(currentTitle, true)}</div>`);
    children.forEach(child => rows.push(`<div class="hierarchy-path">${hierarchyBreadcrumb(child.title)}</div>`));
    pageHierarchy.hidden = !rows.length;
    pageHierarchy.innerHTML = rows.length ? `<h3>Hierarchy</h3>${rows.join('')}` : '';
  }

  function renderReferences(includeUnlinked = false) {
    if (!state.graphMode || !graphIndex || !state.graphPage || (state.journalMode && !state.graphZoomId)) { references.innerHTML = ''; return; }
    const renderGroups = items => {
      const groups = new Map();
      items.forEach(item => { if (!groups.has(item.page.title)) groups.set(item.page.title, []); groups.get(item.page.title).push(item); });
      return [...groups].map(([title, group]) => `<div class="reference-group"><button class="reference-page graph-page-ref" data-page="${escapeHtml(title)}">${escapeHtml(title)}</button>${group.map(item => `<button class="reference-result" data-reference-page="${escapeHtml(title)}" data-reference-block="${escapeHtml(item.block.id)}">${escapeHtml(item.content.replace(/^\s*[\w-]+::.*$/gm, '').trim().slice(0, 220))}</button>`).join('')}</div>`).join('');
    };
    const aggregatePages = new Set(['home', 'journals', "today's journal", "today's journals", 'todays journal', 'todays journals', 'today journal']);
    const pageTitle = namespacePageTitle();
    const linked = graphIndex.referencesToPage(pageTitle)
      .filter(item => !aggregatePages.has(MarkdGraph.normalizePage(item.page.title)));
    const zoomedBlock = state.graphZoomId ? graphBlockLocation(state.graphZoomId)?.block : null;
    const blockUuid = zoomedBlock && MarkdGraph.propertiesFrom(zoomedBlock.content).id;
    const blockLinked = blockUuid ? graphIndex.referencesToBlock(blockUuid) : [];
    const unlinked = includeUnlinked ? graphIndex.unlinkedReferences(pageTitle) : [];
    references.innerHTML = `<details${linked.length ? ' open' : ''}><summary>Linked references · ${linked.length}</summary>${renderGroups(linked)}</details>${blockUuid ? `<details${blockLinked.length ? ' open' : ''}><summary>Block references · ${blockLinked.length}</summary>${renderGroups(blockLinked)}</details>` : ''}${includeUnlinked ? `<details${unlinked.length ? ' open' : ''}><summary>Unlinked references · ${unlinked.length}</summary>${renderGroups(unlinked)}</details>` : '<button class="unlinked-button" data-show-unlinked>Find unlinked references</button>'}`;
  }

  function graphMutationFocus(block, position = null) { graphChanged(); focusGraphBlock(block.id, position); }

  function handleGraphBlockInput(event) {
    const field = event.currentTarget; const location = graphBlockLocation(field.dataset.blockId); if (!location) return;
    const code = field.value.split('\n').some(line => fenceOpening(line));
    const quote = !code && field.value && (field.value.split('\n').every(line => /^\s*>/.test(line)) || field.value.split('\n').some(orgQuoteOpening));
    field.classList.toggle('graph-code-editor', code);
    field.classList.toggle('graph-quote-editor', Boolean(quote));
    location.block.content = field.value; activeGraphBlock.block = location.block; resizeGraphEditor(field); graphChanged(); showGraphAutocomplete(field);
  }

  let pendingSelectionDelimiter = null;

  function flushSelectionDelimiter() {
    const pending = pendingSelectionDelimiter;
    pendingSelectionDelimiter = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    const { field, key, start, end, value } = pending;
    if (!field.isConnected || field.value !== value) return;
    field.setRangeText(key, start, end, 'end');
    notifyMarkdownField(field);
  }

  function handleSelectionDelimiter(event) {
    const pairs = { '~': ['~~', '~~'], '[': ['[[', ']]'], '(': ['((', '))'], '*': ['**', '**'], '_': ['__', '__'] };
    const field = event.currentTarget;
    if (!pairs[event.key] || event.metaKey || (event.ctrlKey && !event.altKey) || event.isComposing) {
      if (pendingSelectionDelimiter) flushSelectionDelimiter();
      return false;
    }
    const start = field.selectionStart; const end = field.selectionEnd;
    if (start === end) {
      if (pendingSelectionDelimiter) flushSelectionDelimiter();
      return false;
    }
    const pending = pendingSelectionDelimiter;
    if (pending && pending.field === field && pending.key === event.key && pending.start === start && pending.end === end && pending.value === field.value) {
      event.preventDefault(); clearTimeout(pending.timer); pendingSelectionDelimiter = null;
      const selected = field.value.slice(start, end); const [before, after] = pairs[event.key];
      field.setRangeText(`${before}${selected}${after}`, start, end, 'end');
      field.setSelectionRange(start + before.length, start + before.length + selected.length);
      notifyMarkdownField(field);
      return true;
    }
    if (pending) flushSelectionDelimiter();
    event.preventDefault();
    pendingSelectionDelimiter = { field, key: event.key, start, end, value: field.value };
    pendingSelectionDelimiter.timer = setTimeout(flushSelectionDelimiter, 600);
    return true;
  }

  function handleWikiPair(event) {
    const field = event.currentTarget;
    if (!state.graphMode || field.selectionStart !== field.selectionEnd) return false;
    const position = field.selectionStart;
    if (event.key === '[' && field.value[position - 1] === '[') {
      event.preventDefault();
      field.setRangeText('[]]', position, position, 'end');
      field.setSelectionRange(position + 1, position + 1);
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '[' }));
      return true;
    }
    if (event.key === ']' && field.value[position] === ']') {
      event.preventDefault(); field.setSelectionRange(position + 1, position + 1); hideGraphAutocomplete(); return true;
    }
    return false;
  }

  function moveGraphBlock(block, direction) {
    const location = graphBlockLocation(block.id); if (!location) return false;
    const target = location.index + direction; if (target < 0 || target >= location.blocks.length) return false;
    location.blocks.splice(location.index, 1); location.blocks.splice(target, 0, block); graphMutationFocus(block); return true;
  }

  function indentGraphBlock(block, outdent = false) {
    const location = graphBlockLocation(block.id); if (!location) return false;
    if (!outdent) {
      const previous = location.blocks[location.index - 1]; if (!previous) return false;
      location.blocks.splice(location.index, 1); previous.children.push(block); previous.collapsed = false;
    } else {
      if (!location.parent) return false;
      const parentLocation = graphBlockLocation(location.parent.id); if (!parentLocation) return false;
      location.blocks.splice(location.index, 1); parentLocation.blocks.splice(parentLocation.index + 1, 0, block);
    }
    graphMutationFocus(block); return true;
  }

  function toggleGraphTask(block, focus = true) {
    const match = block.content.match(/^(TODO|DOING|DONE)(?:\s+|$)/);
    const next = !match ? `TODO ${block.content}` : match[1] === 'TODO' ? block.content.replace(/^TODO/, 'DOING') : match[1] === 'DOING' ? block.content.replace(/^DOING/, 'DONE') : block.content.replace(/^DONE(?:\s+|$)/, '');
    block.content = next;
    if (focus) graphMutationFocus(block, 0); else { graphChanged(); renderGraphPage(); }
  }

  function createNextGraphBlock(block, content = '') {
    const location = graphBlockLocation(block.id); if (!location) return null;
    const next = { id: MarkdGraph.newId(), uuid: null, content, marker: block.marker || '-', children: [], collapsed: false };
    if (state.graphZoomId === block.id) { block.collapsed = false; block.children.unshift(next); saveGraphCollapse(); }
    else location.blocks.splice(location.index + 1, 0, next);
    graphMutationFocus(next, 0); return next;
  }

  function handleGraphBlockKeydown(event) {
    const field = event.currentTarget; const location = graphBlockLocation(field.dataset.blockId); if (!location) return;
    const block = location.block;
    if (handleSelectionDelimiter(event) || handleWikiPair(event)) return;
    if (!graphAutocomplete.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      event.preventDefault(); handleGraphAutocompleteKey(event.key); return;
    }
    if (event.key === 'Tab') { event.preventDefault(); indentGraphBlock(block, event.shiftKey); return; }
    if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); moveGraphBlock(block, event.key === 'ArrowUp' ? -1 : 1); return; }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); toggleGraphTask(block); return; }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const start = field.selectionStart, end = field.selectionEnd;
      block.content = field.value.slice(0, start);
      createNextGraphBlock(block, field.value.slice(end)); return;
    }
    if (event.key === 'Backspace' && !field.value && visibleGraphBlocks().length > 1) {
      event.preventDefault(); const visible = visibleGraphBlocks(); const position = visible.indexOf(block); const previous = visible[position - 1] || visible[position + 1];
      location.blocks.splice(location.index, 1, ...(block.children || [])); graphChanged(); if (previous) focusGraphBlock(previous.id); else renderGraphPage(); return;
    }
    if ((event.key === 'ArrowUp' && field.selectionStart === 0) || (event.key === 'ArrowDown' && field.selectionStart === field.value.length)) {
      const visible = visibleGraphBlocks(); const index = visible.indexOf(block); const target = visible[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) { event.preventDefault(); focusGraphBlock(target.id, event.key === 'ArrowUp' ? target.content.length : 0); }
    }
    if (event.key === 'Escape') { event.preventDefault(); commitGraphBlock(); }
  }

  let autocompleteItems = []; let autocompleteIndex = 0;
  const slashCommands = [
    { title: '/today', keywords: 'journal current date', days: 0 },
    { title: '/yesterday', keywords: 'journal previous date', days: -1 },
    { title: '/tomorrow', keywords: 'journal next date', days: 1 },
    { title: '/date picker', keywords: 'journal calendar choose date', datePicker: true }
  ];
  function blockAutocompleteResults(query) {
    if (!graphIndex) return [];
    const needle = MarkdGraph.normalizePage(query); const results = [];
    for (const page of graphIndex.allPages()) {
      const current = page.path === state.graphPage?.path;
      const document = current ? state.graphDocument : graphIndex.documents.get(MarkdGraph.normalizePage(page.title));
      for (const { block } of MarkdGraph.flattenBlocks(document?.blocks)) {
        if (current && block === activeGraphBlock?.block) continue;
        const content = block.content.replace(/^\s*[\w-]+::.*$/gm, '').replace(/\[\[|\]\]|\(\(|\)\)/g, '').trim();
        if (!content || (needle && !MarkdGraph.normalizePage(content).includes(needle))) continue;
        results.push({ title: content.slice(0, 80), blockAutocomplete: true, block, page, document });
        if (results.length >= 12) return results;
      }
    }
    return results;
  }
  function showGraphAutocomplete(field) {
    const before = field.value.slice(0, field.selectionStart); const wikiMatch = before.match(/\[\[([^\]]*)$/);
    const blockMatch = before.match(/\(\(([^)]*)$/); const slashMatch = before.match(/\/([^/\n]*)$/);
    if (slashMatch) {
      const query = slashMatch[1].trim().toLowerCase(); const typedCommand = `/${query}`;
      autocompleteItems = slashCommands.filter(command => command.title.startsWith(typedCommand)).map(command => ({ ...command, slash: true }));
    } else if (wikiMatch && graphIndex) {
      const title = wikiMatch[1].trim(); const query = MarkdGraph.normalizePage(title);
      const pages = graphIndex.allPages();
      const matches = pages.filter(page => !query || MarkdGraph.normalizePage(page.title).includes(query)).slice(0, 12);
      const exactMatch = query && pages.some(page => MarkdGraph.normalizePage(page.title) === query);
      autocompleteItems = title && !exactMatch ? [{ title, create: true }, ...matches].slice(0, 12) : matches;
    } else if (blockMatch) autocompleteItems = blockAutocompleteResults(blockMatch[1].trim());
    else return hideGraphAutocomplete();
    if (!autocompleteItems.length) return hideGraphAutocomplete();
    autocompleteIndex = 0;
    graphAutocomplete.innerHTML = autocompleteItems.map((item, index) => `<button type="button" data-autocomplete-index="${index}" class="${index === 0 ? 'selected' : ''}">${item.create ? `<span class="autocomplete-create">Create page</span>` : item.slash ? `<span class="autocomplete-create">Command</span>` : item.blockAutocomplete ? `<span class="autocomplete-create">Block · ${escapeHtml(item.page.title)}</span>` : ''}${escapeHtml(item.title)}</button>`).join('');
    graphAutocomplete.hidden = false;
    const rect = field.getBoundingClientRect(); const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0; const viewportLeft = viewport?.offsetLeft || 0;
    const viewportRight = viewportLeft + (viewport?.width || innerWidth); const viewportBottom = viewportTop + (viewport?.height || innerHeight);
    const toolbarTop = !mobileBlockToolbar.hidden ? mobileBlockToolbar.getBoundingClientRect().top - 6 : viewportBottom - 8;
    const availableBottom = Math.min(viewportBottom - 8, toolbarTop); const below = rect.bottom + 4;
    graphAutocomplete.style.maxHeight = '220px';
    const popupHeight = graphAutocomplete.offsetHeight; const belowSpace = Math.max(0, availableBottom - below); const aboveSpace = Math.max(0, rect.top - viewportTop - 12);
    let top;
    if (popupHeight <= belowSpace) top = below;
    else if (popupHeight <= aboveSpace) top = rect.top - popupHeight - 4;
    else if (belowSpace >= aboveSpace) { graphAutocomplete.style.maxHeight = `${belowSpace}px`; top = below; }
    else { graphAutocomplete.style.maxHeight = `${aboveSpace}px`; top = rect.top - graphAutocomplete.offsetHeight - 4; }
    graphAutocomplete.style.left = `${Math.min(viewportRight - graphAutocomplete.offsetWidth - 12, Math.max(viewportLeft + 12, rect.left + 20))}px`;
    graphAutocomplete.style.top = `${top}px`;
  }
  function hideGraphAutocomplete() { graphAutocomplete.hidden = true; autocompleteItems = []; }
  function renderAutocompleteSelection() { $$('[data-autocomplete-index]', graphAutocomplete).forEach((item, index) => item.classList.toggle('selected', index === autocompleteIndex)); }
  function chooseGraphAutocomplete(index = autocompleteIndex, advance = false) {
    const item = autocompleteItems[index]; const field = activeGraphBlock?.field; const block = activeGraphBlock?.block;
    if (!item || !field || !block) return;
    const before = field.value.slice(0, field.selectionStart);
    if (item.blockAutocomplete) {
      const start = before.lastIndexOf('(('); const end = field.selectionStart;
      let uuid = MarkdGraph.propertiesFrom(item.block.content).id;
      if (!uuid) {
        uuid = MarkdGraph.newId(); item.block.uuid = uuid;
        item.block.content = `${item.block.content.replace(/\s+$/, '')}${item.block.content.trim() ? '\n' : ''}id:: ${uuid}`;
        if (item.page.path === state.graphPage?.path) graphChanged();
        else {
          const content = MarkdGraph.serializeDocument(item.document);
          graphStore.writePage(item.page, content).then(() => graphIndex.updatePage(item.page, content)).catch(error => toast(error.message || 'Could not create the block reference'));
        }
      }
      const closingLength = field.value.slice(end).startsWith('))') ? 2 : 0;
      field.setRangeText(`((${uuid}))`, start, end + closingLength, 'end');
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); hideGraphAutocomplete(); field.focus();
      return;
    }
    if (item.slash) {
      const start = before.lastIndexOf('/'); const end = field.selectionStart;
      if (item.datePicker) {
        const anchor = graphAutocomplete.getBoundingClientRect(); hideGraphAutocomplete();
        toggleJournalCalendar(date => {
          const title = MarkdGraph.journalInfo(date, graphStore?.config).title; const reference = `[[${title}]]`;
          if (field.isConnected) {
            field.setRangeText(reference, start, end, 'end'); field.dispatchEvent(new InputEvent('input', { bubbles: true })); field.focus();
          } else {
            block.content = `${block.content.slice(0, start)}${reference}${block.content.slice(end)}`; graphChanged(); focusGraphBlock(block.id, start + reference.length);
          }
        }, anchor);
      } else {
        const date = relativeJournalDate(item.days); const title = MarkdGraph.journalInfo(date, graphStore?.config).title;
        field.setRangeText(`[[${title}]]`, start, end, 'end'); field.dispatchEvent(new InputEvent('input', { bubbles: true })); hideGraphAutocomplete(); field.focus();
      }
      return;
    }
    const start = before.lastIndexOf('[['); const closingLength = field.value.slice(field.selectionStart).startsWith(']]') ? 2 : 0;
    field.setRangeText(`[[${item.title}]]`, start, field.selectionStart + closingLength, 'end'); field.dispatchEvent(new InputEvent('input', { bubbles: true })); hideGraphAutocomplete(); field.focus();
    if (item.create) graphStore.createPage(item.title).then(() => {
      graphIndex.rebuild(graphStore.pages); toast(`Page “${item.title}” created`);
    }).catch(error => toast(error.message || 'Could not create the page'));
    if (advance) createNextGraphBlock(block);
  }
  function handleGraphAutocompleteKey(key) {
    if (key === 'Escape') return hideGraphAutocomplete();
    if (key === 'Enter' || key === 'Tab') return chooseGraphAutocomplete(autocompleteIndex, key === 'Enter');
    autocompleteIndex = (autocompleteIndex + (key === 'ArrowDown' ? 1 : -1) + autocompleteItems.length) % autocompleteItems.length; renderAutocompleteSelection();
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
    if (activeGraphBlock?.field?.isConnected) return activeGraphBlock.field;
    if (activeSourceBlock?.isConnected) return activeSourceBlock;
    return state.sourceMode ? sourceEditor : null;
  }

  function captureVimSnapshot(field = vimField()) {
    return {
      markdown: currentMarkdown(),
      blockIndex: field === activeSourceBlock ? [...editor.children].indexOf(field) : 0,
      blockId: field === activeGraphBlock?.field ? activeGraphBlock.block.id : null,
      graphBlockIndex: field === activeGraphBlock?.field ? MarkdGraph.flattenBlocks(state.graphDocument?.blocks).findIndex(({ block }) => block === activeGraphBlock.block) : 0,
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
    } else if (state.graphMode) {
      activeGraphBlock = null; state.graphDocument = MarkdGraph.parseDocument(snapshot.markdown); restoreGraphCollapse();
      renderGraphPage(); graphChanged();
      const block = graphBlockLocation(snapshot.blockId)?.block || MarkdGraph.flattenBlocks(state.graphDocument.blocks)[snapshot.graphBlockIndex]?.block || state.graphDocument.blocks[0];
      if (block) focusGraphBlock(block.id, snapshot.cursor);
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
    field.classList.toggle('vim-empty', field.value.length === 0);
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
    $$('.md-source-block, .graph-block-editor, #sourceEditor').forEach(item => item.classList.remove('vim-normal', 'vim-insert', 'vim-empty'));
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
    if (state.graphMode) {
      if (activeGraphBlock?.field) { setVimMode(state.vimMode, activeGraphBlock.field); return; }
      const block = (state.graphZoomId && graphBlockLocation(state.graphZoomId)?.block) || state.graphDocument?.blocks?.[0];
      if (block) activateGraphBlock(block, 0, state.graphPage);
      return;
    }
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
    $$('.md-source-block, .graph-block-editor, #sourceEditor').forEach(item => item.classList.remove('vim-normal', 'vim-insert', 'vim-empty'));
    updateVimUi();
    saveSettings({ vimEnabled: enabled });
    if (enabled && refocus) requestAnimationFrame(focusVimEditor);
    if (!enabled) {
      const field = vimField();
      if (field) {
        field.setSelectionRange(field.selectionStart, field.selectionStart);
        if (refocus) field.focus();
      } else if (refocus) (state.graphMode ? outliner : editor).focus();
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

  function vimGraphEntries() {
    if (state.journalMode && !state.graphZoomId) {
      return orderedJournalPages().slice(0, state.journalLimit).flatMap(page =>
        visibleGraphBlocks(cachedJournalDocument(page).blocks, []).map(block => ({ block, page }))
      );
    }
    const roots = state.graphZoomId ? [graphBlockLocation(state.graphZoomId)?.block].filter(Boolean) : state.graphDocument?.blocks || [];
    return visibleGraphBlocks(roots, []).map(block => ({ block, page: state.graphPage }));
  }

  function moveVimToGraphBlock(direction, distance = 1, preferredColumn = 0) {
    let entries = vimGraphEntries(); const current = activeGraphBlock?.block; const currentPage = activeGraphBlock?.page;
    let index = entries.findIndex(entry => entry.block === current && entry.page.path === currentPage?.path);
    if (index < 0) return;
    if (state.journalMode && direction > 0 && index + distance >= entries.length && state.journalLimit < orderedJournalPages().length) {
      state.journalLimit += 8; entries = vimGraphEntries();
      index = entries.findIndex(entry => entry.block === current && entry.page.path === currentPage?.path);
    }
    const target = entries[Math.max(0, Math.min(entries.length - 1, index + direction * distance))];
    if (!target || (target.block === current && target.page.path === currentPage?.path)) return;
    const lines = target.block.content.split('\n'); const lineIndex = direction < 0 ? lines.length - 1 : 0;
    const start = lines.slice(0, lineIndex).reduce((total, line) => total + line.length + 1, 0);
    const position = start + Math.min(preferredColumn, Math.max(0, lines[lineIndex].length - 1));
    if (target.page.path === state.graphPage?.path) focusGraphBlock(target.block.id, position);
    else activateJournalBlock(target.page.path, target.block.id, 'edit', position);
  }

  function moveVimVertically(field, direction, firstNonBlank = false) {
    const bounds = vimLineBounds(field);
    const column = vimDesiredColumn ?? field.selectionStart - bounds.start;
    vimDesiredColumn = column;
    let targetStart;
    if (direction < 0) {
      if (bounds.start === 0) {
        if (field === activeGraphBlock?.field) moveVimToGraphBlock(-1, 1, column);
        else if (field === activeSourceBlock) moveToAdjacentBlock(-1, false, column);
        return;
      }
      const previousEnd = bounds.start - 1;
      targetStart = field.value.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1;
    } else {
      if (bounds.end === field.value.length) {
        if (field === activeGraphBlock?.field) moveVimToGraphBlock(1, 1, column);
        else if (field === activeSourceBlock) moveToAdjacentBlock(1, false, column);
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
    if (field === activeGraphBlock?.field) { moveVimToGraphBlock(direction, 5, column); return; }
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
    if (field === activeGraphBlock?.field) {
      const entries = vimGraphEntries(); const target = end ? entries.at(-1) : entries[0]; if (!target) return;
      const position = end ? Math.max(0, target.block.content.lastIndexOf('\n') + 1) : 0;
      if (target.page.path === state.graphPage?.path) focusGraphBlock(target.block.id, position);
      else activateJournalBlock(target.page.path, target.block.id, 'edit', position);
      return;
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

  function createVimGraphBlock(before = false) {
    const block = activeGraphBlock?.block; const location = block && graphBlockLocation(block.id); if (!location) return;
    vimInsertSnapshot = captureVimSnapshot(activeGraphBlock.field);
    let next;
    if (!before) next = createNextGraphBlock(block);
    else {
      next = { id: MarkdGraph.newId(), uuid: null, content: '', marker: block.marker || '-', children: [], collapsed: false };
      if (state.graphZoomId === block.id) { block.collapsed = false; block.children.unshift(next); }
      else location.blocks.splice(location.index, 0, next);
      graphMutationFocus(next, 0);
    }
    if (next && activeGraphBlock?.field) setVimMode('insert', activeGraphBlock.field, 0);
  }

  function deleteVimGraphBlock(field) {
    const block = activeGraphBlock?.block; const location = block && graphBlockLocation(block.id); if (!location) return;
    const pageBlocks = MarkdGraph.flattenBlocks(state.graphDocument.blocks).map(entry => entry.block);
    if (pageBlocks.length <= 1) { replaceVimRange(field, 0, field.value.length); return; }
    const index = pageBlocks.indexOf(block); recordVimChange(field);
    const target = pageBlocks[index + 1] || pageBlocks[index - 1]; location.blocks.splice(location.index, 1);
    graphChanged(); if (target) focusGraphBlock(target.id, 0); else renderGraphPage();
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
      if (key === 'd') field === activeGraphBlock?.field ? deleteVimGraphBlock(field) : deleteVimLine(field);
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
      if (field === activeGraphBlock?.field) createVimGraphBlock(key === 'O');
      else {
        const insertion = key === 'o' ? bounds.end : bounds.start;
        vimInsertSnapshot = captureVimSnapshot(field);
        replaceVimRange(field, insertion, insertion, '\n', false);
        setVimMode('insert', field, key === 'o' ? insertion + 1 : insertion);
      }
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
    else if (key === ':') showCommandPalette();
    else if (key === '?') showDocumentation();
  }

  function handleVimKeydown(event) {
    if (!state.vimEnabled || !$('#commandPalette').hidden || !$('#confirmDialog').hidden) return;
    const field = event.target === sourceEditor ? sourceEditor : (event.target === activeGraphBlock?.field ? activeGraphBlock.field : (event.target === activeSourceBlock ? activeSourceBlock : null));
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
    if (!field && (event.target === editor || editor.contains(event.target) || (state.graphMode && (event.target === outliner || outliner.contains(event.target))))) {
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
    if (handleSelectionDelimiter(event) || handleWikiPair(event)) return;
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
    if (state.graphMode && graphStore?.isRemote) { closeRemoteEvents?.(); closeRemoteEvents = null; }
    if (graphRoute() && !options.preserveGraphRoute) history.pushState({}, '', `/${location.search}`);
    state.graphMode = false; state.graphPage = null; state.graphDocument = null; state.graphZoomId = null; state.graphConflict = false; state.sourceMode = false; state.journalMode = false;
    outliner.hidden = true; editor.hidden = false; sourceEditor.hidden = true;
    app.classList.remove('graph-mode', 'journal-mode', 'source-mode'); updateVimUi();
    state.markdown = markdown;
    activeSourceBlock = null; activeGraphBlock = null; mobileBlockToolbar.hidden = true;
    vimUndoStack.length = 0; vimRedoStack.length = 0; vimInsertSnapshot = null;
    state.fileHandle = options.handle || null;
    state.currentId = options.id || crypto.randomUUID?.() || String(Date.now());
    state.dirty = false;
    editor.innerHTML = markdownToHtml(markdown);
    sourceEditor.value = markdown;
    fileName.value = name.replace(/\.(md|markdown|txt)$/i, ''); fileName.readOnly = false;
    document.title = `${fileName.value} — markd`;
    app.classList.remove('dirty');
    updateStats(); updateOutline(); persistLocal(false);
    saveState.textContent = 'Ready';
    requestAnimationFrame(() => state.vimEnabled ? focusVimEditor() : editor.focus());
  }

  function changed() {
    if (state.graphMode) { graphChanged(); return; }
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
    if (state.graphMode) return flushGraphSave(true);
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
    if (state.graphMode) return flushGraphSave(true).then(saved => saved && action());
    if (!state.dirty) return action();
    state.pendingAction = action; $('#confirmDialog').hidden = false;
  }

  function newDocument() { loadMarkdown('', 'Untitled'); }

  function toggleSource(force) {
    const shouldEnable = typeof force === 'boolean' ? force : !state.sourceMode;
    if (shouldEnable === state.sourceMode) return;
    if (state.graphMode) {
      if (shouldEnable) {
        commitGraphBlock(); sourceEditor.value = MarkdGraph.serializeDocument(state.graphDocument);
        outliner.hidden = true; sourceEditor.hidden = false;
      } else {
        state.graphDocument = MarkdGraph.parseDocument(sourceEditor.value); restoreGraphCollapse();
        sourceEditor.hidden = true; outliner.hidden = false; renderGraphPage(); graphChanged();
      }
      state.sourceMode = shouldEnable; app.classList.toggle('source-mode', shouldEnable);
      updateStats();
      if (state.vimEnabled) requestAnimationFrame(focusVimEditor); else (shouldEnable ? sourceEditor : outliner).focus?.();
      return;
    }
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

  let documentationLoaded = false;
  let documentationReturnFocus = null;
  async function showDocumentation() {
    documentationReturnFocus = activeMarkdownField() || document.activeElement;
    documentationView.hidden = false; app.classList.add('documentation-open');
    if (!documentationLoaded) {
      documentationContent.innerHTML = '<p>Loading documentation…</p>';
      try {
        const response = await fetch('./DOCUMENTATION.md');
        if (!response.ok) throw new Error('Documentation is unavailable');
        documentationContent.innerHTML = markdownToHtml(await response.text());
        const used = new Set();
        $$('h1,h2,h3,h4,h5,h6', documentationContent).forEach((heading, index) => {
          let id = heading.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `section-${index}`;
          while (used.has(id)) id = `${id}-${index}`; used.add(id); heading.id = id;
        });
        documentationLoaded = true;
      } catch (error) {
        documentationContent.innerHTML = `<p>${escapeHtml(error.message || 'Could not load the documentation.')}</p>`;
      }
    }
    if (!documentationView.hidden) requestAnimationFrame(() => $('#documentationClose').focus());
  }

  function closeDocumentation() {
    if (documentationView.hidden) return;
    documentationView.hidden = true; app.classList.remove('documentation-open');
    if (documentationReturnFocus?.isConnected) documentationReturnFocus.focus();
    else $('#commandButton').focus();
  }

  function exportHtml() {
    const body = markdownToHtml(currentMarkdown());
    const title = escapeHtml(fileName.value || 'Document');
    const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;color:#333;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}h1{border-bottom:1px solid #ddd}a{color:#4183c4}blockquote{border-left:3px solid #ddd;padding-left:18px;color:#777}code,pre{font-family:monospace;background:#f5f5f5;border-radius:4px}code{padding:2px 4px}pre{padding:16px;overflow:auto}pre code{padding:0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:7px}img{max-width:100%}</style><body>${body}</body></html>`;
    downloadBlob(page, `${fileName.value || 'document'}.html`, 'text/html'); toast('HTML exported');
  }

  function activeMarkdownField() {
    if (paletteContext?.field?.isConnected) return paletteContext.field;
    if (state.graphMode) return activeGraphBlock?.field?.isConnected ? activeGraphBlock.field : (state.sourceMode ? sourceEditor : null);
    if (activeSourceBlock?.isConnected) return activeSourceBlock;
    return state.sourceMode ? sourceEditor : null;
  }

  function notifyMarkdownField(field) {
    if (field === activeSourceBlock) resizeSourceBlock(field);
    if (field === activeGraphBlock?.field) resizeGraphEditor(field);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    field.focus();
  }

  function withMarkdownField(callback) {
    const existing = activeMarkdownField();
    if (existing) { callback(existing); return; }
    if (state.graphMode) {
      const block = state.graphDocument?.blocks?.[0];
      if (!block) return;
      activateGraphBlock(block); requestAnimationFrame(() => activeGraphBlock && callback(activeGraphBlock.field)); return;
    }
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

  function selectedGraphBlock() {
    const id = activeGraphBlock?.block?.id || paletteContext?.field?.dataset?.blockId;
    return id ? graphBlockLocation(id)?.block : null;
  }

  async function copyGraphBlockReference() {
    const block = selectedGraphBlock(); if (!state.graphMode || !block) return toast('Select a block first');
    const properties = MarkdGraph.propertiesFrom(block.content);
    const uuid = properties.id || MarkdGraph.newId();
    if (!properties.id) { block.content = `${block.content.replace(/\s+$/, '')}\n${block.content ? '' : ''}id:: ${uuid}`; block.uuid = uuid; graphChanged(); renderGraphPage(); }
    await navigator.clipboard.writeText(`((${uuid}))`); toast('Block reference copied');
  }

  function zoomGraphBlock() {
    const block = selectedGraphBlock(); if (!state.graphMode || !block) return toast('Select a block first');
    commitGraphBlock(); state.graphZoomId = block.id; renderGraphPage();
  }

  async function createGraphPage() {
    if (!graphStore) return openGraph();
    const title = prompt('Page name:'); if (title?.trim()) loadGraphPage(title.trim(), { create: true });
  }

  const commands = [
    { label: 'Documentation', shortcut: '?', keywords: 'help guide manual shortcuts', run: showDocumentation },
    { label: 'Open local graph', keywords: 'folder logseq graph local', run: () => requestAction(openGraph) },
    { label: 'New graph page', keywords: 'page create graph', run: () => requestAction(createGraphPage) },
    { label: 'Today journal', shortcut: '⇧⌘ J', keywords: 'daily notes journal today', aliases: '/today', run: () => requestAction(openToday) },
    { label: 'Previous page', shortcut: 'Alt ←', keywords: 'history back navigate', run: () => navigateGraphHistory(-1) },
    { label: 'Next page', shortcut: 'Alt →', keywords: 'history forward navigate', run: () => navigateGraphHistory(1) },
    { label: 'Copy block reference', keywords: 'uuid block reference link', run: copyGraphBlockReference },
    { label: 'Zoom into block', keywords: 'focus block outliner', run: zoomGraphBlock },
    { label: 'Close graph', keywords: 'close folder graph', run: closeGraph },
    { label: 'Rename document', shortcut: 'F2', keywords: 'title name file page', run: () => { commitActiveBlock(); commitGraphBlock(); fileName.focus(); fileName.select(); } },
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
    { label: 'Page reference', keywords: 'page wiki brackets reference', run: () => wrapMarkdownSelection('[[', ']]', 'page') },
    { label: 'Block reference', keywords: 'block parentheses reference', run: () => wrapMarkdownSelection('((', '))', 'block id') },
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

  function contextualCommands() {
    const markdown = currentMarkdown();
    return [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match, index) => ({
      label: `Outline: ${match[2].replace(/[*_`]/g, '')}`,
      shortcut: `H${match[1].length}`,
      keywords: 'outline title heading section',
      run: () => goToHeading(index, markdown.slice(0, match.index).split('\n').length)
    }));
  }

  function blockResultCommands(query) {
    if (!graphIndex || query.length < 2) return [];
    return graphIndex.search(query, 24).map(result => ({
      label: result.content.replace(/^\s*[\w-]+::.*$/gm, '').replace(/\[\[|\]\]/g, '').trim().slice(0, 80),
      shortcut: result.page.title,
      run: () => loadGraphPage(result.page, { blockId: result.block.id })
    }));
  }

  function recentPageCommands(query) {
    const searchQuery = query.toLowerCase();
    const normalizedQuery = query && MarkdGraph.normalizePage(query);
    const seen = new Set();
    let settings = {}; try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
    const storedPages = (settings.recentGraphPages || []).filter(item => item.graph === graphStore?.name)
      .map(item => graphStore?.pages.find(page => page.path === item.path)).filter(Boolean);
    let graphPages = [...graphHistory].reverse().map(entry => graphStore?.pages.find(page => page.path === entry.path)).filter(Boolean);
    graphPages.push(...storedPages);
    if (query && graphIndex) graphPages.push(...graphIndex.allPages());
    graphPages = graphPages.filter(page => {
      if (seen.has(page.path)) return false;
      seen.add(page.path);
      return !normalizedQuery || MarkdGraph.normalizePage(page.title).includes(normalizedQuery);
    }).slice(0, 80);
    const pages = graphPages.map(page => ({
      label: page.title, shortcut: page.journal ? 'Journal' : '', keywords: `graph page ${page.title}`,
      run: () => loadGraphPage(page)
    }));
    const documents = getStoredDocs().filter(doc => !query || doc.name.toLowerCase().includes(searchQuery)).map(doc => ({
      label: doc.name, shortcut: relativeDate(doc.updated), keywords: 'recent files documents open',
      run: () => requestAction(() => loadMarkdown(doc.markdown, doc.name, { id: doc.id }))
    }));
    const exactPage = graphIndex?.allPages().some(page => MarkdGraph.normalizePage(page.title) === normalizedQuery);
    const createPage = query && graphStore && !exactPage ? [{
      label: `Create page “${query}”`, shortcut: 'Enter', createPage: true,
      run: () => requestAction(() => loadGraphPage(query, { create: true }))
    }] : [];
    return [...createPage, ...pages, ...documents];
  }

  function commandMarkup(command, index) {
    return `<button class="command-item${index === selectedCommand ? ' selected' : ''}" data-command-index="${index}" role="option" aria-selected="${index === selectedCommand}"><span>${escapeHtml(command.label)}</span>${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ''}</button>`;
  }

  function formatGraphSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  }

  function renderPaletteGraphStats() {
    const footer = $('#commandPaletteStats'); const store = graphStore;
    footer.hidden = !store;
    if (!store) return;
    const applyStats = stats => {
      if (graphStore !== store || !stats) return;
      $('#paletteGraphFiles').textContent = `${stats.files} ${stats.files === 1 ? 'file' : 'files'}${stats.partial ? ' indexed' : ''}`;
      $('#paletteGraphModified').textContent = stats.lastModified ? `Modified ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(stats.lastModified)}` : 'No modifications';
      $('#paletteGraphSize').textContent = `${stats.partial ? '≥ ' : ''}${formatGraphSize(stats.size)}`;
    };
    $('#paletteGraphName').textContent = store.name || 'Graph';
    if (paletteGraphStatsCache?.store === store && paletteGraphStatsCache.value && Date.now() - paletteGraphStatsCache.time < 30000) {
      applyStats(paletteGraphStatsCache.value); return;
    }
    $('#paletteGraphFiles').textContent = 'Calculating folder…'; $('#paletteGraphModified').textContent = ''; $('#paletteGraphSize').textContent = '';
    if (paletteGraphStatsCache?.store === store && paletteGraphStatsCache.promise) return;
    const cache = { store, promise: store.stats(), value: null, time: 0 }; paletteGraphStatsCache = cache;
    cache.promise.then(stats => {
      cache.value = stats; cache.time = Date.now(); cache.promise = null; applyStats(stats);
    }).catch(() => {
      if (graphStore === store) $('#paletteGraphFiles').textContent = 'Folder statistics unavailable';
      cache.promise = null;
    });
  }

  function renderCommandList() {
    const rawQuery = $('#commandInput').value.trim(); const query = rawQuery.toLowerCase(); const searching = Boolean(query);
    const commandQuery = query.replace(/^\/+/, ''); const slashQuery = query.startsWith('/');
    const commandItems = [...commands, ...contextualCommands()].filter(command => slashQuery
      ? (command.aliases || '').toLowerCase().split(/\s+/).some(alias => alias.startsWith(query))
      : `${command.label} ${command.keywords || ''}`.toLowerCase().includes(commandQuery));
    const blockItems = slashQuery ? [] : blockResultCommands(query);
    const allPageItems = slashQuery ? [] : recentPageCommands(rawQuery);
    const createItems = allPageItems.filter(command => command.createPage);
    const pageItems = allPageItems.filter(command => !command.createPage);
    const visibleItems = (items, section) => expandedCommandSections.has(section) ? items : items.slice(0, 5);
    const visiblePageItems = visibleItems(pageItems, 'pages');
    const visibleCommandItems = visibleItems(commandItems, 'commands');
    const visibleBlockItems = visibleItems(blockItems, 'blocks');
    filteredCommands = searching
      ? [...createItems, ...visiblePageItems, ...visibleCommandItems, ...visibleBlockItems]
      : [...visibleCommandItems, ...visiblePageItems];
    selectedCommand = Math.max(0, Math.min(selectedCommand, filteredCommands.length - 1));
    $('.command-palette').classList.toggle('searching', searching);
    $('#createPageSection').hidden = !createItems.length;
    $('#pageResultSection').hidden = !pageItems.length;
    $('#commandResultSection').hidden = !commandItems.length;
    $('#blockResultSection').hidden = !blockItems.length;
    $('#recentHeading').textContent = searching ? 'Pages' : 'Recent pages';
    const createOffset = 0;
    const pageOffset = searching ? createItems.length : visibleCommandItems.length;
    const commandOffset = searching ? createItems.length + visiblePageItems.length : 0;
    const blockOffset = commandOffset + visibleCommandItems.length;
    $('#createPageList').innerHTML = createItems.map((command, index) => commandMarkup(command, createOffset + index)).join('');
    $('#recentPageList').innerHTML = visiblePageItems.map((command, index) => commandMarkup(command, pageOffset + index)).join('');
    $('#commandList').innerHTML = visibleCommandItems.map((command, index) => commandMarkup(command, commandOffset + index)).join('');
    $('#blockResultList').innerHTML = visibleBlockItems.map((command, index) => commandMarkup(command, blockOffset + index)).join('');
    $$('[data-command-section-more]').forEach(button => {
      const counts = { pages: pageItems.length, commands: commandItems.length, blocks: blockItems.length };
      button.hidden = counts[button.dataset.commandSectionMore] <= 5 || expandedCommandSections.has(button.dataset.commandSectionMore);
    });
    $('.command-palette').classList.toggle('has-expanded-section', expandedCommandSections.size > 0);
    $$('[data-command-section]').forEach(section => section.classList.toggle('expanded', expandedCommandSections.has(section.dataset.commandSection)));
    renderPaletteGraphStats();
    $('.command-item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  function showCommandPalette(initialQuery = '') {
    const field = activeMarkdownField();
    paletteContext = field ? { field, start: field.selectionStart, end: field.selectionEnd } : null;
    $('#commandPalette').hidden = false; $('#commandInput').value = initialQuery; selectedCommand = 0; expandedCommandSections.clear(); renderCommandList();
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

  async function activateJournalBlock(pagePath, blockId, action = 'edit', position = null) {
    const page = graphStore?.pages.find(item => item.path === pagePath); if (!page) return;
    if (page.path !== state.graphPage?.path) {
      if (state.dirty && !(await flushGraphSave(true))) return;
      await loadGraphPage(page, { journalMode: true });
    }
    const block = graphBlockLocation(blockId)?.block; if (!block) return;
    if (action === 'toggle') { block.collapsed = !block.collapsed; saveGraphCollapse(); renderGraphPage(); return; }
    if (action === 'task') { toggleGraphTask(block, false); return; }
    if (action === 'zoom') { block.collapsed = false; saveGraphCollapse(); state.graphZoomId = block.id; focusGraphBlock(block.id); return; }
    activateGraphBlock(block, position, page);
  }

  async function openSingleJournalPage(pagePath) {
    const page = graphStore?.pages.find(item => item.path === pagePath); if (!page) return;
    await loadGraphPage(page, { journalMode: false });
    markdWrap.scrollTop = 0;
  }

  async function renameGraphPage(title) {
    const page = state.graphPage; const nextTitle = title.trim();
    if (page?.journal) { fileName.value = page.title; return; }
    if (!page || !nextTitle || nextTitle === page.title) { if (page) fileName.value = page.title; return; }
    try {
      commitGraphBlock();
      if (!(await flushGraphSave(true))) throw new Error('Save the current page before renaming it');
      const oldTitle = page.title;
      const duplicate = graphStore.findPage(nextTitle); if (duplicate && duplicate !== page) throw new Error('A page with this name already exists');
      const updateLinks = confirm(`Rename “${oldTitle}” to “${nextTitle}” and update page references?`);
      let currentContent = page.content.replace(/^(\s*title::\s*).+$/mi, `$1${nextTitle}`);
      if (updateLinks) {
        for (const linkedPage of [...graphStore.pages]) {
          const content = linkedPage === page ? currentContent : linkedPage.content;
          const updated = MarkdGraph.replacePageReferences(content, oldTitle, nextTitle);
          if (updated !== content) {
            await graphStore.writePage(linkedPage, updated);
            if (linkedPage === page) currentContent = updated;
          }
        }
      }
      const renamed = await graphStore.renamePage(page, nextTitle, currentContent);
      state.graphPage = renamed; state.graphDocument = MarkdGraph.parseDocument(currentContent); restoreGraphCollapse(); state.dirty = false;
      graphIndex = new MarkdGraph.GraphIndex(graphStore.pages); fileName.value = nextTitle;
      document.title = `${nextTitle} — ${graphStore.name} — markd`; saveSettings({ lastGraphPage: nextTitle });
      syncGraphRoute(renamed, { journalMode: state.journalMode, replaceRoute: true });
      renderGraphPage(); saveState.textContent = 'Saved'; toast('Page renamed');
    } catch (error) { fileName.value = page.title; toast(error.message || 'Could not rename the page'); }
  }

  // UI events
  mobileBlockToolbar.addEventListener('pointerdown', event => event.preventDefault());
  mobileBlockToolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-block-action]');
    const field = activeGraphBlock?.field; const block = activeGraphBlock?.block;
    if (!button || !field || !block) return;
    const action = button.dataset.blockAction;
    if (action === 'undo' || action === 'redo') { applyVimHistory(action === 'redo'); return; }
    const snapshot = captureVimSnapshot(field);
    if (['indent', 'outdent', 'up', 'down'].includes(action)) {
      const changed = action === 'indent' ? indentGraphBlock(block) : action === 'outdent' ? indentGraphBlock(block, true) : moveGraphBlock(block, action === 'up' ? -1 : 1);
      if (changed) { pushVimSnapshot(vimUndoStack, snapshot); vimRedoStack.length = 0; }
      return;
    }
    const brackets = action === 'square' ? ['[[', ']]'] : action === 'round' ? ['((', '))'] : null;
    if (!brackets) return;
    const start = field.selectionStart; const end = field.selectionEnd; const selected = field.value.slice(start, end);
    field.setRangeText(`${brackets[0]}${selected}${brackets[1]}`, start, end, 'end');
    const cursor = start + brackets[0].length; field.setSelectionRange(cursor, cursor);
    pushVimSnapshot(vimUndoStack, snapshot); vimRedoStack.length = 0; notifyMarkdownField(field);
  });
  document.addEventListener('pointerdown', event => {
    if (activeSourceBlock && !editor.contains(event.target) && !$('#commandPalette').contains(event.target)) commitActiveBlock();
    if (activeGraphBlock && !outliner.contains(event.target) && !$('#commandPalette').contains(event.target) && !graphAutocomplete.contains(event.target) && !journalCalendar.contains(event.target) && !mobileBlockToolbar.contains(event.target)) commitGraphBlock();
  }, true);
  editor.addEventListener('focusout', () => setTimeout(() => {
    if (activeSourceBlock && $('#commandPalette').hidden && !editor.contains(document.activeElement)) commitActiveBlock();
  }));
  $('#todayJournalButton').addEventListener('click', () => { closeJournalCalendar(); requestAction(() => openToday(true)); });
  $('#journalCalendarButton').addEventListener('click', event => { event.stopPropagation(); toggleJournalCalendar(); });
  journalCalendar.addEventListener('click', event => {
    const move = event.target.closest('[data-calendar-move]');
    if (move) { moveCalendarMonth(Number(move.dataset.calendarMove)); return; }
    const day = event.target.closest('[data-calendar-date]'); if (!day) return;
    const [year, month, date] = day.dataset.calendarDate.split('-').map(Number); const selectedDate = new Date(year, month - 1, date, 12);
    const action = calendarSelectAction; closeJournalCalendar();
    if (action) action(selectedDate); else requestAction(() => openSingleJournalDate(selectedDate));
  });
  journalCalendar.addEventListener('keydown', event => {
    const day = event.target.closest('[data-calendar-date]'); if (!day) return;
    const movements = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in movements) {
      event.preventDefault(); const next = new Date(calendarFocusDate); next.setDate(next.getDate() + movements[event.key]); focusCalendarDate(next);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); moveCalendarMonth(event.key === 'PageUp' ? -1 : 1);
    } else if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault(); focusCalendarDate(new Date());
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!journalCalendar.hidden && !journalCalendar.contains(event.target) && event.target !== $('#journalCalendarButton')) closeJournalCalendar();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !journalCalendar.hidden) closeJournalCalendar(); });
  $('#commandButton').addEventListener('click', () => showCommandPalette());
  $('#documentationClose').addEventListener('click', closeDocumentation);
  document.addEventListener('keydown', handleVimKeydown, true);
  document.addEventListener('pointerup', event => {
    if (!state.vimEnabled || state.vimMode !== 'normal') return;
    const field = event.target === sourceEditor ? sourceEditor : (event.target === activeGraphBlock?.field ? activeGraphBlock.field : (event.target === activeSourceBlock ? activeSourceBlock : null));
    if (field) requestAnimationFrame(() => showVimCursor(field, field.selectionStart));
  });
  $('#commandInput').addEventListener('input', () => { selectedCommand = -1; expandedCommandSections.clear(); renderCommandList(); });
  $('#commandInput').addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Tab' && !event.shiftKey && $('.command-palette').classList.contains('searching')) {
      const firstPage = $('#recentPageList .command-item');
      if (firstPage) { event.preventDefault(); firstPage.focus(); }
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); selectedCommand = Math.min(selectedCommand + 1, filteredCommands.length - 1); renderCommandList(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); selectedCommand = Math.max(selectedCommand - 1, 0); renderCommandList(); }
    if (event.key === 'Enter') { event.preventDefault(); runSelectedCommand(); }
    if (event.key === 'Escape') { event.preventDefault(); closeCommandPalette(); }
  });
  $('#commandPalette').addEventListener('focusin', event => {
    const item = event.target.closest('[data-command-index]'); if (!item) return;
    selectedCommand = Number(item.dataset.commandIndex);
    $$('.command-item', $('#commandPalette')).forEach(command => {
      const selected = command === item; command.classList.toggle('selected', selected); command.setAttribute('aria-selected', String(selected));
    });
  });
  function handleCommandListClick(event) {
    const item = event.target.closest('[data-command-index]'); if (item) runSelectedCommand(Number(item.dataset.commandIndex));
  }
  function expandCommandSection(section) {
    const button = $(`[data-command-section-more="${section}"]`); if (!button || button.hidden) return;
    const keepInputFocus = document.activeElement === $('#commandInput');
    const focusedIndex = document.activeElement.closest?.('[data-command-index]')?.dataset.commandIndex;
    expandedCommandSections.add(section); renderCommandList();
    if (keepInputFocus) $('#commandInput').focus();
    else if (focusedIndex != null) $(`[data-command-index="${focusedIndex}"]`, $('#commandPalette'))?.focus();
  }
  $('#commandPalette').addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' || (!event.ctrlKey && !event.metaKey)) return;
    const activeSection = document.activeElement.closest?.('[data-command-section]')?.dataset.commandSection;
    const selectedSection = $('.command-item.selected', $('#commandPalette'))?.closest('[data-command-section]')?.dataset.commandSection;
    const section = activeSection || selectedSection;
    const button = (section && $(`[data-command-section-more="${section}"]:not([hidden])`)) || $('[data-command-section-more]:not([hidden])');
    if (!button) return;
    event.preventDefault(); event.stopPropagation(); expandCommandSection(button.dataset.commandSectionMore);
  }, true);
  $$('[data-command-section-more]').forEach(button => button.addEventListener('click', () => expandCommandSection(button.dataset.commandSectionMore)));
  $('#createPageList').addEventListener('click', handleCommandListClick);
  $('#commandList').addEventListener('click', handleCommandListClick);
  $('#blockResultList').addEventListener('click', handleCommandListClick);
  $('#recentPageList').addEventListener('click', handleCommandListClick);
  $('#commandPalette').addEventListener('pointerdown', event => { if (event.target === $('#commandPalette')) closeCommandPalette(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (file) loadMarkdown(await file.text(), file.name); fileInput.value = '';
  });
  fileName.addEventListener('input', () => { if (!state.graphMode) changed(); });
  fileName.addEventListener('blur', () => {
    if (!fileName.value.trim()) fileName.value = state.graphMode ? state.graphPage.title : 'Untitled';
    if (state.graphMode) renameGraphPage(fileName.value); else persistLocal(false);
  });
  editor.addEventListener('input', event => {
    if (!event.target.matches?.('.md-source-block') && event.inputType?.startsWith('insert')) transformInlineMarkdown();
    changed();
  });
  sourceEditor.addEventListener('input', changed);
  sourceEditor.addEventListener('keydown', event => {
    if (handleSelectionDelimiter(event)) return;
    handleWikiPair(event);
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
  outliner.addEventListener('click', event => {
    const journalHeading = event.target.closest('[data-journal-page]');
    if (journalHeading) { openSingleJournalPage(journalHeading.dataset.journalPage); return; }
    if (event.target.closest('[data-journal-more]')) { state.journalLimit += 8; renderGraphPage(); return; }
    const blockNode = event.target.closest('.block-node'); const pagePath = blockNode?.dataset.pagePath;
    const task = event.target.closest('[data-task-block]');
    if (task) {
      if (state.journalMode && pagePath && pagePath !== state.graphPage.path) activateJournalBlock(pagePath, task.dataset.taskBlock, 'task');
      else { const block = graphBlockLocation(task.dataset.taskBlock)?.block; if (block) toggleGraphTask(block, false); }
      return;
    }
    const pageLink = event.target.closest('[data-page]');
    if (pageLink) { event.preventDefault(); loadGraphPage(pageLink.dataset.page, { create: true }); return; }
    const blockReference = event.target.closest('[data-block-ref]');
    if (blockReference) {
      const resolved = graphIndex?.resolveBlock(blockReference.dataset.blockRef);
      if (resolved) loadGraphPage(resolved.page, { blockId: resolved.block.id }); else toast('Referenced block not found');
      return;
    }
    const reference = event.target.closest('[data-reference-page]');
    if (reference) { loadGraphPage(reference.dataset.referencePage, { blockId: reference.dataset.referenceBlock }); return; }
    if (event.target.closest('[data-show-unlinked]')) { renderReferences(true); return; }
    if (event.target.closest('[data-clear-zoom]')) { state.graphZoomId = null; renderGraphPage(); return; }
    const toggle = event.target.closest('[data-block-toggle]');
    if (toggle) {
      if (state.journalMode && pagePath && pagePath !== state.graphPage.path) activateJournalBlock(pagePath, toggle.dataset.blockToggle, 'toggle');
      else { const block = graphBlockLocation(toggle.dataset.blockToggle)?.block; if (block) { block.collapsed = !block.collapsed; saveGraphCollapse(); renderGraphPage(); } }
      return;
    }
    const bullet = event.target.closest('[data-block-bullet]');
    if (bullet) {
      if (state.journalMode && pagePath && pagePath !== state.graphPage.path) activateJournalBlock(pagePath, bullet.dataset.blockBullet, 'zoom');
      else { const block = graphBlockLocation(bullet.dataset.blockBullet)?.block; if (block) { commitGraphBlock(); block.collapsed = false; saveGraphCollapse(); state.graphZoomId = block.id; focusGraphBlock(block.id); } }
      return;
    }
    const content = event.target.closest('.graph-block-content');
    if (content && !event.target.closest('button,a')) {
      if (state.journalMode && content.dataset.pagePath !== state.graphPage.path) activateJournalBlock(content.dataset.pagePath, content.dataset.blockId);
      else activateGraphBlock(graphBlockLocation(content.dataset.blockId)?.block);
    }
  });
  $('#addBlock').addEventListener('click', () => {
    const block = { id: MarkdGraph.newId(), uuid: null, content: '', marker: '-', children: [], collapsed: false };
    state.graphDocument.blocks.push(block); graphMutationFocus(block, 0);
  });
  graphAutocomplete.addEventListener('pointerdown', event => event.preventDefault());
  graphAutocomplete.addEventListener('click', event => {
    const item = event.target.closest('[data-autocomplete-index]'); if (item) chooseGraphAutocomplete(Number(item.dataset.autocompleteIndex));
  });

  function setTheme(theme) {
    app.classList.remove('theme-sepia', 'theme-dark'); if (theme !== 'light') app.classList.add(`theme-${theme}`);
    const themeColors = { light: '#fdfcfb', sepia: '#f5efe3', dark: '#282725' };
    $('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme] || themeColors.light);
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
    if (!documentationView.hidden) { if (event.key === 'Escape') { event.preventDefault(); closeDocumentation(); } return; }
    if (event.key === '?' && !mod && !event.altKey && !event.target.matches?.('input,textarea,[contenteditable="true"]')) { event.preventDefault(); showDocumentation(); return; }
    if (state.graphMode && mod && event.shiftKey && key === 'j') { event.preventDefault(); requestAction(openToday); return; }
    if (state.graphMode && event.altKey && !mod && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); navigateGraphHistory(event.key === 'ArrowLeft' ? -1 : 1); return;
    }
    if (event.key === 'F2') { event.preventDefault(); commitActiveBlock(); commitGraphBlock(); fileName.focus(); fileName.select(); return; }
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
  let externalCheckTime = 0;
  function scheduleRemoteRefresh() {
    clearTimeout(remoteRefreshTimer);
    remoteRefreshTimer = setTimeout(() => checkExternalGraphPage(true), 120);
  }

  function watchRemoteGraph() {
    closeRemoteEvents?.(); closeRemoteEvents = null;
    if (!graphStore?.isRemote || !graphStore.subscribe) return;
    closeRemoteEvents = graphStore.subscribe(event => {
      const currentPath = state.graphPage?.path;
      if (event.path === currentPath && event.revision && String(event.revision) === String(state.graphPage.lastModified)) return;
      if (state.dirty) {
        remoteRefreshPending = true;
        if (event.path === currentPath || event.oldPath === currentPath) { state.graphConflict = true; saveState.textContent = 'Conflict'; }
        return;
      }
      scheduleRemoteRefresh();
    });
  }

  async function checkExternalGraphPage(force = false) {
    if (!state.graphMode || !state.graphPage || (!force && Date.now() - externalCheckTime < 1500)) return;
    externalCheckTime = Date.now();
    try {
      if (state.dirty) {
        const fresh = await graphStore.freshFile(state.graphPage);
        if (fresh.lastModified !== state.graphPage.lastModified) { state.graphConflict = true; saveState.textContent = 'Conflict'; }
        return;
      }
      const currentPath = state.graphPage.path; const previousModified = state.graphPage.lastModified;
      const pages = await graphStore.scan(); const current = pages.find(page => page.path === currentPath);
      graphIndex = new MarkdGraph.GraphIndex(pages);
      if (!current) { remoteRefreshPending = false; saveState.textContent = 'Page removed'; return; }
      state.graphPage = current; journalDocuments.clear(); remoteRefreshPending = false;
      if (current.lastModified !== previousModified) {
        state.graphDocument = MarkdGraph.parseDocument(current.content); restoreGraphCollapse();
        updateStats(); saveState.textContent = 'Reloaded'; toast('Page reloaded from disk');
      }
      if (state.journalMode) { journalDocuments.set(current.path, state.graphDocument); renderGraphPage(); }
      else if (current.lastModified !== previousModified) renderGraphPage();
      else renderReferences();
    } catch {}
  }
  window.addEventListener('focus', checkExternalGraphPage);
  window.addEventListener('popstate', async () => {
    const route = graphRoute();
    if (!route) {
      if (!state.graphMode) return;
      if (state.dirty && !(await flushGraphSave(true))) return;
      loadInitialDocument();
      return;
    }
    if (!graphStore || !graphIndex) return;
    const page = pageFromGraphRoute(route);
    if (!page) return toast('Page in URL not found in this graph');
    await loadGraphPage(page, { journalMode: route.journalMode, routeNavigation: !route.legacy, replaceRoute: Boolean(route.legacy), resetJournalLimit: route.journalMode });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkExternalGraphPage(); else if (state.graphMode) flushGraphSave(false); });
  let journalScrollLoading = false;
  markdWrap.addEventListener('scroll', () => {
    if (!state.journalMode || state.graphZoomId || activeGraphBlock || journalScrollLoading) return;
    if (markdWrap.scrollTop + markdWrap.clientHeight < markdWrap.scrollHeight - 240) return;
    if (state.journalLimit >= orderedJournalPages().length) return;
    journalScrollLoading = true; const scrollTop = markdWrap.scrollTop;
    state.journalLimit += 8; renderGraphPage(); markdWrap.scrollTop = scrollTop;
    requestAnimationFrame(() => { journalScrollLoading = false; });
  });
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
  function loadInitialDocument(options = {}) {
    const storedDocs = getStoredDocs();
    if (storedDocs.length) loadMarkdown(storedDocs[0].markdown, storedDocs[0].name, { id: storedDocs[0].id, ...options });
    else loadMarkdown(starter, 'Welcome', options);
  }

  app.classList.add('initial-loading');
  saveState.textContent = 'Loading…';
  (async () => {
    try {
      const remote = await MarkdGraph.RemoteGraphStore.connect();
      graphStore = remote; const pages = await graphStore.scan(); graphIndex = new MarkdGraph.GraphIndex(pages); watchRemoteGraph();
      if (state.dirty) return;
      journalDocuments.clear(); graphHistory = []; graphHistoryIndex = -1; await openGraphLanding({ replaceRoute: true });
      return;
    } catch {}
    try {
      const restored = await MarkdGraph.GraphStore.restore();
      if (restored && await restored.ensurePermission(false)) {
        graphStore = restored; const pages = await graphStore.scan(); graphIndex = new MarkdGraph.GraphIndex(pages);
        if (state.dirty) return;
        journalDocuments.clear(); graphHistory = []; graphHistoryIndex = -1; await openGraphLanding({ replaceRoute: true });
        return;
      }
    } catch {}
    if (!state.dirty) loadInitialDocument({ preserveGraphRoute: Boolean(graphRoute()) });
  })().finally(() => app.classList.remove('initial-loading'));

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
