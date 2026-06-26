import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isGitRepo, createCheckpoint, serializeCheckpoints, deserializeCheckpoints } from "./checkpoints";
import type { CheckpointMap } from "./checkpoints";
import { executeRewind } from "./rewind";
import { executeUndo } from "./undo";

const CUSTOM_TYPE = "pi-rewind-chat";

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

    // Load checkpoints from persisted custom entries
    const entries = ctx.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as any;
      if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) {
        const data = entry.data;
        if (data?.checkpoints) {
          const loaded = deserializeCheckpoints(data.checkpoints);
          for (const [key, value] of loaded) {
            checkpoints.set(key, value);
          }
        }
        break; // Use the latest custom entry
      }
    }

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

      // Persist to session
      pi.sendMessage({
        customType: CUSTOM_TYPE,
        content: `Checkpoint saved for: ${userPrompt.slice(0, 50)}`,
        display: false,
        details: { checkpoints: serializeCheckpoints(checkpoints) },
      });

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
