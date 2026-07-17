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

test('updates page references without changing aliases', () => {
  const content = '- [[Old page]] and [[Old page|label]] and [[Other]]';
  assert.equal(
    Graph.replacePageReferences(content, 'Old page', 'New page'),
    '- [[New page]] and [[New page|label]] and [[Other]]'
  );
});
