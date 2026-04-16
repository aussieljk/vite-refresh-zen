import type { Plugin, ViteDevServer, HmrContext } from 'vite';

export interface RefreshZenOptions {
  /**
   * Base path for the control endpoints
   * @default '/__zen'
   */
  basePath?: string;

  /**
   * Log state changes to console
   * @default true
   */
  log?: boolean;

  /**
   * Auto-resume after this many milliseconds of no file changes
   * Set to 0 to disable auto-resume
   * @default 0
   */
  autoResumeMs?: number;
}

interface PendingUpdate {
  file: string;
  timestamp: number;
}

export function refreshZen(options: RefreshZenOptions = {}): Plugin {
  const {
    basePath = '/__zen',
    log = true,
    autoResumeMs = 0,
  } = options;

  let paused = false;
  let pendingUpdates: PendingUpdate[] = [];
  let server: ViteDevServer | null = null;
  let autoResumeTimer: ReturnType<typeof setTimeout> | null = null;

  const logger = (msg: string) => {
    if (log) {
      console.log(`[refresh-zen] ${msg}`);
    }
  };

  const clearAutoResumeTimer = () => {
    if (autoResumeTimer) {
      clearTimeout(autoResumeTimer);
      autoResumeTimer = null;
    }
  };

  const scheduleAutoResume = () => {
    if (autoResumeMs > 0 && paused) {
      clearAutoResumeTimer();
      autoResumeTimer = setTimeout(() => {
        if (paused) {
          resume();
        }
      }, autoResumeMs);
    }
  };

  const pause = () => {
    if (!paused) {
      paused = true;
      pendingUpdates = [];
      logger('Paused - file changes will be batched');
    }
    return { paused, pending: pendingUpdates.length };
  };

  const resume = () => {
    clearAutoResumeTimer();
    if (paused && server) {
      const count = pendingUpdates.length;
      paused = false;

      if (count > 0) {
        logger(`Resuming with ${count} pending changes - triggering full reload`);
        server.ws.send({ type: 'full-reload' });
      } else {
        logger('Resumed - no pending changes');
      }

      pendingUpdates = [];
    }
    return { paused, pending: 0 };
  };

  const status = () => ({
    paused,
    pending: pendingUpdates.length,
    files: pendingUpdates.map(u => u.file),
  });

  const discard = () => {
    clearAutoResumeTimer();
    const count = pendingUpdates.length;
    pendingUpdates = [];
    paused = false;
    logger(`Discarded ${count} pending changes`);
    return { discarded: count };
  };

  return {
    name: 'vite-refresh-zen',

    configureServer(srv) {
      server = srv;

      // Middleware for control endpoints
      srv.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(basePath)) {
          return next();
        }

        const endpoint = req.url.slice(basePath.length);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        switch (endpoint) {
          case '/pause':
            res.end(JSON.stringify(pause()));
            break;

          case '/resume':
            res.end(JSON.stringify(resume()));
            break;

          case '/status':
            res.end(JSON.stringify(status()));
            break;

          case '/discard':
            res.end(JSON.stringify(discard()));
            break;

          case '/toggle':
            res.end(JSON.stringify(paused ? resume() : pause()));
            break;

          default:
            res.statusCode = 404;
            res.end(JSON.stringify({
              error: 'Unknown endpoint',
              endpoints: ['/pause', '/resume', '/status', '/discard', '/toggle'],
            }));
        }
      });

      logger(`Control endpoints available at ${basePath}/*`);
      logger(`  ${basePath}/pause   - Pause HMR updates`);
      logger(`  ${basePath}/resume  - Apply pending changes (full reload)`);
      logger(`  ${basePath}/status  - Check current state`);
      logger(`  ${basePath}/discard - Discard pending changes`);
      logger(`  ${basePath}/toggle  - Toggle pause state`);
    },

    handleHotUpdate(ctx: HmrContext) {
      if (!paused) {
        // Normal HMR flow
        return;
      }

      // Store the pending update
      pendingUpdates.push({
        file: ctx.file,
        timestamp: ctx.timestamp,
      });

      logger(`Buffered: ${ctx.file} (${pendingUpdates.length} pending)`);

      // Schedule auto-resume if configured
      scheduleAutoResume();

      // Return empty array to suppress HMR update
      return [];
    },
  };
}

export default refreshZen;
