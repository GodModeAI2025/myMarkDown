import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  FileContentResult,
  MarkdownFileEntry,
  MarkdownSearchInput,
  MarkdownSearchResult,
  SaveFileInput
} from '../shared/contracts';
import { getOpenRepositoryPath } from './gitAdapter';
import { ensurePathInsideRepo, toPosixPath } from './pathUtils';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist']);
const DEFAULT_MAX_SEARCH_RESULTS = 120;

async function walkMarkdownFiles(rootDir: string, currentDir: string, output: string[]): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      await walkMarkdownFiles(rootDir, absolutePath, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.toLowerCase().endsWith('.md')) {
      continue;
    }

    const relativePath = path.relative(rootDir, absolutePath);
    output.push(toPosixPath(relativePath));
  }
}

export async function listMarkdownFiles(): Promise<MarkdownFileEntry[]> {
  const repositoryPath = getOpenRepositoryPath();
  const files: string[] = [];

  await walkMarkdownFiles(repositoryPath, repositoryPath, files);

  return files
    .sort((a, b) => a.localeCompare(b))
    .map((filePath) => ({
      path: filePath
    }));
}

export async function readMarkdownFile(targetPath: string): Promise<FileContentResult> {
  const repositoryPath = getOpenRepositoryPath();
  const absolutePath = ensurePathInsideRepo(repositoryPath, targetPath);

  const content = await readFile(absolutePath, 'utf8');
  return {
    path: toPosixPath(targetPath),
    content
  };
}

export async function writeMarkdownFile(input: SaveFileInput): Promise<FileContentResult> {
  const repositoryPath = getOpenRepositoryPath();
  const absolutePath = ensurePathInsideRepo(repositoryPath, input.path);

  if (!absolutePath.toLowerCase().endsWith('.md')) {
    throw new Error('Only markdown files (*.md) can be saved in the editor.');
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.content, 'utf8');

  return {
    path: toPosixPath(input.path),
    content: input.content
  };
}

export async function searchMarkdown(input: MarkdownSearchInput): Promise<MarkdownSearchResult> {
  const query = input.query.trim();
  if (!query) {
    throw new Error('Search query cannot be empty.');
  }

  const maxResults = Math.max(1, Math.min(input.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS, 500));
  const queryLower = query.toLowerCase();
  const files = await listMarkdownFiles();
  const items: MarkdownSearchResult['items'] = [];
  let totalMatches = 0;

  for (const file of files) {
    const fileContent = await readMarkdownFile(file.path);
    const lines = fileContent.content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.toLowerCase().includes(queryLower)) {
        continue;
      }

      totalMatches += 1;

      if (items.length < maxResults) {
        items.push({
          path: file.path,
          line: index + 1,
          excerpt: line.trim().slice(0, 220)
        });
      }
    }
  }

  return {
    query,
    totalMatches,
    truncated: totalMatches > items.length,
    items
  };
}
