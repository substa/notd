# markd

A minimal, framework-free Markdown editor and local-first outliner. It can edit individual documents or open a Logseq-style graph directly from the user’s filesystem; no content is sent to external services.

## Run locally

```bash
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173).

### Share one graph on the LAN

To serve the app together with a writable graph:

```bash
python3 server.py \
  --host 0.0.0.0 \
  --port 4176 \
  --graph /absolute/path/to/your/logseq-graph
```

Open `http://localhost:4176` on the host or `http://192.168.1.10:4176` from another device. The app detects the server graph automatically; every client reads and writes the same Markdown files. Server-Sent Events propagate saves immediately to the other clients, while a lightweight watcher detects edits made directly by Logseq within about one second. Autosave and conflict detection remain active.

The graph API currently has no application authentication. Bind it beyond localhost only on a trusted, controlled LAN and do not expose it directly to the internet. Username/password authentication can be added before public deployment. The default host remains `127.0.0.1`.

The server still exposes only the application allowlist (not repository/source files), rejects cross-origin browser writes, applies restrictive browser security headers, limits request and graph-file sizes, uses atomic writes, and caches unchanged Markdown reads. API JSON responses are compressed when supported.

Run the graph parser/index tests with:

```bash
node --test tests/graph.test.js
```

The app is entirely static and can be deployed to any HTTPS host, including GitHub Pages, Netlify, Vercel, or nginx. HTTPS enables the PWA and File System Access API in supported browsers.

## Features

- distraction-free interface with files, recent documents, outline, themes, and tools collected in the command palette;
- inline Markdown formatting (`**bold**`, `*italic*`, and `` `code` ``);
- contextual block editing that reveals Markdown source and formats it again when focus moves away;
- block navigation with arrow keys or `Alt + ↑/↓`;
- optional persistent Vim mode with Normal/Insert modes, `h/j/k/l`, word and document motions, `Ctrl-D/U`, and undo/redo with `u` and `Ctrl-R`;
- command palette split between commands and recent pages, with a shared search field, available with `⌘/Ctrl + K`, `F1`, or `⌘/Ctrl + Shift + P`;
- shortcuts for files, search, formatting, navigation, and appearance;
- visual Markdown editing and full source mode;
- headings, links, quotes, lists, tasks, code blocks, and tables;
- file picker and drag-and-drop opening;
- direct saving on Chromium and `.md` downloads on other browsers;
- local copies and recent documents;
- automatic outline, search, and word count;
- light, dark, and system themes, with automatic system appearance updates;
- HTML export;
- desktop/mobile layouts and offline PWA support;
- local graphs backed by `pages/`, `journals/`, and Markdown files;
- automatic filesystem saves with IndexedDB recovery drafts and external-change detection;
- nested blocks with keyboard indentation, reordering, collapse, zoom, and task cycling;
- `[[page references]]`, page creation/autocomplete, `((block references))`, linked and unlinked references;
- graph-wide page switching and block search from the command palette;
- graph index resync and conservative orphaned-asset cleanup commands;
- `/upload` attachments saved under the graph’s `assets/` directory;
- `<quote` and `<src` inline commands for quickly inserting quotes and fenced code blocks;
- clean, copyable client-side URLs such as `/pages/page-name` and `/journals/2026_07_18`, with browser back/forward navigation;
- incremental in-browser index updates, avoiding a full graph reparse after each edit;
- daily journals and safe page renaming with optional reference updates;
- complete built-in documentation, always available with `?` or from the command palette.

## Privacy

In direct local mode, no content is sent to a server. Automatic document copies are stored in `localStorage`; graph recovery drafts and the selected directory handle are stored in IndexedDB. When `server.py --graph` is used, content is exchanged only with that markd server so LAN clients can share the graph. The Markdown files in the selected or served graph remain the source of truth.

## Local graph support

Use **Open local graph** from the command palette and select a folder. markd reads Markdown files at the graph root and under `pages/` and `journals/`. The graph index is rebuilt locally and supports Logseq-style page and block references. In the outliner, use `Enter` to add a sibling, `Shift+Enter` for a line break, `Tab`/`Shift+Tab` to change depth, `Alt+↑/↓` to reorder, and `⌘/Ctrl+Enter` to cycle task states. Use `⌘/Ctrl+click` to select multiple blocks or `Shift+click` to select a visible range, then press `Backspace` to delete them. Click a bullet to zoom into it; use the small arrow to collapse or expand nested blocks.

Opening a graph starts on today's Logseq-compatible journal. Existing journals are shown below it in reverse chronological order and loaded progressively while scrolling. In a block, type `/` to show inline commands: `/today`, `/yesterday`, and `/tomorrow` insert journal references, `/date picker` inserts a selected `[[page reference]]`, and `/upload` saves an attachment in `assets/` and inserts its Markdown link. Use **Sync all notes and backlinks** to force a full index rebuild after external changes. **Clean orphaned assets** lists unreferenced attachments and asks for confirmation before deleting them. Use `⌘/Ctrl+Shift+J` for today's journal and `Alt+←/→` to move backward or forward through page history. The journal filename and displayed date follow `:journal/file-name-format` and `:journal/page-title-format` from `logseq/config.edn` (default filename: `yyyy_MM_dd.md`).

Direct directory access requires the File System Access API and currently works best in Chromium-based browsers. Other browsers can continue to use the single-document editor and download-based saving.
