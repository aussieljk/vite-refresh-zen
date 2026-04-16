# vite-refresh-zen

Pause and resume Vite HMR. Batch file changes and apply them all at once with a single reload.

Perfect for when AI tools (like Claude Code) are editing multiple files rapidly and you don't want the browser going crazy with constant refreshes.

## Quick Start

```bash
bunx refresh-zen
```

This interactive installer will:
1. Ask for your dev server URL
2. Configure Claude Code hooks (`.claude/settings.json`)
3. Add the plugin to your `vite.config.ts`

### Non-interactive

```bash
bunx refresh-zen -y                              # Accept all defaults
bunx refresh-zen -y --url=https://app.localhost  # Custom URL
```

## Manual Install

```bash
bun add -D vite-refresh-zen
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { refreshZen } from 'vite-refresh-zen';

export default defineConfig({
  plugins: [
    refreshZen(),
  ],
});
```

## Control Endpoints

When Vite dev server is running, these endpoints are available:

| Endpoint | Description |
|----------|-------------|
| `/__zen/pause` | Pause HMR - file changes will be buffered |
| `/__zen/resume` | Apply all pending changes (triggers full reload) |
| `/__zen/status` | Get current state and pending files |
| `/__zen/discard` | Discard pending changes without applying |
| `/__zen/toggle` | Toggle pause state |

### Example

```bash
# Pause before Claude starts working
curl http://localhost:5173/__zen/pause

# Claude edits 20 files...

# Apply all changes at once
curl http://localhost:5173/__zen/resume
```

## Options

```ts
refreshZen({
  // Base path for control endpoints (default: '/__zen')
  basePath: '/__zen',

  // Log state changes to console (default: true)
  log: true,

  // Auto-resume after N ms of no file changes (default: 0 = disabled)
  autoResumeMs: 0,
});
```

### Auto-resume

If you set `autoResumeMs`, the plugin will automatically resume and apply changes after that many milliseconds of no file activity. This is useful if you want "debounced" HMR:

```ts
refreshZen({
  autoResumeMs: 2000, // Resume 2s after last file change
});
```

## Claude Code Integration

Add hooks to auto-pause when Claude starts editing, and auto-resume when Claude finishes:

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "curl -sk ${VITE_ZEN_URL:-http://localhost:5173}/__zen/pause > /dev/null"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "curl -sk ${VITE_ZEN_URL:-http://localhost:5173}/__zen/resume > /dev/null"
          }
        ]
      }
    ]
  }
}
```

- **PreToolUse** on Edit/Write → pauses HMR before any file change
- **Stop** → resumes and applies all changes when Claude finishes responding

Fully automatic - no manual intervention needed.

### Custom URL (portless, etc.)

By default, hooks hit `http://localhost:5173`. To use a different URL (e.g., with [portless](https://portless.sh)):

```bash
# In your shell profile or .env
export VITE_ZEN_URL=https://myapp.localhost
```

## License

MIT
