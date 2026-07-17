(() => {
  'use strict';

  const DB_NAME = 'markd-graph-v1';
  const DB_VERSION = 1;
  const HANDLE_KEY = 'last-graph';
  const markdownFile = /\.(md|markdown)$/i;

  const normalizePage = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const newId = () => crypto.randomUUID?.() || `markd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hash = value => {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbRequest(store, mode, action) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  const setState = (key, value) => dbRequest('state', 'readwrite', store => store.put(value, key));
  const getState = key => dbRequest('state', 'readonly', store => store.get(key));
  const saveDraft = (path, value) => dbRequest('drafts', 'readwrite', store => store.put({ ...value, savedAt: Date.now() }, path));
  const getDraft = path => dbRequest('drafts', 'readonly', store => store.get(path));
  const removeDraft = path => dbRequest('drafts', 'readwrite', store => store.delete(path));

  function indentationWidth(value) {
    let width = 0;
    for (const character of value) width += character === '\t' ? 2 : 1;
    return width;
  }

  function propertiesFrom(text) {
    const properties = {};
    for (const match of text.matchAll(/^\s*([\w-]+)::\s*(.*?)\s*$/gm)) properties[match[1].toLowerCase()] = match[2];
    return properties;
  }

  function parseDocument(markdown = '') {
    const source = markdown.replace(/\r\n?/g, '\n');
    const lines = source.split('\n');
    const indents = lines.map(line => line.match(/^([ \t]*)[-+*]\s/)?.[1]).filter(value => value && indentationWidth(value));
    const unit = Math.max(1, Math.min(4, ...indents.map(indentationWidth), 2));
    const document = { preamble: [], blocks: [], trailingNewline: source.endsWith('\n') };
    const stack = [];
    let current = null;
    let inFence = false;

    lines.forEach((line, lineNumber) => {
      if (lineNumber === lines.length - 1 && !line && document.trailingNewline) return;
      const bullet = !inFence && line.match(/^([ \t]*)([-+*])(?:\s(.*)|\s*)$/);
      if (bullet) {
        let depth = Math.floor(indentationWidth(bullet[1]) / unit);
        depth = Math.min(depth, stack.length);
        const content = bullet[3] || '';
        const properties = propertiesFrom(content);
        const block = {
          id: properties.id || `line-${lineNumber}-${hash(content)}`,
          uuid: properties.id || null,
          content,
          marker: bullet[2],
          children: [],
          collapsed: false,
          line: lineNumber
        };
        const siblings = depth === 0 ? document.blocks : stack[depth - 1].children;
        siblings.push(block);
        stack.length = depth;
        stack[depth] = block;
        current = block;
        return;
      }

      if (!current) {
        document.preamble.push(line);
        return;
      }

      const expected = ' '.repeat((stack.length + 1) * unit);
      const continuation = line.startsWith(expected) ? line.slice(expected.length) : line.replace(/^\s{1,2}/, '');
      current.content += `\n${continuation}`;
      if (/^\s*(```|~~~)/.test(continuation)) inFence = !inFence;
    });

    while (document.preamble.length && document.preamble.at(-1) === '') document.preamble.pop();
    for (const { block } of flattenBlocks(document.blocks)) {
      const uuid = propertiesFrom(block.content).id;
      if (uuid) { block.uuid = uuid; block.id = uuid; }
    }
    if (!document.blocks.length && !document.preamble.some(line => line.trim())) document.blocks.push({ id: newId(), uuid: null, content: '', marker: '-', children: [], collapsed: false, line: 0 });
    return document;
  }

  function serializeDocument(document) {
    const output = [...(document.preamble || [])];
    if (output.length && document.blocks?.length) output.push('');
    const visit = (blocks, depth) => {
      for (const block of blocks) {
        const lines = String(block.content ?? '').split('\n');
        output.push(`${'  '.repeat(depth)}${block.marker || '-'} ${lines.shift() || ''}`);
        for (const line of lines) output.push(`${'  '.repeat(depth + 1)}${line}`);
        visit(block.children || [], depth + 1);
      }
    };
    visit(document.blocks || [], 0);
    const result = output.join('\n').replace(/^\n+/, '');
    return result + (document.trailingNewline && result ? '\n' : '');
  }

  function flattenBlocks(blocks, result = [], parent = null) {
    for (const block of blocks || []) {
      result.push({ block, parent });
      flattenBlocks(block.children, result, block);
    }
    return result;
  }

  function pageReferences(text) {
    return [...text.matchAll(/\[\[([^\]]+?)\]\]/g)].map(match => match[1].split('|')[0].trim());
  }

  function blockReferences(text) {
    return [...text.matchAll(/\(\(([0-9a-z-]{8,})\)\)/gi)].map(match => match[1]);
  }

  function tags(text) {
    return [...text.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(match => match[2]);
  }

  function pageTitle(content, filename) {
    const property = content.match(/^\s*title::\s*(.+?)\s*$/mi)?.[1];
    if (property) return property;
    const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1];
    if (heading && !/^\s*[-+*]\s/.test(content)) return heading;
    const base = filename.replace(/\.(md|markdown)$/i, '').replace(/___/g, '/');
    try { return decodeURIComponent(base); } catch { return base; }
  }

  function safeFilename(title) {
    return String(title || 'Untitled').trim().replace(/\//g, '___').replace(/[<>:"\\|?*\u0000-\u001f]/g, '_') || 'Untitled';
  }

  const defaultJournalConfig = { fileNameFormat: 'yyyy_MM_dd', pageTitleFormat: 'MMM do, yyyy' };
  const monthLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthShort = monthLong.map(month => month.slice(0, 3));
  const weekdayLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ordinal = day => `${day}${day % 10 === 1 && day % 100 !== 11 ? 'st' : day % 10 === 2 && day % 100 !== 12 ? 'nd' : day % 10 === 3 && day % 100 !== 13 ? 'rd' : 'th'}`;

  function formatJournalDate(date, format = defaultJournalConfig.pageTitleFormat) {
    const values = {
      yyyy: String(date.getFullYear()), yy: String(date.getFullYear()).slice(-2),
      MMMM: monthLong[date.getMonth()], MMM: monthShort[date.getMonth()],
      MM: String(date.getMonth() + 1).padStart(2, '0'), M: String(date.getMonth() + 1),
      do: ordinal(date.getDate()), dd: String(date.getDate()).padStart(2, '0'), d: String(date.getDate()),
      EEEE: weekdayLong[date.getDay()], EEE: weekdayLong[date.getDay()].slice(0, 3)
    };
    return format.replace(/yyyy|MMMM|EEEE|MMM|EEE|yy|MM|do|dd|M|d/g, token => values[token]);
  }

  function parseJournalDate(filename, format = defaultJournalConfig.fileNameFormat) {
    const base = filename.replace(/\.(md|markdown)$/i, '');
    const tokens = []; let pattern = '^';
    for (let index = 0; index < format.length;) {
      const token = ['yyyy', 'MM', 'dd', 'M', 'd'].find(candidate => format.startsWith(candidate, index));
      if (token) { tokens.push(token); pattern += token === 'yyyy' ? '(\\d{4})' : '(\\d{1,2})'; index += token.length; }
      else { pattern += format[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); index++; }
    }
    let match = base.match(new RegExp(`${pattern}$`));
    let year, month, day;
    if (match) {
      tokens.forEach((token, index) => {
        if (token === 'yyyy') year = Number(match[index + 1]);
        else if (token === 'MM' || token === 'M') month = Number(match[index + 1]);
        else day = Number(match[index + 1]);
      });
    } else {
      match = base.match(/^(\d{4})[_-](\d{1,2})[_-](\d{1,2})$/) || base.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (match) [, year, month, day] = match.map(Number);
    }
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  class ConflictError extends Error {
    constructor(message = 'The file changed outside markd') { super(message); this.name = 'ConflictError'; }
  }

  class GraphStore {
    constructor(handle) {
      this.handle = handle;
      this.name = handle.name;
      this.pages = [];
      this.assetUrls = new Map();
      this.config = { ...defaultJournalConfig };
    }

    static async open() {
      if (!window.showDirectoryPicker) throw new Error('Directory access is not supported by this browser');
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'markd-graph' });
      const store = new GraphStore(handle);
      if (!(await store.ensurePermission(true))) throw new Error('Graph permission was not granted');
      await setState(HANDLE_KEY, handle).catch(() => {});
      return store;
    }

    static async restore() {
      try {
        const handle = await getState(HANDLE_KEY);
        return handle ? new GraphStore(handle) : null;
      } catch { return null; }
    }

    async ensurePermission(request = false) {
      const options = { mode: 'readwrite' };
      if ((await this.handle.queryPermission(options)) === 'granted') return true;
      return request && (await this.handle.requestPermission(options)) === 'granted';
    }

    async directory(path, create = false) {
      let directory = this.handle;
      for (const part of path.split('/').filter(Boolean)) directory = await directory.getDirectoryHandle(part, { create });
      return directory;
    }

    async readConfig() {
      try {
        const directory = await this.handle.getDirectoryHandle('logseq');
        const file = await (await directory.getFileHandle('config.edn')).getFile();
        const content = await file.text();
        const pageTitleFormat = content.match(/:journal\/page-title-format\s+"([^"]+)"/)?.[1];
        const fileNameFormat = content.match(/:journal\/file-name-format\s+"([^"]+)"/)?.[1];
        this.config = {
          pageTitleFormat: pageTitleFormat || defaultJournalConfig.pageTitleFormat,
          fileNameFormat: fileNameFormat || defaultJournalConfig.fileNameFormat
        };
      } catch { this.config = { ...defaultJournalConfig }; }
      return this.config;
    }

    async scan() {
      if (!(await this.ensurePermission(false))) throw new Error('Graph permission is required');
      await this.readConfig();
      const pages = [];
      const walk = async (directory, folder = '') => {
        for await (const [name, handle] of directory.entries()) {
          const path = folder ? `${folder}/${name}` : name;
          if (handle.kind === 'directory') {
            if (folder || ['pages', 'journals'].includes(name)) await walk(handle, path);
            continue;
          }
          if (!markdownFile.test(name) || (folder && !/^(pages|journals)(\/|$)/.test(folder))) continue;
          const file = await handle.getFile();
          const content = await file.text();
          const journalDateValue = folder === 'journals' ? parseJournalDate(name, this.config.fileNameFormat) : null;
          const explicitTitle = content.match(/^\s*title::\s*(.+?)\s*$/mi)?.[1];
          const journalTitle = journalDateValue ? explicitTitle || formatJournalDate(journalDateValue, this.config.pageTitleFormat) : null;
          pages.push({
            title: journalTitle || pageTitle(content, name), name, path, folder, handle,
            content, lastModified: file.lastModified, journal: folder === 'journals',
            journalDate: journalDateValue ? formatJournalDate(journalDateValue, 'yyyy-MM-dd') : null
          });
        }
      };
      await walk(this.handle);
      this.pages = pages.sort((a, b) => a.title.localeCompare(b.title));
      return this.pages;
    }

    findPage(title) {
      const key = normalizePage(title);
      return this.pages.find(page => normalizePage(page.title) === key);
    }

    async createPage(title, options = {}) {
      const existing = this.findPage(title);
      if (existing) return existing;
      const folder = options.folder || (options.journal ? 'journals' : 'pages');
      const directory = await this.directory(folder, true);
      const journalDateValue = options.journalDate || (options.journal ? new Date() : null);
      const journalFilename = journalDateValue ? formatJournalDate(journalDateValue, this.config.fileNameFormat) : null;
      const name = `${options.filename || journalFilename || safeFilename(title)}.md`;
      const handle = await directory.getFileHandle(name, { create: true });
      const page = { title, name, path: `${folder}/${name}`, folder, handle, content: '', lastModified: 0, journal: folder === 'journals', journalDate: journalDateValue ? formatJournalDate(journalDateValue, 'yyyy-MM-dd') : null };
      await this.writePage(page, options.content || '- ', { force: true });
      this.pages.push(page);
      this.pages.sort((a, b) => a.title.localeCompare(b.title));
      return page;
    }

    async writePage(page, content, options = {}) {
      if (!(await this.ensurePermission(options.requestPermission !== false))) throw new Error('Graph is read only');
      const file = await page.handle.getFile();
      if (!options.force && page.lastModified && file.lastModified !== page.lastModified) {
        const external = await file.text();
        if (external !== page.content) throw new ConflictError();
      }
      const writable = await page.handle.createWritable();
      await writable.write(content);
      await writable.close();
      const updated = await page.handle.getFile();
      page.content = content;
      page.lastModified = updated.lastModified;
      return page;
    }

    async renamePage(page, title, content) {
      const duplicate = this.findPage(title);
      if (duplicate && duplicate !== page) throw new Error('A page with this name already exists');
      const folder = page.folder || 'pages';
      const directory = await this.directory(folder, true);
      const name = `${safeFilename(title)}.md`;
      if (name === page.name) { await this.writePage(page, content); page.title = title; return page; }
      const handle = await directory.getFileHandle(name, { create: true });
      const renamed = { ...page, title, name, path: `${folder}/${name}`, handle, lastModified: 0 };
      await this.writePage(renamed, content, { force: true });
      await directory.removeEntry(page.name);
      this.pages = this.pages.filter(item => item !== page);
      this.pages.push(renamed);
      this.pages.sort((a, b) => a.title.localeCompare(b.title));
      await removeDraft(page.path).catch(() => {});
      return renamed;
    }

    async freshFile(page) {
      const file = await page.handle.getFile();
      return { content: await file.text(), lastModified: file.lastModified };
    }

    disposeAssets() {
      this.assetUrls.forEach(url => URL.revokeObjectURL(url)); this.assetUrls.clear();
    }

    async assetUrl(reference, fromFolder = 'pages') {
      if (/^[a-z]+:/i.test(reference) || reference.startsWith('#')) return reference;
      const decoded = decodeURIComponent(reference.split(/[?#]/)[0]);
      const parts = `${reference.startsWith('/') ? '' : fromFolder}/${decoded}`.split('/').filter(Boolean);
      const normalized = [];
      for (const part of parts) { if (part === '.') continue; if (part === '..') normalized.pop(); else normalized.push(part); }
      const key = normalized.join('/');
      if (this.assetUrls.has(key)) return this.assetUrls.get(key);
      let directory = this.handle;
      for (const part of normalized.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const handle = await directory.getFileHandle(normalized.at(-1));
      const url = URL.createObjectURL(await handle.getFile()); this.assetUrls.set(key, url); return url;
    }
  }

  class RemoteGraphStore {
    constructor(status, baseUrl = '/api/graph') {
      this.baseUrl = baseUrl;
      this.name = status.name || 'Server graph';
      this.config = { ...defaultJournalConfig, ...(status.config || {}) };
      this.pages = [];
      this.isRemote = true;
      this.clientId = newId();
    }

    static async connect(baseUrl = '/api/graph') {
      const response = await fetch(`${baseUrl}/status`, { cache: 'no-store' });
      if (!response.ok) throw new Error('No server graph is available');
      const status = await response.json();
      if (!status.enabled) throw new Error('The server graph is disabled');
      return new RemoteGraphStore(status, baseUrl);
    }

    async api(path, options = {}) {
      const response = await fetch(`${this.baseUrl}${path}`, { cache: 'no-store', ...options });
      if (response.ok) return response.json();
      let message = `Graph server error (${response.status})`;
      try { message = (await response.json()).error || message; } catch {}
      if (response.status === 409) throw new ConflictError(message);
      throw new Error(message);
    }

    async ensurePermission() { return true; }

    subscribe(listener) {
      const events = new EventSource(`${this.baseUrl}/events`);
      events.onmessage = message => {
        try {
          const event = JSON.parse(message.data);
          if (event.clientId !== this.clientId) listener(event);
        } catch {}
      };
      return () => events.close();
    }

    pageFromFile(file) {
      const folder = file.folder || '';
      const journal = /^journals(?:\/|$)/.test(folder);
      const journalDateValue = journal ? parseJournalDate(file.name, this.config.fileNameFormat) : null;
      const explicitTitle = file.content.match(/^\s*title::\s*(.+?)\s*$/mi)?.[1];
      const journalTitle = journalDateValue ? explicitTitle || formatJournalDate(journalDateValue, this.config.pageTitleFormat) : null;
      return {
        title: journalTitle || pageTitle(file.content, file.name), name: file.name, path: file.path, folder,
        content: file.content, lastModified: file.revision, journal,
        journalDate: journalDateValue ? formatJournalDate(journalDateValue, 'yyyy-MM-dd') : null
      };
    }

    async scan() {
      const payload = await this.api('/files');
      this.config = { ...defaultJournalConfig, ...(payload.config || {}) };
      this.pages = payload.files.map(file => this.pageFromFile(file)).sort((a, b) => a.title.localeCompare(b.title));
      return this.pages;
    }

    findPage(title) {
      const key = normalizePage(title);
      return this.pages.find(page => normalizePage(page.title) === key);
    }

    async createPage(title, options = {}) {
      const existing = this.findPage(title); if (existing) return existing;
      const folder = options.folder || (options.journal ? 'journals' : 'pages');
      const journalDateValue = options.journalDate || (options.journal ? new Date() : null);
      const journalFilename = journalDateValue ? formatJournalDate(journalDateValue, this.config.fileNameFormat) : null;
      const name = `${options.filename || journalFilename || safeFilename(title)}.md`;
      const page = {
        title, name, path: `${folder}/${name}`, folder, content: '', lastModified: null,
        journal: folder === 'journals', journalDate: journalDateValue ? formatJournalDate(journalDateValue, 'yyyy-MM-dd') : null
      };
      await this.writePage(page, options.content || '- ', { force: true, create: true });
      this.pages.push(page); this.pages.sort((a, b) => a.title.localeCompare(b.title)); return page;
    }

    async writePage(page, content, options = {}) {
      const payload = await this.api('/file', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: page.path, content, expectedRevision: page.lastModified, force: Boolean(options.force), create: Boolean(options.create), clientId: this.clientId })
      });
      page.content = content; page.lastModified = payload.revision; return page;
    }

    async renamePage(page, title, content) {
      const duplicate = this.findPage(title); if (duplicate && duplicate !== page) throw new Error('A page with this name already exists');
      const folder = page.folder || 'pages'; const name = `${safeFilename(title)}.md`; const target = `${folder}/${name}`;
      if (target === page.path) { await this.writePage(page, content); page.title = title; return page; }
      const payload = await this.api('/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: page.path, target, content, expectedRevision: page.lastModified, clientId: this.clientId })
      });
      const renamed = { ...page, title, name, path: payload.path, content, lastModified: payload.revision };
      this.pages = this.pages.filter(item => item !== page); this.pages.push(renamed); this.pages.sort((a, b) => a.title.localeCompare(b.title));
      await removeDraft(page.path).catch(() => {}); return renamed;
    }

    async freshFile(page) {
      const payload = await this.api(`/file?path=${encodeURIComponent(page.path)}`);
      return { content: payload.content, lastModified: payload.revision };
    }

    disposeAssets() {}

    async assetUrl(reference, fromFolder = 'pages') {
      if (/^[a-z]+:/i.test(reference) || reference.startsWith('#')) return reference;
      const decoded = decodeURIComponent(reference.split(/[?#]/)[0]);
      const parts = `${reference.startsWith('/') ? '' : fromFolder}/${decoded}`.split('/').filter(Boolean); const normalized = [];
      for (const part of parts) { if (part === '.') continue; if (part === '..') normalized.pop(); else normalized.push(part); }
      return `${this.baseUrl}/asset?path=${encodeURIComponent(normalized.join('/'))}`;
    }
  }

  class GraphIndex {
    constructor(pages = []) {
      this.contentOverrides = new Map();
      this.sourcePages = [];
      this.rebuild(pages);
    }

    rebuild(pages = this.sourcePages) {
      this.sourcePages = [...new Map(pages.map(page => [page.path, page])).values()];
      this.pages = new Map();
      this.documents = new Map();
      this.uuids = new Map();
      this.pageLinks = new Map();
      this.blockLinks = new Map();
      this.tagLinks = new Map();
      this.sourcePages.forEach(page => this.addPage(page, this.contentOverrides.get(page.path) ?? page.content));
      return this;
    }

    addTo(map, key, value) {
      const normalized = normalizePage(key);
      if (!map.has(normalized)) map.set(normalized, []);
      map.get(normalized).push(value);
    }

    addPage(page, content) {
      const key = normalizePage(page.title);
      const document = parseDocument(content);
      this.pages.set(key, page);
      this.documents.set(key, document);
      if (page.journalDate) {
        const [year, month, day] = page.journalDate.split('-').map(Number); const date = new Date(year, month - 1, day);
        [page.journalDate, formatJournalDate(date, 'yyyy_MM_dd'), formatJournalDate(date, 'MMM do, yyyy'), formatJournalDate(date, 'MMMM do, yyyy')]
          .forEach(alias => this.pages.set(normalizePage(alias), page));
      }
      const pageProperties = propertiesFrom(document.preamble.join('\n'));
      for (const alias of String(pageProperties.alias || '').split(',').map(item => item.trim().replace(/^\[\[|\]\]$/g, '')).filter(Boolean)) this.pages.set(normalizePage(alias), page);
      for (const { block } of flattenBlocks(document.blocks)) {
        const properties = propertiesFrom(block.content);
        const reference = { page, block, content: block.content };
        if (properties.id) { block.uuid = properties.id; this.uuids.set(normalizePage(properties.id), reference); }
        pageReferences(block.content).forEach(target => this.addTo(this.pageLinks, target, reference));
        blockReferences(block.content).forEach(target => this.addTo(this.blockLinks, target, reference));
        tags(block.content).forEach(tag => this.addTo(this.tagLinks, tag, reference));
      }
      return document;
    }

    removePage(page) {
      this.contentOverrides.delete(page.path);
      this.rebuild(this.sourcePages.filter(item => item.path !== page.path));
    }

    updatePage(page, content) {
      this.contentOverrides.set(page.path, content);
      const pages = this.sourcePages.filter(item => item.path !== page.path);
      pages.push(page);
      this.rebuild(pages);
    }

    resolvePage(title) { return this.pages.get(normalizePage(title)); }
    resolveBlock(uuid) { return this.uuids.get(normalizePage(uuid)); }
    referencesToPage(title) {
      const page = this.resolvePage(title); if (!page) return this.pageLinks.get(normalizePage(title)) || [];
      const aliases = [...this.pages].filter(([, candidate]) => candidate === page).map(([key]) => key);
      const references = aliases.flatMap(key => this.pageLinks.get(key) || []);
      return [...new Map(references.map(item => [`${item.page.path}:${item.block.id}`, item])).values()];
    }
    referencesToBlock(uuid) { return this.blockLinks.get(normalizePage(uuid)) || []; }
    allPages() { return [...new Set(this.pages.values())].sort((a, b) => a.title.localeCompare(b.title)); }

    search(query, limit = 30) {
      const needle = normalizePage(query);
      if (!needle) return [];
      const results = [];
      for (const page of this.allPages()) {
        const document = this.documents.get(normalizePage(page.title));
        for (const { block } of flattenBlocks(document?.blocks)) {
          if (normalizePage(block.content).includes(needle)) results.push({ page, block, content: block.content });
          if (results.length >= limit) return results;
        }
      }
      return results;
    }

    unlinkedReferences(title, limit = 50) {
      const needle = normalizePage(title);
      const linked = new Set(this.referencesToPage(title).map(item => `${item.page.path}:${item.block.id}`));
      return this.search(title, limit * 2).filter(item => !linked.has(`${item.page.path}:${item.block.id}`) && normalizePage(item.page.title) !== needle).slice(0, limit);
    }
  }

  function replacePageReferences(content, oldTitle, newTitle) {
    return content.replace(/\[\[([^\]]+?)\]\]/g, (whole, target) => {
      const [page, alias] = target.split('|');
      return normalizePage(page) === normalizePage(oldTitle) ? `[[${newTitle}${alias ? `|${alias}` : ''}]]` : whole;
    });
  }

  function journalInfo(date = new Date(), config = defaultJournalConfig) {
    return {
      title: formatJournalDate(date, config.pageTitleFormat || defaultJournalConfig.pageTitleFormat),
      filename: formatJournalDate(date, config.fileNameFormat || defaultJournalConfig.fileNameFormat),
      date: formatJournalDate(date, 'yyyy-MM-dd'), value: date
    };
  }

  window.MarkdGraph = {
    GraphStore, RemoteGraphStore, GraphIndex, ConflictError, parseDocument, serializeDocument, flattenBlocks,
    propertiesFrom, pageReferences, blockReferences, normalizePage, replacePageReferences,
    saveDraft, getDraft, removeDraft, journalInfo, formatJournalDate, parseJournalDate, newId
  };
})();
