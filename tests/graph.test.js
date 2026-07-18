const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const context = { crypto: webcrypto };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../graph.js', `file://${__filename}`), 'utf8'), context);
const Graph = context.MarkdGraph;

test('parses and serializes nested Logseq blocks', () => {
  const markdown = 'title:: Project\n\n- parent [[Other]]\n  id:: abcdefgh-1234\n  - child\n- TODO next\n';
  const document = Graph.parseDocument(markdown);

  assert.equal(document.preamble[0], 'title:: Project');
  assert.equal(document.blocks.length, 2);
  assert.equal(document.blocks[0].id, 'abcdefgh-1234');
  assert.equal(document.blocks[0].children[0].content, 'child');
  assert.equal(Graph.serializeDocument(document), markdown);
});

test('preserves Logseq task markers and scheduling metadata', () => {
  const markdown = '- TODO Prepare release\n  SCHEDULED: <2026-07-18 Sat>\n- NOW Review changes\n  DEADLINE: <2026-07-20 Mon>\n- DONE Publish\n';
  const document = Graph.parseDocument(markdown);

  assert.equal(document.blocks[0].content, 'TODO Prepare release\nSCHEDULED: <2026-07-18 Sat>');
  assert.equal(document.blocks[1].content, 'NOW Review changes\nDEADLINE: <2026-07-20 Mon>');
  assert.equal(document.blocks[2].content, 'DONE Publish');
  assert.equal(Graph.serializeDocument(document), markdown);
});

test('keeps fenced code inside a single graph block', () => {
  const markdown = '- ```bash\n  echo "hello"\n  - this is code, not a child block\n  ```\n- next block\n';
  const document = Graph.parseDocument(markdown);

  assert.equal(document.blocks.length, 2);
  assert.equal(document.blocks[0].children.length, 0);
  assert.equal(document.blocks[0].content, '```bash\necho "hello"\n- this is code, not a child block\n```');
  assert.equal(Graph.serializeDocument(document), markdown);
});

test('keeps fenced code nested after text inside a graph block', () => {
  const markdown = '- real IP on access.log\n  ```bash\n  LogFormat "%{X-Forwarded-For}i" combined\n  - shell content\n  ```\n- next block\n';
  const document = Graph.parseDocument(markdown);

  assert.equal(document.blocks.length, 2);
  assert.equal(document.blocks[0].children.length, 0);
  assert.match(document.blocks[0].content, /real IP[\s\S]*```bash[\s\S]*LogFormat/);
  assert.equal(Graph.serializeDocument(document), markdown);
});

test('keeps Org quote contents inside a single graph block', () => {
  const markdown = '- #+BEGIN_QUOTE\n  quoted text\n  - quoted bullet\n  #+END_QUOTE\n- next block\n';
  const document = Graph.parseDocument(markdown);

  assert.equal(document.blocks.length, 2);
  assert.equal(document.blocks[0].children.length, 0);
  assert.match(document.blocks[0].content, /#\+BEGIN_QUOTE[\s\S]*quoted bullet[\s\S]*#\+END_QUOTE/);
  assert.equal(Graph.serializeDocument(document), markdown);
});

test('indexes page and block references', () => {
  const pages = [
    { title: 'Source', path: 'pages/source.md', content: '- See [[Alias]] and ((12345678-abcd))\n' },
    { title: 'Target', path: 'pages/target.md', content: 'alias:: [[Alias]]\n\n- Referenced\n  id:: 12345678-abcd\n' }
  ];
  const index = new Graph.GraphIndex(pages);

  assert.equal(index.referencesToPage('target').length, 1);
  assert.equal(index.resolveBlock('12345678-abcd').page.title, 'Target');
  assert.equal(index.search('referenced').length, 1);
});

test('indexes namespaced page links and tags', () => {
  const pages = [
    { title: 'Source', path: 'pages/source.md', content: '- [[persone/nome]]\n- #persone/nome\n' },
    { title: 'nome', name: 'persone___nome.md', path: 'pages/persone___nome.md', content: '- Profile\n' }
  ];
  const index = new Graph.GraphIndex(pages);
  assert.equal(index.referencesToPage('persone/nome').length, 2);
  assert.equal(index.referencesToPage('nome').length, 2);
  assert.equal(index.resolvePage('persone___nome').title, 'nome');
  assert.equal(index.resolvePage('persone%2Fnome').title, 'nome');
  assert.equal(Graph.pageTitle('title:: nome', 'persone___nome.md'), 'persone/nome');
});

test('resolves graph assets relative to the page folder', () => {
  assert.equal(Graph.resolveAssetPath('../assets/immagine.jpg', 'pages'), 'assets/immagine.jpg');
  assert.equal(Graph.resolveAssetPath('../assets/My%20image.jpg', 'journals'), 'assets/My image.jpg');
  assert.equal(Graph.resolveAssetPath('./images/image.jpg', 'pages/nested'), 'pages/nested/images/image.jpg');
});

test('uses Logseq-compatible journal date formats', () => {
  const date = new Date(2026, 6, 17);
  assert.equal(Graph.formatJournalDate(date, 'yyyy_MM_dd'), '2026_07_17');
  assert.equal(Graph.formatJournalDate(date, 'MMM do, yyyy'), 'Jul 17th, 2026');
  const parsed = Graph.parseJournalDate('2026_07_17.md', 'yyyy_MM_dd');
  assert.deepEqual([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()], [2026, 6, 17]);
  const index = new Graph.GraphIndex([{ title: 'Jul 17th, 2026', path: 'journals/2026_07_17.md', journal: true, journalDate: '2026-07-17', content: '- entry' }]);
  assert.equal(index.resolvePage('2026_07_17').title, 'Jul 17th, 2026');
});

test('updates page references without changing aliases', () => {
  const content = '- [[Old page]] and [[Old page|label]] and [[Other]]';
  assert.equal(
    Graph.replacePageReferences(content, 'Old page', 'New page'),
    '- [[New page]] and [[New page|label]] and [[Other]]'
  );
});
