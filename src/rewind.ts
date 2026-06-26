import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CheckpointMap } from "./checkpoints";
import { restoreCheckpoint, getDiffFiles } from "./checkpoints";
import { copyFileSync, existsSync } from "fs";

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
 * Backup the current session file before rewind.
 * Returns the backup path.
 */
function backupSession(sessionFile: string): string {
  const backupPath = `${sessionFile}.rewind-backup`;
  copyFileSync(sessionFile, backupPath);
  return backupPath;
}

/**
 * Execute the rewind operation.
 */
export async function executeRewind(
  args: string,
  ctx: ExtensionCommandContext,
  checkpoints: CheckpointMap,
  backupPathRef: { current: string | null },
): Promise<void> {
  const cwd = ctx.cwd;
  const sessionFile = ctx.sessionManager.getSessionFile();

  if (!sessionFile) {
    ctx.ui.notify("No active session file found", "error");
    return;
  }

  // Get user messages
  const messages = getUserMessages(ctx);

  if (messages.length <= 1) {
    ctx.ui.notify("No messages to rewind to", "info");
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

  const selected = await ctx.ui.select("Pilih chat untuk rewind:", choices);

  if (!selected) {
    ctx.ui.notify("Rewind dibatalkan", "info");
    return;
  }

  // Parse selected index
  const selectedIndex = choices.indexOf(selected);
  if (selectedIndex < 0) return;

  const target = targetMessages[selectedIndex];
  const checkpoint = checkpoints.get(target.id);

  // Show preview
  let previewText = `Rewind ke: "${target.text}"\n\n`;

  if (checkpoint) {
    const diff = await getDiffFiles(cwd, checkpoint);

    if (diff.added.length + diff.modified.length + diff.deleted.length > 0) {
      previewText += "Code rollback:\n";
      for (const f of diff.added) previewText += `  + ${f}  (akan dihapus)\n`;
      for (const f of diff.modified) previewText += `  ~ ${f}  (akan diubah)\n`;
      for (const f of diff.deleted) previewText += `  - ${f}  (akan dikembalikan)\n`;
      previewText += "\n";
    }
  }

  const messagesAfter = messages.length - selectedIndex - 1;
  previewText += `Chat setelah ini (${messagesAfter} pesan) akan dihapus permanen.\n`;
  previewText += "Backup disimpan untuk undo.\n";

  const confirmed = await ctx.ui.confirm("Konfirmasi Rewind", previewText);

  if (!confirmed) {
    ctx.ui.notify("Rewind dibatalkan", "info");
    return;
  }

  // Execute rewind
  try {
    // 1. Backup session
    backupPathRef.current = backupSession(sessionFile);

    // 2. Restore code if checkpoint exists
    if (checkpoint) {
      await restoreCheckpoint(cwd, checkpoint);
      ctx.ui.notify("Code di-rollback", "info");
    }

    ctx.ui.notify(`Rewind ke "${target.text}" berhasil!`, "info");
    ctx.ui.notify("Ketik /tree untuk navigate ke chat sebelumnya", "info");
    ctx.ui.notify("Ketik /rewind-undo untuk membatalkan rewind code", "info");
  } catch (error) {
    ctx.ui.notify(`Rewind gagal: ${error}`, "error");
  }
}
