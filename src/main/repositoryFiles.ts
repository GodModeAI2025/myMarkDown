import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type {
  BootstrapProjectResult,
  FileContentResult,
  MarkdownFileEntry,
  MarkdownSearchInput,
  MarkdownSearchResult,
  RepositoryState,
  SaveFileInput
} from '../shared/contracts';
import { getOpenRepositoryPath, inspectRepositoryState } from './gitAdapter';
import { ensurePathInsideRepo, toPosixPath } from './pathUtils';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist']);
const DEFAULT_MAX_SEARCH_RESULTS = 120;

const DEFAULT_BOOTSTRAP_FILES: Array<{ path: string; content: string }> = [
  {
    path: 'README.md',
    content: '# myMarkDown Workspace\n\nStart writing your project documentation with Git as the source of truth.\n'
  },
  {
    path: 'docs/getting-started.md',
    content:
      '# Getting Started\n\nThis repository was initialized by myMarkDown.\n\n- Add project folders under `projects/`\n- Keep documentation in markdown files\n- Use comments sidecars under `.comments/`\n'
  },
  { path: 'projects/.gitkeep', content: '' },
  { path: '.comments/.gitkeep', content: '' },
  { path: 'archive/.gitkeep', content: '' }
];

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

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

export async function getRepositoryState(): Promise<RepositoryState> {
  return inspectRepositoryState();
}

export async function bootstrapProjectStructureIfEmpty(): Promise<BootstrapProjectResult> {
  const repositoryState = await inspectRepositoryState();
  if (!repositoryState.isEmpty) {
    return {
      skipped: true,
      reason: 'repository-not-empty',
      createdDirectories: [],
      createdFiles: []
    };
  }

  const repositoryPath = getOpenRepositoryPath();
  const createdDirectories = new Set<string>();
  const createdFiles: string[] = [];

  for (const template of DEFAULT_BOOTSTRAP_FILES) {
    const normalizedTargetPath = toPosixPath(template.path);
    const absoluteTargetPath = ensurePathInsideRepo(repositoryPath, normalizedTargetPath);
    const absoluteDirectory = path.dirname(absoluteTargetPath);

    const directoryAlreadyExisted = await pathExists(absoluteDirectory);
    await mkdir(absoluteDirectory, { recursive: true });
    if (!directoryAlreadyExisted) {
      createdDirectories.add(toPosixPath(path.relative(repositoryPath, absoluteDirectory)));
    }

    const fileAlreadyExists = await pathExists(absoluteTargetPath);
    if (fileAlreadyExists) {
      continue;
    }

    const fileContent = template.content.length > 0 ? template.content : '';
    const finalContent = fileContent.length > 0 && !fileContent.endsWith('\n') ? `${fileContent}\n` : fileContent;
    await writeFile(absoluteTargetPath, finalContent, 'utf8');
    createdFiles.push(normalizedTargetPath);
  }

  return {
    skipped: false,
    createdDirectories: [...createdDirectories].filter((entry) => entry.length > 0).sort((a, b) => a.localeCompare(b)),
    createdFiles: createdFiles.sort((a, b) => a.localeCompare(b))
  };
}
