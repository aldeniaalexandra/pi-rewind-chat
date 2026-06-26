import { spawn } from "child_process";

export interface Checkpoint {
  stashSha: string;
  prompt: string;
  timestamp: number;
  filesChanged: number;
}

export type CheckpointMap = Map<string, Checkpoint>;

/**
 * Run a git command and return stdout.
 */
export function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

/**
 * Check if cwd is inside a git repository.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git stash checkpoint of the current working tree.
 * Returns the stash SHA, or null if working tree is clean.
 */
export async function createCheckpoint(
  cwd: string,
  entryId: string,
  prompt: string,
): Promise<Checkpoint | null> {
  // Check if there are any changes to stash
  const status = await git(["status", "--porcelain"], cwd);
  if (!status.trim()) {
    return null; // Clean working tree, no checkpoint needed
  }

  // Create stash with untracked files
  const stashResult = await git(
    ["stash", "create", "-m", `pi-rewind-chat:${entryId}`],
    cwd,
  );

  if (!stashResult) {
    return null;
  }

  // Count changed files
  const filesChanged = status.trim().split("\n").length;

  return {
    stashSha: stashResult,
    prompt: prompt.slice(0, 100), // Truncate for display
    timestamp: Date.now(),
    filesChanged,
  };
}

/**
 * Restore working tree to a checkpoint.
 * Uses git checkout to restore files from the stash SHA.
 */
export async function restoreCheckpoint(
  cwd: string,
  checkpoint: Checkpoint,
): Promise<void> {
  // Reset working tree to clean state first
  await git(["checkout", "--", "."], cwd);

  // Remove untracked files that were added after checkpoint
  await git(["clean", "-fd"], cwd);

  // Apply the stash
  try {
    await git(["stash", "apply", checkpoint.stashSha], cwd);
  } catch {
    // If stash apply fails, try direct checkout from SHA
    await git(["checkout", checkpoint.stashSha, "--", "."], cwd);
  }
}

/**
 * Get list of changed files between current state and a checkpoint.
 */
export async function getDiffFiles(
  cwd: string,
  checkpoint: Checkpoint,
): Promise<{ added: string[]; modified: string[]; deleted: string[] }> {
  try {
    const diff = await git(
      ["diff", "--name-status", checkpoint.stashSha, "HEAD"],
      cwd,
    );

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const line of diff.split("\n")) {
      if (!line.trim()) continue;
      const [status, file] = line.split("\t");
      if (status === "A") added.push(file);
      else if (status === "M") modified.push(file);
      else if (status === "D") deleted.push(file);
    }

    return { added, modified, deleted };
  } catch {
    return { added: [], modified: [], deleted: [] };
  }
}

/**
 * Serialize checkpoint map to JSON-compatible object.
 */
export function serializeCheckpoints(map: CheckpointMap): Record<string, Checkpoint> {
  const obj: Record<string, Checkpoint> = {};
  for (const [key, value] of map) {
    obj[key] = value;
  }
  return obj;
}

/**
 * Deserialize checkpoint map from JSON object.
 */
export function deserializeCheckpoints(data: Record<string, Checkpoint>): CheckpointMap {
  const map = new Map<string, Checkpoint>();
  for (const [key, value] of Object.entries(data)) {
    map.set(key, value);
  }
  return map;
}
