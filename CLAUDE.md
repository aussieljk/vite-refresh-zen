# vite-refresh-zen

Vite plugin to pause/resume HMR, batching file changes for a single reload.

## Structure

- `src/index.ts` - Main plugin, exports `refreshZen()`
- `src/cli.ts` - Interactive installer (`bunx vite-refresh-zen`)

## Key Behavior

- Intercepts Vite's `handleHotUpdate` hook
- When paused: buffers changed modules, returns empty array to suppress HMR
- On resume: triggers full page reload via WebSocket
- Exposes HTTP endpoints at `/__zen/*`

## Endpoints

- `/__zen/pause` - Start buffering changes
- `/__zen/resume` - Apply pending changes (full reload)
- `/__zen/status` - JSON status + pending files
- `/__zen/discard` - Clear buffer without reload
- `/__zen/toggle` - Toggle pause state

## Claude Code Integration

Hooks in `.claude/settings.json`:
- `PreToolUse` on Edit/Write → pause
- `Stop` → resume

## Build

```bash
bun run build
```
