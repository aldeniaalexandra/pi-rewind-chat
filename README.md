# pi-rewind-chat

Per-message rewind extension for the [Pi coding agent](https://pi.dev).

## Features

- `/rewind` — Pick any user message, rollback code, chat, or both to that point
- `/rewind-undo` — Reverse the last rewind (repeatable — walks back through multiple rewinds)
- Automatic git checkpoints per user message, pinned against `git gc`
- Chat rewind is non-destructive: it moves the conversation branch pointer (via Pi's native tree navigation), it doesn't delete history
- Preview affected files and scope (code/chat/both) before confirming

> **Note:** Checkpoints are stored in-memory per session. They won't persist if you restart Pi. This prevents feedback loops that could cause infinite message cycles.

## Install

```bash
# From npm (when published)
pi install npm:pi-rewind-chat

# From GitHub
pi install github.com/aldeniaalexandra/pi-rewind-chat

# For development
git clone github.com/aldeniaalexandra/pi-rewind-chat
pi -e ./pi-rewind-chat/src/index.ts
```

## Usage

1. Chat normally with Pi
2. Type `/rewind` to see list of your messages
3. Select a message to rewind to
4. Preview changes and confirm
5. Code + chat rolled back to that point
6. Made a mistake? `/rewind-undo` to restore

## Requirements

- Git repository (extension disables itself in non-git directories)
- Pi coding agent v0.79+

## License

MIT
