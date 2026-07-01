import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative } from "path";

/**
 * A checkpoint captures the pre-edit content of every file touched by tool
 * calls during one user turn. Restoring writes those pre-images back (or
 * deletes the file if it didn't exist before the turn). This mirrors how
 * Claude Code snapshots code: per tool-touched file, independent of git.
 */
export interface Checkpoint {
  prompt: string;
  timestamp: number;
  /** Absolute file path -> content before this turn's edits, or null if the file didn't exist yet. */
  files: Map<string, string | null>;
}

export type CheckpointMap = Map<string, Checkpoint>;

/** Files captured so far during the turn in progress, keyed by absolute path. */
export type PendingSnapshot = Map<string, string | null>;

function resolvePath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(cwd, filePath);
}

function readFileOrNull(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Record a file's pre-edit content the first time it's touched during a turn.
 * Subsequent touches to the same file within the same turn are no-ops, so the
 * snapshot always reflects the state before the turn started, not before the
 * most recent edit.
 */
export function captureFileBeforeChange(
  pending: PendingSnapshot,
  cwd: string,
  filePath: string,
): void {
  const absPath = resolvePath(cwd, filePath);
  if (pending.has(absPath)) return;
  pending.set(absPath, readFileOrNull(absPath));
}

/**
 * Turn the pending snapshot into a checkpoint and reset it for the next turn.
 * Returns null if no files were touched this turn.
 */
export function finalizeCheckpoint(pending: PendingSnapshot, prompt: string): Checkpoint | null {
  if (pending.size === 0) return null;

  const checkpoint: Checkpoint = {
    prompt: prompt.slice(0, 100), // Truncate for display
    timestamp: Date.now(),
    files: new Map(pending),
  };
  pending.clear();
  return checkpoint;
}

/**
 * Snapshot the current content of a fixed set of files, e.g. to remember
 * "state right before we overwrote these" so a later undo can restore it.
 */
export function snapshotPaths(paths: Iterable<string>): PendingSnapshot {
  const files: PendingSnapshot = new Map();
  for (const absPath of paths) {
    files.set(absPath, readFileOrNull(absPath));
  }
  return files;
}

/**
 * Restore every file captured in the checkpoint to its pre-turn state.
 */
export function restoreCheckpoint(checkpoint: Checkpoint): void {
  for (const [absPath, content] of checkpoint.files) {
    if (content === null) {
      if (existsSync(absPath)) unlinkSync(absPath);
    } else {
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, "utf8");
    }
  }
}

/**
 * Compare current file state against a checkpoint's pre-images, for preview.
 * "added" = file didn't exist before the turn but does now (restore deletes it).
 * "deleted" = file existed before the turn but doesn't now (restore recreates it).
 * "modified" = file existed both times with different content.
 */
export function getDiffFiles(
  cwd: string,
  checkpoint: Checkpoint,
): { added: string[]; modified: string[]; deleted: string[] } {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [absPath, preImage] of checkpoint.files) {
    const current = readFileOrNull(absPath);
    const label = relative(cwd, absPath) || absPath;

    if (preImage === null && current !== null) added.push(label);
    else if (preImage !== null && current === null) deleted.push(label);
    else if (preImage !== current) modified.push(label);
  }

  return { added, modified, deleted };
}
