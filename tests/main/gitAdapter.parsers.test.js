const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBranchLine, parseStatusEntries } = require('../../dist/main/gitAdapter.js');

test('parseBranchLine parses tracking information', () => {
  const parsed = parseBranchLine('## main...origin/main [ahead 2, behind 1]');
  assert.deepEqual(parsed, {
    branch: 'main',
    trackingBranch: 'origin/main',
    ahead: 2,
    behind: 1
  });
});

test('parseBranchLine handles no-commit branch', () => {
  const parsed = parseBranchLine('## No commits yet on feature/docs');
  assert.deepEqual(parsed, {
    branch: 'feature/docs',
    trackingBranch: null,
    ahead: 0,
    behind: 0
  });
});

test('parseStatusEntries parses file states, rename and conflicts', () => {
  const parsed = parseStatusEntries([
    '?? docs/new-file.md',
    'M  docs/edited.md',
    'R  docs/old-name.md -> docs/new-name.md',
    'UU docs/conflict.md'
  ]);

  assert.equal(parsed.length, 4);

  assert.deepEqual(parsed[0], {
    path: 'docs/new-file.md',
    indexStatus: '?',
    workTreeStatus: '?'
  });

  assert.deepEqual(parsed[1], {
    path: 'docs/edited.md',
    indexStatus: 'M',
    workTreeStatus: ' '
  });

  assert.deepEqual(parsed[2], {
    path: 'docs/new-name.md',
    originalPath: 'docs/old-name.md',
    indexStatus: 'R',
    workTreeStatus: ' '
  });

  assert.deepEqual(parsed[3], {
    path: 'docs/conflict.md',
    indexStatus: 'U',
    workTreeStatus: 'U'
  });
});
