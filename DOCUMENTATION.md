# notd — Documentation

notd is a local Markdown editor, block outliner, and graph reader compatible with the essential Logseq file structure. Markdown files remain the source of truth; notd does not introduce a proprietary data format.

## Quick start

### Local editor

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`, then use **Open local graph** from the command palette to select a folder.

### Shared LAN graph

```bash
python3 server.py \
  --host 0.0.0.0 \
  --port 4176 \
  --graph /absolute/path/to/graph
```

Open `http://localhost:4176` on the server or `http://SERVER-IP:4176` from another device. Every client reads and writes the same files.

> The graph API currently has no application authentication. Use it only on a trusted network and do not expose it directly to the internet. Username/password authentication should be added before public deployment.

## Installation and PWA

notd can run in a normal browser tab or as an installed Progressive Web App. Installation requires HTTPS, except on `localhost`.

### iPhone and iPad

1. Open notd in Safari.
2. Use **Share → Add to Home Screen**.
3. Launch notd from its Home Screen icon.

To install a renamed version or force an icon/name change, remove the existing Home Screen app, open the site again in Safari, and add it again. iOS controls the keyboard’s own previous/next/done accessory bar; a web app cannot hide it.

### Desktop browsers

Use the install button in the address bar or the browser menu. Chromium-based browsers provide the most complete local filesystem support. Browsers without the File System Access API can still use the server graph and download standalone documents.

### Updating the installed app

Open notd while online, close it completely, and launch it again. The Service Worker downloads the current application shell and removes obsolete caches. If an old interface remains, open the site once in the browser, reload it, then restart the installed app. As a last resort, remove and reinstall the PWA; graph files on disk are not deleted.

### Docker and Pangolin

The repository includes `Dockerfile`, `compose.yaml`, `.env.example`, and a complete [Docker and Pangolin deployment guide](./DEPLOYMENT.md). The container exposes notd only on server loopback for diagnostics and on a private Docker network shared with Newt. Pangolin must require authentication before forwarding traffic to `http://notd:4176`; never expose the writable Python API directly to the internet.

## Command palette

Open the command palette with:

- `⌘/Ctrl + K`;
- `⌘/Ctrl + Shift + P`;
- `F1`;
- `:` in Vim Normal mode.

Use the palette to find pages and blocks, change themes, open files, navigate journals, format content, manage graph maintenance, and open this documentation.

## Settings

Open the page menu from the gear icon at the right side of the footer. It provides **New page**, **Delete page** when the current page can be deleted, **Page history**, **Settings**, **Shortcuts**, and **Documentation**. You can also open Settings directly with `⌘/Ctrl + ,`.

- **General** controls the light, dark, or system theme, the accent color, and Vim mode.
- **Shortcuts** lists keyboard commands by section. Search the list, select a shortcut, and press a new key combination to replace it. Use **Reset** to restore its default.
- **Documentation** contains this complete guide. Its **On this page** menu jumps directly to every main section; on mobile it appears as a section selector.

When a graph is open, these preferences and custom shortcuts are saved in `.notd/settings.json` and follow the graph across devices.

### Graph maintenance commands

When a graph is open, the command palette also provides:

| Command | What it does |
| --- | --- |
| **Open local graph** | Select a graph folder with browser filesystem access. |
| **Sync all notes and backlinks** | Rescan every Markdown note and rebuild page, block, backlink, and autocomplete indexes. Use this after external changes that were not detected automatically. |
| **Clean orphaned assets** | Scans `assets/` and lists files whose path does not occur in any Markdown note before asking for confirmation to delete them. The check is deliberately conservative, but review the displayed list and keep backups before confirming. |
| **New graph page** | Create a Markdown page in `pages/`. |
| **Close graph** | Return to the single-document editor. |

## Graphs

### Offline PWA use

After a server graph has been opened successfully at least once, notd keeps a local replica of its notes and settings in IndexedDB. The installed PWA can then open the graph without a connection, edit existing notes, and create new pages or journals. Changes are applied immediately to the local index and placed in a persistent synchronization queue.

