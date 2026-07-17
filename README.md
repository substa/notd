# markd

A minimal, framework-free Markdown editor and local-first outliner. It can edit individual documents or open a Logseq-style graph directly from the user’s filesystem; no content is sent to external services.

## Run locally

```bash
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173).

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
- command palette with icon-only quick actions for new, open, save, and export, available with `/` in Vim mode, `⌘/Ctrl + K`, `F1`, or `⌘/Ctrl + Shift + P`;
- shortcuts for files, search, formatting, navigation, and appearance;
- visual Markdown editing and full source mode;
- headings, links, quotes, lists, tasks, code blocks, and tables;
- file picker and drag-and-drop opening;
- direct saving on Chromium and `.md` downloads on other browsers;
- local copies and recent documents;
- automatic outline, search, and word count;
- light, sepia, and dark themes;
- HTML export;
- desktop/mobile layouts and offline PWA support;
- local graphs backed by `pages/`, `journals/`, and Markdown files;
- automatic filesystem saves with IndexedDB recovery drafts and external-change detection;
- nested blocks with keyboard indentation, reordering, collapse, zoom, and task cycling;
- `[[page references]]`, page creation/autocomplete, `((block references))`, linked and unlinked references;
- graph-wide page switching and block search from the command palette;
- daily journals and safe page renaming with optional reference updates.

## Privacy

No content is sent to a server. Automatic document copies are stored in `localStorage`; graph recovery drafts and the selected directory handle are stored in IndexedDB. The Markdown files in the selected graph remain the source of truth, and the service worker caches only the app’s assets.

## Local graph support

Use **Open local graph** from the command palette and select a folder. markd reads Markdown files at the graph root and under `pages/` and `journals/`. The graph index is rebuilt locally and supports Logseq-style page and block references. In the outliner, use `Enter` to add a sibling, `Shift+Enter` for a line break, `Tab`/`Shift+Tab` to change depth, `Alt+↑/↓` to reorder, and `⌘/Ctrl+Enter` to cycle task states. Click a bullet to zoom into it; use the small arrow to collapse or expand nested blocks.

Opening a graph starts on today's Logseq-compatible journal. Existing journals are shown below it in reverse chronological order and loaded progressively while scrolling. From an empty block, use `/yesterday`, `/tomorrow`, or `/date picker` to open or create another journal date. Use `⌘/Ctrl+Shift+J` for today's journal and `Alt+←/→` to move backward or forward through page history. The journal filename and displayed date follow `:journal/file-name-format` and `:journal/page-title-format` from `logseq/config.edn` (default filename: `yyyy_MM_dd.md`).

Direct directory access requires the File System Access API and currently works best in Chromium-based browsers. Other browsers can continue to use the single-document editor and download-based saving.
