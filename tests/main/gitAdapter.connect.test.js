const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAuthenticatedRemoteUrl, maskCredentialString } = require('../../dist/main/gitAdapter.js');

test('maskCredentialString redacts https password section', () => {
  const masked = maskCredentialString('https://git:super-secret-token@github.com/org/repo.git');
  assert.equal(masked, 'https://git:***@github.com/org/repo.git');
});

test('maskCredentialString leaves non-credential strings unchanged', () => {
  const value = 'fatal: repository not found';
  assert.equal(maskCredentialString(value), value);
});

test('buildAuthenticatedRemoteUrl keeps URL unchanged for system auth mode', () => {
  const url = 'https://github.com/org/repo.git';
  const result = buildAuthenticatedRemoteUrl(url, { mode: 'system' });
  assert.equal(result, url);
});

test('buildAuthenticatedRemoteUrl injects username/token for https-token mode', () => {
  const result = buildAuthenticatedRemoteUrl('https://github.com/org/repo.git', {
    mode: 'https-token',
    username: 'alice',
    token: 'abc123'
  });

  assert.equal(result, 'https://alice:abc123@github.com/org/repo.git');
});

test('buildAuthenticatedRemoteUrl rejects non-https URL with token auth', () => {
  assert.throws(
    () =>
      buildAuthenticatedRemoteUrl('ssh://git@github.com/org/repo.git', {
        mode: 'https-token',
        username: 'alice',
        token: 'abc123'
      }),
    /Token authentication requires an HTTPS remote URL/
  );
});
