# markd — Documentation

markd is a local Markdown editor, block outliner, and graph reader compatible with the essential Logseq file structure. Markdown files remain the source of truth; markd does not introduce a proprietary data format.

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

## Command palette

Open the command palette with:

- `⌘/Ctrl + K`;
- `⌘/Ctrl + Shift + P`;
- `F1`;
- `:` in Vim Normal mode.

Use the palette to find pages and blocks, change themes, open files, navigate journals, format content, manage graph maintenance, and open this documentation.

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

markd reads `.md` and `.markdown` files from the graph root, `pages/`, and `journals/`. It recognizes page titles, aliases, properties, page references, block UUIDs, and journal dates. Logseq `key:: value` properties—including custom fields such as `company::` and `name::`—remain preserved in Markdown source but are hidden from the formatted page when they have no visual representation.

### Open a page

Open the command palette and search for its title. Global search also includes block content. Selecting a block result opens it directly.

### Create a page

Type `[[`. markd immediately inserts `]]` and leaves the caret between the brackets:

```text
[[|]]
```

Enter a title. If the page does not exist, choose **Create page** and press `Enter`. The reference is completed, the page is created, and focus moves to the next block.

### Rename a page

Use **Rename document** or `F2`. markd can update matching `[[...]]` references throughout the graph. Journal pages cannot be renamed, preserving Logseq compatibility.

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
| Cycle the task state | `⌘/Ctrl + Enter` |
| Collapse or expand children | Arrow beside the bullet |
| Zoom into a block | Click the bullet |

Editing does not add a border or background to the selected block.

## Tasks

`⌘/Ctrl + Enter` cycles through:

```text
TODO → DOING → DONE → plain text
```

The task state can also be clicked directly.

## References

### Page references

```text
[[Page name]]
[[Page name|Label]]
#tag
```

Click a reference to open its page. A missing page opens as a virtual page so its backlinks can be viewed; a Markdown file is created only after you edit it.

### Block references

Select a block and run **Copy block reference**. When required, markd adds:

```text
id:: UUID
```

The copied reference has this form:

```text
((UUID))
```

### Linked references

Single pages show references grouped by source page. The source title and all matching blocks share one card. Unlinked references are available on demand, while block references are shown when a referenced block is zoomed.

## Journals

Opening a graph displays today's journal. If its file does not exist, markd creates it automatically.

The default filename is:

```text
journals/yyyy_MM_dd.md
```

markd reads these settings from `logseq/config.edn`:

```clojure
:journal/file-name-format
:journal/page-title-format
```

Previous journal pages appear below today's entry and load progressively while scrolling. Click a journal title to open that date as a single page.

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

Run **Toggle Vim mode** from the command palette. The setting persists in the browser.

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

markd keeps page history, including journals, zoom state, and scroll position:

- `Alt + ←`: back;
- `Alt + →`: forward.

The graph name in the top-left corner opens the command palette.

## Saving and conflicts

Changes are saved automatically after a short delay. Before writing to the filesystem, markd stores a recovery draft in IndexedDB.

Possible states include:

- **Modified**;
- **Saving…**;
- **Saved**;
- **Conflict**;
- **Save failed**.

If a file changes externally while local edits are pending, markd does not overwrite it automatically. A manual save lets the user explicitly choose whether to replace the disk version.

## LAN synchronization

When running through `server.py`:

- saves are announced to connected browsers through Server-Sent Events;
- edits made directly by Logseq are detected in about one second;
- pages without pending local changes reload automatically;
- pending local changes produce a conflict instead of being overwritten;
- events contain only the path, change type, and file revision.

## Assets

Use `/upload` inside a graph block to select any file. markd stores it in the graph root’s `assets/` directory, preserves the original name when available, and inserts a Markdown link; images use image Markdown automatically. If a filename already exists, markd appends `-1`, `-2`, and so on.

```markdown
![Photo](/assets/photo.png)
[Report](/assets/report.pdf)
```

Removing a link or its block does not delete the file. Run **Clean orphaned assets** from the command palette later to review and delete unreferenced uploads. The command displays the candidate filenames and requires confirmation. In LAN mode, assets are served by the graph API.

## Single-document editor

markd also works without a graph:

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
- Sepia;
- Dark.

The selected theme persists in the browser.

Fonts and the main colors for all three themes can be customized in `theme-config.css`. This file is loaded after the application stylesheet, so its CSS variables override the defaults without requiring changes to `styles.css`.

## Privacy and security

In local mode, content is not sent to external services. In LAN mode, content is exchanged only with the configured markd server.

The LAN server:

- currently has no application authentication and is limited to trusted networks;
- rejects cross-origin browser writes and does not enable CORS;
- exposes only allowlisted application files and restricts graph access to the configured directory;
- blocks graph symlinks from bulk scans, limits uploads and note sizes, and serves unsafe attachments as downloads;
- uses atomic writes and restrictive browser security headers;
- must still use HTTPS through a reverse proxy before internet exposure.

Back up the graph regularly, especially before bulk renames or concurrent editing from multiple applications.

## Logseq compatibility

markd preserves the essential Logseq Markdown structure: pages, journals, nested blocks, properties, page references, block references, aliases, tags, and assets.

Logseq-specific features such as plugins, advanced queries, whiteboards, PDF annotation, and proprietary sync are not executed. Unknown syntax is retained in Markdown whenever possible.
