import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isGitRepo, createCheckpoint } from "./checkpoints";
import type { CheckpointMap } from "./checkpoints";
import { executeRewind } from "./rewind";
import { executeUndo } from "./undo";

export default function (pi: ExtensionAPI) {
  const checkpoints: CheckpointMap = new Map();
  const backupPathRef = { current: null as string | null };
  let isGit = false;

  // Check git repo and load persisted checkpoints on session start
  pi.on("session_start", async (_event, ctx) => {
    isGit = await isGitRepo(ctx.cwd);

    if (!isGit) {
      ctx.ui.setStatus("rewind-chat", "⚠ not git repo");
      return;
    }

    // Note: We no longer persist checkpoints to session.
    // Checkpoints are stored in-memory only per session lifetime.
    // The old approach used pi.appendEntry() which caused feedback loops
    // (repeated "Good" messages with thumbs up responses).

    ctx.ui.setStatus("rewind-chat", `◆ ${checkpoints.size} checkpoints`);
  });

  // Create checkpoint after each agent turn (when user message is processed)
  pi.on("agent_end", async (event, ctx) => {
    if (!isGit) return;

    // Find the user message entry for this turn
    const branch = ctx.sessionManager.getBranch();
    let userEntryId: string | null = null;
    let userPrompt = "";

    // Walk backwards to find the most recent user message
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i] as any;
      if (entry.type === "message" && entry.message?.role === "user") {
        userEntryId = entry.id;
        const content = entry.message.content;
        userPrompt = typeof content === "string"
          ? content
          : content?.find((c: any) => c.type === "text")?.text || "";
        break;
      }
    }

    if (!userEntryId) return;

    // Create checkpoint
    const checkpoint = await createCheckpoint(ctx.cwd, userEntryId, userPrompt);

    if (checkpoint) {
      checkpoints.set(userEntryId, checkpoint);

      // Note: checkpoints are stored in-memory only.
      // Previously we used pi.appendEntry() here, but that caused
      // repeated "Good" messages + thumbs up loops because appendEntry
      // can trigger re-renders or agent turns.

      ctx.ui.setStatus("rewind-chat", `◆ ${checkpoints.size} checkpoints`);
    }
  });

  // Register /rewind command
  pi.registerCommand("rewind", {
    description: "Rewind to a previous user message (code + chat rollback)",
    handler: async (args, ctx) => {
      if (!isGit) {
        ctx.ui.notify("Rewind hanya tersedia di git repository", "error");
        return;
      }
      await executeRewind(args, ctx, checkpoints, backupPathRef);
    },
  });

  // Register /rewind-undo command
  pi.registerCommand("rewind-undo", {
    description: "Undo the last rewind operation",
    handler: async (_args, ctx) => {
      await executeUndo(ctx, backupPathRef);
    },
  });
}
