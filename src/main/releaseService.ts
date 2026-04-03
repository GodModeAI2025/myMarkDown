import type { ReleaseGateStatus, ReleaseScope, ReleaseVersionInput, ReleaseVersionResult } from '../shared/contracts';
import { createAnnotatedTag, ensureWorkingTreeClean, pushTag } from './gitAdapter';
import { getComments, getOpenCommentCount, validateNoInlineComments } from './commentsService';

function normalizeScopePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))];
}

export async function canReleaseVersion(scope: ReleaseScope): Promise<ReleaseGateStatus> {
  const scopedPaths = normalizeScopePaths(scope.paths);
  if (scopedPaths.length === 0) {
    return {
      releasable: false,
      openComments: 0,
      blockingCommentIds: []
    };
  }

  const [commentCounts, comments] = await Promise.all([
    getOpenCommentCount({ paths: scopedPaths }),
    getComments({ paths: scopedPaths })
  ]);

  const blockingCommentIds = comments.filter((comment) => comment.state === 'open').map((comment) => comment.id);

  return {
    releasable: commentCounts.openComments === 0,
    openComments: commentCounts.openComments,
    blockingCommentIds
  };
}

export async function releaseVersion(input: ReleaseVersionInput): Promise<ReleaseVersionResult> {
  const scopedPaths = normalizeScopePaths(input.paths);
  if (scopedPaths.length === 0) {
    throw new Error('Release scope must contain at least one file path.');
  }

  await ensureWorkingTreeClean();

  const inlineChecks = await Promise.all(scopedPaths.map((targetPath) => validateNoInlineComments(targetPath)));
  if (inlineChecks.some((isValid) => !isValid)) {
    throw new Error('Release blocked: inline comments were detected in markdown content.');
  }

  const gate = await canReleaseVersion({
    targetRef: input.targetRef,
    paths: scopedPaths,
    releaseId: input.releaseId
  });

  if (!gate.releasable) {
    throw new Error(`Release blocked: ${gate.openComments} open comment(s) in scope.`);
  }

  const tagName = input.releaseId.trim();
  if (!tagName) {
    throw new Error('Release ID cannot be empty.');
  }

  await createAnnotatedTag(tagName, input.targetRef, `Release ${tagName}`);

  let pushed = false;
  if (input.pushTag) {
    await pushTag(tagName, input.remote || 'origin');
    pushed = true;
  }

  return {
    tag: tagName,
    targetRef: input.targetRef,
    pushed
  };
}
