const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveRepositoryState } = require('../../dist/main/gitAdapter.js');

test('deriveRepositoryState detects fully empty repository state', () => {
  const state = deriveRepositoryState({
    repositoryPath: '/tmp/repo',
    trackedFilesRaw: '',
    statusPorcelainRaw: '',
    hasCommits: false
  });

  assert.deepEqual(state, {
    repositoryPath: '/tmp/repo',
    hasCommits: false,
    trackedFileCount: 0,
    untrackedFileCount: 0,
    isEmpty: true
  });
});

test('deriveRepositoryState counts tracked and untracked files', () => {
  const state = deriveRepositoryState({
    repositoryPath: '/tmp/repo',
    trackedFilesRaw: 'README.md\nsrc/app.ts\n',
    statusPorcelainRaw: '?? notes.md\n M src/app.ts\n',
    hasCommits: true
  });

  assert.deepEqual(state, {
    repositoryPath: '/tmp/repo',
    hasCommits: true,
    trackedFileCount: 2,
    untrackedFileCount: 1,
    isEmpty: false
  });
});

test('deriveRepositoryState handles duplicates and whitespace lines', () => {
  const state = deriveRepositoryState({
    repositoryPath: '/tmp/repo',
    trackedFilesRaw: 'README.md\nREADME.md\n\n',
    statusPorcelainRaw: '\n?? draft.md\n',
    hasCommits: false
  });

  assert.equal(state.trackedFileCount, 1);
  assert.equal(state.untrackedFileCount, 1);
  assert.equal(state.isEmpty, false);
});
