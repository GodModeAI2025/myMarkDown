const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCodeowners, resolveHintForPath } = require('../../dist/main/codeownersService.js');

test('parseCodeowners and resolveHintForPath apply last-match-wins', () => {
  const rules = parseCodeowners(`
# global markdown owner
*.md @team/general
/docs/** @team/docs
/docs/special.md @team/special
`);

  const special = resolveHintForPath('docs/special.md', rules);
  assert.deepEqual(special.owners, ['@team/special']);
  assert.equal(special.matchedPattern, '/docs/special.md');

  const docsGeneric = resolveHintForPath('docs/guide.md', rules);
  assert.deepEqual(docsGeneric.owners, ['@team/docs']);
  assert.equal(docsGeneric.matchedPattern, '/docs/**');

  const otherMarkdown = resolveHintForPath('notes/todo.md', rules);
  assert.deepEqual(otherMarkdown.owners, ['@team/general']);
  assert.equal(otherMarkdown.matchedPattern, '*.md');
});

test('parseCodeowners ignores invalid lines without owners', () => {
  const rules = parseCodeowners(`
/docs/**
!ignored @nobody
# comment only
`);

  const hint = resolveHintForPath('docs/page.md', rules);
  assert.deepEqual(hint.owners, []);
  assert.equal(hint.matchedPattern, null);
});
