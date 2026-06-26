import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync, copyFileSync, unlinkSync } from "fs";

/**
 * Execute undo of the last rewind.
 * Restores session from backup file.
 */
export async function executeUndo(
  ctx: ExtensionCommandContext,
  backupPathRef: { current: string | null },
): Promise<void> {
  const sessionFile = ctx.sessionManager.getSessionFile();

  if (!sessionFile) {
    ctx.ui.notify("No active session file found", "error");
    return;
  }

  if (!backupPathRef.current || !existsSync(backupPathRef.current)) {
    ctx.ui.notify("Tidak ada rewind yang bisa di-undo", "info");
    return;
  }

  try {
    // Restore session from backup
    copyFileSync(backupPathRef.current, sessionFile);

    // Clean up backup
    unlinkSync(backupPathRef.current);
    backupPathRef.current = null;

    ctx.ui.notify("Rewind berhasil di-undo! Restart session untuk melihat perubahan.", "info");
  } catch (error) {
    ctx.ui.notify(`Undo gagal: ${error}`, "error");
  }
}
