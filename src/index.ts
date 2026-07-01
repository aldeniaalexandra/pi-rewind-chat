import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { captureFileBeforeChange, finalizeCheckpoint } from "./checkpoints";
import type { CheckpointMap, PendingSnapshot } from "./checkpoints";
import { executeRewind } from "./rewind";
import type { LastRewind } from "./rewind";
import { executeUndo } from "./undo";

export default function (pi: ExtensionAPI) {
  const checkpoints: CheckpointMap = new Map();
  const pendingSnapshot: PendingSnapshot = new Map();
  const rewindStack: LastRewind[] = [];

  pi.on("session_start", (_event, ctx) => {
    // Note: checkpoints are stored in-memory only, not persisted to the session.
    // An earlier approach used pi.appendEntry() to persist them, but that caused
    // feedback loops (repeated "Good" messages with thumbs up responses).
    ctx.ui.setStatus("rewind-chat", `◆ ${checkpoints.size} checkpoints`);
  });

  // Capture each file's content the moment before a tool edits or overwrites it.
  // This is the same "snapshot tool-touched files" approach Claude Code uses for
  // code rewind: no git required, no dependency on the working tree being clean.
  pi.on("tool_call", (event, ctx) => {
    if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
      captureFileBeforeChange(pendingSnapshot, ctx.cwd, event.input.path);
    }
  });

  // Finalize the turn's checkpoint once the agent loop for this user message ends.
  pi.on("agent_end", (_event, ctx) => {
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

    const checkpoint = finalizeCheckpoint(pendingSnapshot, userPrompt);

    if (checkpoint) {
      checkpoints.set(userEntryId, checkpoint);
      ctx.ui.setStatus("rewind-chat", `◆ ${checkpoints.size} checkpoints`);
    }
  });

  // Register /rewind command
  pi.registerCommand("rewind", {
    description: "Rewind to a previous user message (code + chat rollback)",
    handler: async (args, ctx) => {
      await executeRewind(args, ctx, checkpoints, rewindStack);
    },
  });

  // Register /rewind-undo command
  pi.registerCommand("rewind-undo", {
    description: "Undo the last rewind operation (repeatable, undoes one rewind per call)",
    handler: async (_args, ctx) => {
      await executeUndo(ctx, rewindStack);
    },
  });
}
