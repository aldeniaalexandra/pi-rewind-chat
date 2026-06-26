# pi-rewind-chat

Per-message rewind extension for the [Pi coding agent](https://pi.dev).

## Features

- `/rewind` — Pick any user message, rollback code + chat to that point
- `/rewind-undo` — Reverse the last rewind
- Automatic git checkpoints per user message
- Preview affected files before confirming
- Undo support for accidental rewinds

## Install

```bash
# From npm (when published)
pi install npm:pi-rewind-chat

# From GitHub
pi install github.com/user/pi-rewind-chat

# For development
git clone github.com/user/pi-rewind-chat
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