The footer reports **Offline** and the number of pending changes. Synchronization starts when the browser reports that it is online, when the PWA returns to the foreground, or when its window receives focus. This does not rely on Background Sync, which is unavailable on iOS; the PWA must be open or resumed for synchronization to run.

Each queued write retains the server revision from which it started. If that revision is still current, the change is uploaded automatically. If the server version changed in the meantime, notd preserves the local operation and reports a synchronization conflict instead of overwriting either version. Page renaming, deletion, and attachment upload currently require a connection.

The Service Worker caches only the application shell. Notes and pending operations are stored in IndexedDB rather than by indiscriminately caching graph API responses.

A graph can contain:

```text
pages/
  Example.md
journals/
  2026_07_17.md
assets/
logseq/
  config.edn
```

notd reads `.md` and `.markdown` files from the graph root, `pages/`, and `journals/`. It recognizes page titles, aliases, properties, page references, block UUIDs, and journal dates. Logseq aliases declared with `alias::` are searchable in the command palette; an alias result displays the canonical page title and opens that page. Logseq `key:: value` properties—including custom fields such as `company::` and `name::`—remain preserved in Markdown source but are hidden from the formatted page when they have no visual representation.

### Open a page

Open the command palette and search for its title. Global search also includes block content. Selecting a block result opens it directly.

### Create a page

Type `[[`. notd immediately inserts `]]` and leaves the caret between the brackets:

```text
[[|]]
```

Enter a title. If the page does not exist, choose **Create page** and press `Enter`. The reference is completed and the page is created. The caret remains immediately after the closing `]]`, so typing can continue in the same block.

### Rename a page

Use **Rename document** or `F2`, edit the title, then select the minimal checkmark icon to save. The adjacent trash icon deletes the current page after confirmation. notd can update matching `[[...]]` references throughout the graph. Case-only changes such as `test` to `Test` are supported, including on case-insensitive filesystems. Journal pages cannot be renamed or deleted, preserving Logseq compatibility.

### Page history

When the server graph is inside a Git repository, choose **Page history** from the footer menu to display up to 100 commits for the current Markdown file. Each entry shows the short commit hash, subject, author, and date. Expand a commit to load and display its unified diff for that page; diffs are fetched only when requested. Added lines are highlighted in green, removed lines in red, hunk headers in cyan, and Git metadata with the same syntax palette used by code blocks. Rename history is followed when Git can detect it, and a notice appears when the working copy has uncommitted changes.

The browser cannot inspect Git repositories opened directly through the File System Access API, so this feature requires `server.py`. The Docker image includes Git. notd invokes Git with argument arrays rather than a shell and restricts the requested path to the configured graph.

## Blocks and outliner

Each bullet is a block. Nested blocks are stored through Markdown indentation.

| Action | Command |
| --- | --- |
| Create the next block | `Enter` |
| Insert a line in the same block | `Shift + Enter` |
| Indent | `Tab` |
| Outdent | `Shift + Tab` |
| Move up or down | `Alt + ↑/↓` |
| Delete an empty block | `Backspace` |
| Select multiple blocks | `⌘/Ctrl + click`; use `Shift + click` for a range |
| Delete selected blocks | `Backspace` |
| Clear the block selection | `Escape` |
| Cycle the task state | `⌘/Ctrl + Enter` |
| Collapse or expand children | Arrow beside the bullet |
| Zoom into a block | Click the bullet |

Editing does not add a border or background to the active block. To select blocks for a bulk action, use `⌘/Ctrl + click`; `Shift + click` extends the selection across the visible range. Selected blocks are highlighted and can be deleted together with `Backspace`. Deleting a parent block also deletes its nested blocks.

## Tasks

Task status controls behave consistently in journal blocks, regular pages, the journal task summary, and the complete task dashboard. Clicking the status indicator changes the state; clicking the task text in a dashboard still opens its source block.

