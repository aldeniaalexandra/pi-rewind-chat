import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Checkpoint, CheckpointMap } from "./checkpoints";
import { createCheckpoint, restoreCheckpoint, getDiffFiles } from "./checkpoints";

export type RewindScope = "both" | "code" | "chat";

/** State needed by /rewind-undo to reverse the last rewind. */
export interface LastRewind {
  /** Leaf id before navigateTree moved it. Undo jumps back here. Null if chat wasn't rewound. */
  oldLeafId: string | null;
  /** Snapshot of the working tree taken right before restoring code, if code was rewound. */
  preRewindCheckpoint: Checkpoint | null;
}

/**
 * Collect user messages from the current session branch.
 */
function getUserMessages(ctx: ExtensionCommandContext) {
  const branch = ctx.sessionManager.getBranch();
  return branch
    .filter((entry) => {
      if (entry.type !== "message") return false;
      const msg = (entry as any).message;
      return msg?.role === "user";
    })
    .map((entry) => {
      const msg = (entry as any).message;
      const content = typeof msg.content === "string"
        ? msg.content
        : msg.content?.find((c: any) => c.type === "text")?.text || "";
      return {
        id: entry.id,
        text: content.slice(0, 80), // Truncate for display
        timestamp: entry.timestamp,
      };
    });
}

/**
 * Execute the rewind operation.
 */
export async function executeRewind(
  args: string,
  ctx: ExtensionCommandContext,
  checkpoints: CheckpointMap,
  rewindStack: LastRewind[],
): Promise<void> {
  const cwd = ctx.cwd;

  // Get user messages
  const messages = getUserMessages(ctx);

  if (messages.length <= 1) {
    ctx.ui.notify("Chat baru dimulai, belum ada yang bisa di-rewind", "info");
    return;
  }

  // Show picker (exclude the last message as target)
  const targetMessages = messages.slice(0, -1);
  const choices = targetMessages.map((m, i) => {
    const cp = checkpoints.get(m.id);
    const fileCount = cp?.filesChanged ?? 0;
    const fileLabel = fileCount > 0 ? `(${fileCount} file)` : "(0 file)";
    return `${i + 1}. ${m.text}  ${fileLabel}`;
  });

  const selected = await ctx.ui.select("Pilih pesan untuk rewind:", choices);

  if (!selected) {
    ctx.ui.notify("Rewind dibatalkan", "info");
    return;
  }

  // Parse selected index
  const selectedIndex = choices.indexOf(selected);
  if (selectedIndex < 0) return;

  const target = targetMessages[selectedIndex];
  const checkpoint = checkpoints.get(target.id);

  // Ask what to rewind: code, chat, or both
  let scope: RewindScope = "both";
  if (checkpoint) {
    const scopeChoice = await ctx.ui.select("Rewind apa saja?", [
      "Code + Chat",
      "Code saja",
      "Chat saja",
    ]);
    if (!scopeChoice) {
      ctx.ui.notify("Rewind dibatalkan", "info");
      return;
    }
    scope = scopeChoice === "Code saja" ? "code" : scopeChoice === "Chat saja" ? "chat" : "both";
  } else {
    scope = "chat"; // No checkpoint recorded for this message, only chat can be rewound
  }

  // Show preview
  let previewText = `Rewind ke: "${target.text}"\n\n`;

  if (checkpoint && scope !== "chat") {
    const diff = await getDiffFiles(cwd, checkpoint);

    if (diff.added.length + diff.modified.length + diff.deleted.length > 0) {
      previewText += "Code rollback:\n";
      for (const f of diff.added) previewText += `  + ${f}  (akan dihapus)\n`;
      for (const f of diff.modified) previewText += `  ~ ${f}  (akan diubah)\n`;
      for (const f of diff.deleted) previewText += `  - ${f}  (akan dikembalikan)\n`;
      previewText += "\n";
    }
  }

  if (scope !== "code") {
    const messagesAfter = messages.length - selectedIndex - 1;
    previewText += `Chat setelah ini (${messagesAfter} pesan) akan dipindah ke cabang terpisah.\n`;
    previewText += "Bisa diakses lagi lewat /rewind-undo atau /tree.\n";
  }

  const confirmed = await ctx.ui.confirm("Konfirmasi Rewind", previewText);

  if (!confirmed) {
    ctx.ui.notify("Rewind dibatalkan", "info");
    return;
  }

  // Execute rewind
  try {
    const lastRewind: LastRewind = { oldLeafId: null, preRewindCheckpoint: null };

    // 1. Rewind code: snapshot current tree first (for undo), then restore checkpoint
    if (checkpoint && scope !== "chat") {
      lastRewind.preRewindCheckpoint = await createCheckpoint(
        cwd,
        `undo:${target.id}:${Date.now()}`,
        `pre-rewind snapshot before restoring to "${target.text}"`,
      );
      await restoreCheckpoint(cwd, checkpoint);
      ctx.ui.notify("Code di-rollback", "info");
    }

    // 2. Rewind chat: move the leaf pointer non-destructively (existing entries kept intact)
    if (scope !== "code") {
      lastRewind.oldLeafId = ctx.sessionManager.getLeafId();
      const result = await ctx.navigateTree(target.id, { label: "rewind" });
      if (result.cancelled) {
        ctx.ui.notify("Rewind chat dibatalkan", "info");
        lastRewind.oldLeafId = null;
      } else {
        ctx.ui.notify("Chat di-rewind (histori lama tetap tersimpan di cabang)", "info");
      }
    }

    rewindStack.push(lastRewind);

    ctx.ui.notify(`Rewind ke "${target.text}" berhasil!`, "info");
    ctx.ui.notify("Ketik /rewind-undo untuk membatalkan", "info");
  } catch (error) {
    ctx.ui.notify(`Rewind gagal: ${error}`, "error");
  }
}
