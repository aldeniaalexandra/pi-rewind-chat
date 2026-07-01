import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { restoreCheckpoint } from "./checkpoints";
import type { LastRewind } from "./rewind";

/**
 * Execute undo of the most recent rewind still on the stack.
 * Reverses both the code rollback (if any) and the chat branch move (if any).
 * Calling this repeatedly walks back through prior rewinds one at a time.
 */
export async function executeUndo(
  ctx: ExtensionCommandContext,
  rewindStack: LastRewind[],
): Promise<void> {
  const lastRewind = rewindStack.pop();

  if (!lastRewind) {
    ctx.ui.notify("Tidak ada rewind yang bisa di-undo", "info");
    return;
  }

  try {
    // 1. Undo code rollback: restore the pre-rewind snapshot
    if (lastRewind.preRewindCheckpoint) {
      await restoreCheckpoint(ctx.cwd, lastRewind.preRewindCheckpoint);
      ctx.ui.notify("Code dikembalikan ke sebelum rewind", "info");
    }

    // 2. Undo chat rewind: jump the leaf back to where it was
    if (lastRewind.oldLeafId) {
      const result = await ctx.navigateTree(lastRewind.oldLeafId, { label: "rewind-undo" });
      if (!result.cancelled) {
        ctx.ui.notify("Chat dikembalikan ke sebelum rewind", "info");
      }
    }

    const remaining = rewindStack.length;
    ctx.ui.notify(
      remaining > 0
        ? `Rewind berhasil di-undo! (${remaining} rewind lagi bisa di-undo)`
        : "Rewind berhasil di-undo!",
      "info",
    );
  } catch (error) {
    // Restore the popped entry so the user can retry the undo.
    rewindStack.push(lastRewind);
    ctx.ui.notify(`Undo gagal: ${error}`, "error");
  }
}