| Interaction | From `TODO` | From `DOING` | From `DONE` |
| --- | --- | --- | --- |
| Click or tap | `DONE` | `DONE` | `TODO` |
| `Shift + click` | `DOING` | `TODO` | `DOING` |
| Press and hold | `DOING` | `TODO` | `DOING` |
| `⌘/Ctrl + Enter` while editing | `DOING` | `DONE` | `TODO` |

A normal click is therefore the quick completion action. Use `Shift + click` when a task should be marked as in progress instead, or hold the status control for about half a second on a touch device. Moving the pointer or finger cancels the hold gesture. Devices that support vibration provide brief feedback when the long press is recognized.

`Shift + click` on a task status is reserved for changing its state and does not extend the block selection. `⌘/Ctrl + Enter` preserves the complete keyboard workflow:

```text
TODO → DOING → DONE → TODO
```

Changes made from a task summary or dashboard are written back to the task's original Markdown page. Before a task moves to another section or disappears from the current filtered list, its row briefly displays **Completed**, **In progress**, or **To do** to confirm the new state.

Task-state changes participate in the regular undo/redo history, including changes made from summaries and dashboards. Use `⌘/Ctrl + Z` to restore the previous state and `⌘/Ctrl + Shift + Z` (or `⌘/Ctrl + Y`) to reapply it. Undo and redo update the task in its original Markdown page and show a confirmation message with the restored state.

## References

### Page references

```text
[[Page name]]
[[Page name|Label]]
#tag
```

Click a reference to open its page. A missing page opens as a virtual page so its backlinks can be viewed; a Markdown file is created only after you edit it.

### Block references

Select a block and run **Copy block reference**. When required, notd adds:

```text
id:: UUID
```

The copied reference has this form:

```text
((UUID))
```

### Linked references

Single pages show references grouped by source page. The source title and all matching blocks share one card. Blocks with nested content can be expanded directly inside linked, block, and unlinked references. Reference groups are always ordered from the most recent source page to the oldest. For journals, the date displayed in the page title is authoritative; the filename-derived date is used only when the title cannot be parsed. This keeps imported journals correctly ordered when their filenames contain different dates. Other pages use `created-at::`, `created::`, or the file modification date. Unlinked references are available on demand, while block references are shown when a referenced block is zoomed.

## Journals

Opening a graph displays today's journal. If its file does not exist, notd creates it automatically.

The default filename is:

```text
journals/yyyy_MM_dd.md
```

When a graph is opened for the first time, notd imports these compatible settings from `logseq/config.edn`:

```clojure
:journal/file-name-format
:journal/page-title-format
```

The imported values are written to `.notd/settings.json`, which then becomes notd's source of truth. The original Logseq configuration is left unchanged, so an existing graph can be imported safely and subsequently managed by notd on every device.

Previous journal pages appear below today's entry and load progressively while scrolling. Click a journal title to open that date as a single page. When previous-year entries exist and today's journal is empty, its first empty block is shown below the title and task count, followed by the **on this day** timeline. The timeline moves to a collapsible link at the bottom of today's entry as soon as the empty block receives focus. The timeline includes all top-level blocks created on the same month and day in previous years; blocks tagged `#worklog` are excluded. Inline formatting, page references, regular Markdown links, code, quotes, and attachments remain rendered inside the timeline. Timeline blocks with nested content can be expanded in place.

### Journal commands

| Action | Command |
| --- | --- |
| Open today's journal | `⌘/Ctrl + Shift + J` |
| Insert today's journal reference | `/today` |
| Insert yesterday's journal reference | `/yesterday` |
| Insert tomorrow's journal reference | `/tomorrow` |
| Insert a selected journal date | `/date picker` |
| Upload an attachment to `assets/` and insert its Markdown link | `/upload` |
| Previous page | `Alt + ←` |
| Next page | `Alt + →` |

Type `/` inside a graph block to show the inline command menu directly below the block. Journal commands insert `[[page references]]`; the date picker only selects and inserts a date and does not navigate away from the current page.

