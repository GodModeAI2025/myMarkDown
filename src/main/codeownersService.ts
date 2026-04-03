import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { CodeOwnerHint, CodeOwnerHintsResult } from '../shared/contracts';
import { getOpenRepositoryPath } from './gitAdapter';
import { toPosixPath } from './pathUtils';

type CodeownersRule = {
  pattern: string;
  owners: string[];
  sourceLine: number;
  matcher: (targetPath: string) => boolean;
};

const CANDIDATE_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

async function resolveCodeownersPath(repositoryPath: string): Promise<string | null> {
  for (const candidate of CANDIDATE_PATHS) {
    const absolutePath = path.join(repositoryPath, candidate);
    try {
      await access(absolutePath, constants.R_OK);
      return absolutePath;
    } catch {
      // Continue.
    }
  }

  return null;
}

function tokenizeLine(input: string): string[] {
  const tokens = input.match(/(?:\\ |\S)+/g) ?? [];
  return tokens.map((token) => token.replace(/\\ /g, ' '));
}

function escapeRegexChar(input: string): string {
  return /[|\\{}()[\]^$+?.]/.test(input) ? `\\${input}` : input;
}

function compilePattern(pattern: string): (targetPath: string) => boolean {
  let normalized = toPosixPath(pattern.trim());

  if (!normalized || normalized === '#') {
    return () => false;
  }

  if (normalized.endsWith('/')) {
    normalized = `${normalized}**`;
  }

  const isRootAnchored = normalized.startsWith('/');
  if (isRootAnchored) {
    normalized = normalized.slice(1);
  }

  let globRegex = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (char === '*') {
      const next = normalized[index + 1];
      if (next === '*') {
        globRegex += '.*';
        index += 1;
      } else {
        globRegex += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      globRegex += '[^/]';
      continue;
    }

    globRegex += escapeRegexChar(char);
  }

  const prefix = isRootAnchored ? '^' : '^(?:|.*/)';
  const regex = new RegExp(`${prefix}${globRegex}$`);

  return (targetPath: string) => regex.test(toPosixPath(targetPath));
}

export function parseCodeowners(content: string): CodeownersRule[] {
  const lines = content.split(/\r?\n/);
  const rules: CodeownersRule[] = [];

  lines.forEach((line, index) => {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) {
      return;
    }

    const tokens = tokenizeLine(stripped);
    if (tokens.length < 2) {
      return;
    }

    const pattern = tokens[0];
    if (!pattern || pattern.startsWith('!')) {
      return;
    }

    const owners = tokens.slice(1).filter((token) => token.startsWith('@') || token.includes('@'));
    if (owners.length === 0) {
      return;
    }

    rules.push({
      pattern,
      owners,
      sourceLine: index + 1,
      matcher: compilePattern(pattern)
    });
  });

  return rules;
}

export function resolveHintForPath(targetPath: string, rules: CodeownersRule[]): CodeOwnerHint {
  const normalizedPath = toPosixPath(targetPath);
  let matchedRule: CodeownersRule | null = null;

  for (const rule of rules) {
    if (rule.matcher(normalizedPath)) {
      matchedRule = rule;
    }
  }

  return {
    path: normalizedPath,
    owners: matchedRule?.owners ?? [],
    matchedPattern: matchedRule?.pattern ?? null,
    sourceLine: matchedRule?.sourceLine ?? null
  };
}

export async function getCodeOwnerHints(paths: string[]): Promise<CodeOwnerHintsResult> {
  const repositoryPath = getOpenRepositoryPath();
  const codeownersAbsolutePath = await resolveCodeownersPath(repositoryPath);

  const normalizedPaths = [...new Set(paths.map((item) => toPosixPath(item.trim())).filter(Boolean))];

  if (!codeownersAbsolutePath) {
    return {
      hasCodeownersFile: false,
      codeownersPath: null,
      hints: normalizedPaths.map((targetPath) => ({
        path: targetPath,
        owners: [],
        matchedPattern: null,
        sourceLine: null
      }))
    };
  }

  const codeownersContent = await readFile(codeownersAbsolutePath, 'utf8');
  const rules = parseCodeowners(codeownersContent);

  const relativeCodeownersPath = toPosixPath(path.relative(repositoryPath, codeownersAbsolutePath));

  return {
    hasCodeownersFile: true,
    codeownersPath: relativeCodeownersPath,
    hints: normalizedPaths.map((targetPath) => resolveHintForPath(targetPath, rules))
  };
}
