# markd

A web-based Markdown editor inspired by Typora’s minimal writing experience. It uses no frameworks or external services: documents stay in the browser or on the user’s filesystem.

## Run locally

```bash
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173).

The app is entirely static and can be deployed to any HTTPS host, including GitHub Pages, Netlify, Vercel, or nginx. HTTPS enables the PWA and File System Access API in supported browsers.

## Features

- distraction-free interface with files, recent documents, outline, themes, and tools collected in the command palette;
- inline Markdown formatting (`**bold**`, `*italic*`, and `` `code` ``);
- contextual block editing that reveals Markdown source and formats it again when focus moves away;
- block navigation with arrow keys or `Alt + ↑/↓`;
- optional persistent Vim mode with Normal/Insert modes, `h/j/k/l`, word and document motions, `Ctrl-D/U`, and undo/redo with `u` and `Ctrl-R`;
- command palette available with `/` in Vim mode, `⌘/Ctrl + K`, `F1`, or `⌘/Ctrl + Shift + P`;
- shortcuts for files, search, formatting, navigation, and appearance;
- visual Markdown editing and full source mode;
- headings, links, quotes, lists, tasks, code blocks, and tables;
- file picker and drag-and-drop opening;
- direct saving on Chromium and `.md` downloads on other browsers;
- local copies and recent documents;
- automatic outline, search, and word count;
- light, sepia, and dark themes;
- HTML export;
- desktop/mobile layouts and offline PWA support.

## Privacy

No content is sent to a server. Automatic copies are stored in `localStorage`; the service worker caches only the app’s assets for offline use.