Type `<` to use structural insertion commands:

| Command | Result |
| --- | --- |
| `<quote` | Inserts an Org-style `#+BEGIN_QUOTE` / `#+END_QUOTE` block and places the caret inside it. |
| `<src` | Inserts a fenced Markdown code block and places the caret inside it. An optional language is supported, for example `<src javascript`. |

## Vim mode

Run **Toggle Vim mode** from the command palette. For an open graph, the setting persists in `.notd/settings.json` and follows the graph across devices.

### Modes

- `i`, `a`, `I`, `A`: enter Insert mode;
- `Esc` or `Ctrl + [`: return to Normal mode;
- `o`, `O`: create a block and enter Insert mode.

### Movement

- `h`, `j`, `k`, `l` or the arrow keys;
- `w`, `b`, `e`: word motions;
- `0`, `^`, `$`: line start, first non-blank character, and line end;
- `gg`, `G`: first and last loaded block;
- `Ctrl + D`, `Ctrl + U`: move rapidly down or up;
- `Enter` in Normal mode: next block.

In the journal feed, `j` and `k` cross journal boundaries. Reaching the end of the loaded journals automatically loads more dates.

### Editing

- `x`, `X`: delete characters;
- `dd`: delete the block;
- `D`: delete to the end of the line;
- `C`: change to the end of the line;
- `r`: replace one character;
- `u`: undo;
- `Ctrl + R`: redo.

Press `?` in Normal mode to open this documentation.

## Navigation

notd keeps page history, including journals, zoom state, and scroll position:

- `Alt + ←`: back;
- `Alt + →`: forward.

The graph name in the top-left corner opens the command palette.

## Data storage and backups

Markdown files remain the authoritative graph data. notd stores graph preferences in `.notd/settings.json`; this includes appearance, shortcuts, Vim mode, recent pages, collapsed blocks, and journal formats. The folder can be included in normal graph backups.

The browser stores recovery drafts, the selected local directory handle, remote offline replicas, and queued synchronization operations in IndexedDB. Standalone documents and their local preferences use browser storage. Clearing site data removes those browser-only copies and permissions, but does not delete Markdown files from a selected graph directory.

Keep regular backups before bulk renames, asset cleanup, or simultaneous editing from multiple applications. Do not treat the offline browser replica as the only backup.

## Saving and conflicts

Changes are saved automatically after a short delay. Before writing to the filesystem, notd stores a recovery draft in IndexedDB.

Possible states include:

- **Modified**;
- **Saving…**;
- **Saved**;
- **Conflict**;
- **Save failed**.

If a file changes externally while local edits are pending, notd does not overwrite it automatically. A manual save lets the user explicitly choose whether to replace the disk version.

## LAN synchronization

When running through `server.py`:

- saves are announced to connected browsers through Server-Sent Events;
- edits made directly by Logseq are detected in about one second;
- pages without pending local changes reload automatically;
- pending local changes produce a conflict instead of being overwritten;
- events contain only the path, change type, and file revision.

## Assets

Use `/upload` inside a graph block to select any file. notd stores it in the graph root’s `assets/` directory, preserves the original name when available, and inserts a Markdown link; images, audio, and video use image Markdown automatically. Audio and video references written with `![](...)` are shown as native players. Trusted iframe embeds from YouTube, Vimeo, Spotify, and SoundCloud are also rendered. If a filename already exists, notd appends `-1`, `-2`, and so on.

```markdown
![Photo](/assets/photo.png)
![Recording](../assets/recording.mp3)
![Video](../assets/video.mp4)
[Report](/assets/report.pdf)
<iframe width="560" height="315" src="https://www.youtube.com/embed/cD2rQM2QP9w" title="YouTube video player" allowfullscreen></iframe>
```

Removing a link or its block does not delete the file. Run **Clean orphaned assets** from the command palette later to review and delete unreferenced uploads. The command displays the candidate filenames and requires confirmation. In LAN mode, assets are served by the graph API.

