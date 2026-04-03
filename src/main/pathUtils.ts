import path from 'node:path';

export function toPosixPath(input: string): string {
  return input.split(path.sep).join('/');
}

export function ensurePathInsideRepo(repositoryPath: string, relativePath: string): string {
  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error('Path cannot be empty.');
  }

  const resolved = path.resolve(repositoryPath, trimmed);
  if (resolved === repositoryPath) {
    throw new Error('Path must reference a file inside the repository.');
  }

  const repoPrefix = repositoryPath.endsWith(path.sep) ? repositoryPath : `${repositoryPath}${path.sep}`;
  if (!resolved.startsWith(repoPrefix)) {
    throw new Error('Path traversal outside repository is not allowed.');
  }

  return resolved;
}