## Single-document editor

notd also works without a graph:

- `⌘/Ctrl + N`: new document;
- `⌘/Ctrl + O`: open Markdown;
- `⌘/Ctrl + S`: save;
- `⌘/Ctrl + Shift + E`: export HTML;
- `⌘/Ctrl + /`: full Markdown source;
- `⌘/Ctrl + F`: find in the document.

Direct local-file saving requires the File System Access API. Other browsers use `.md` downloads.

## Formatting

| Format | Syntax |
| --- | --- |
| Bold | `**text**` |
| Italic | `*text*` |
| Strikethrough | `~~text~~` |
| Inline code | `` `code` `` |
| Page reference | `[[page]]` |
| Block reference | `((block-id))` |
| Link | `[text](https://example.com)` |
| Image | `![alt](path)` |
| Task | `- [ ] task` |
| Quote | `> text` |
| Code block | Three backticks |

Headings, ordered lists, bullet lists, tables, dividers, frontmatter, and fenced code blocks are also supported.

To wrap selected text directly from the keyboard, type the opening character twice: `~~` creates strikethrough, `[[` creates a page reference, `((` creates a block reference, and `**` or `__` creates bold text. The commands are also available in the command palette.

## Themes

Available themes:

- Light;
- Dark;
- System, which switches automatically when the operating-system preference changes.

For an open graph, the selected theme persists in `.notd/settings.json` and follows the graph across devices.

Fonts and the main colors for the light and dark themes can be customized in `theme-config.css`. This file is loaded after the application stylesheet, so its CSS variables override the defaults without requiring changes to `styles.css`.

## Troubleshooting

### Old name or interface still appears

The installed PWA may still be displaying an obsolete cached shell. Open the site while online, reload it, close the PWA completely, and reopen it. On iOS, reinstall the Home Screen app when its displayed name or icon does not update.

### Pages, suggestions, or linked references are duplicated

Check the graph for accidentally nested copies such as `pages/pages/` or `journals/journals/`. notd ignores these common import mistakes, but removing the duplicate directories avoids confusion in Logseq and other tools. Run **Sync all notes and backlinks** after fixing files externally.

### Mobile shortcut toolbar is missing

The indentation, movement, undo/redo, `[[ ]]`, and `(( ))` toolbar appears while editing a graph block on a touch device. In the installed PWA it is positioned above the software keyboard. Close and reopen the current block after rotating the device or reconnecting a hardware keyboard.

### Local graph does not reopen

Browser directory permission may have expired. Run **Open local graph** again and select the same graph directory. Clearing browser site data also clears the remembered directory handle.

### Offline changes do not synchronize

Open the PWA while connected and keep it in the foreground. iOS does not provide reliable background synchronization for PWAs. Check the footer for pending operations; a conflict requires reviewing the server and local versions rather than silently overwriting either one.

### Documentation appears outdated

Documentation is fetched without using the browser HTTP cache. Restart the PWA to activate the newest Service Worker if this guide still differs from the deployed `DOCUMENTATION.md` file.

## Privacy and security

In local mode, content is not sent to external services. In LAN mode, content is exchanged only with the configured notd server.

The LAN server:

- currently has no application authentication and is limited to trusted networks;
- rejects cross-origin browser writes and does not enable CORS;
- exposes only allowlisted application files and restricts graph access to the configured directory;
- blocks graph symlinks from bulk scans, limits uploads and note sizes, and serves unsafe attachments as downloads;
- uses atomic writes and restrictive browser security headers;
- must still use HTTPS through a reverse proxy before internet exposure.

Back up the graph regularly, especially before bulk renames or concurrent editing from multiple applications.

## Logseq compatibility

notd preserves the essential Logseq Markdown structure: pages, journals, nested blocks, properties, page references, block references, aliases, tags, and assets.

Logseq-specific features such as plugins, advanced queries, whiteboards, PDF annotation, and proprietary sync are not executed. Unknown syntax is retained in Markdown whenever possible.
