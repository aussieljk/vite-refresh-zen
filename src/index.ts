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

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function colorType(type: string): string {
  switch (type) {
    case 'paused': return red(`(${type})`);
    case 'resumed': return green(`(${type})`);
    default: return dim(`(${type})`);
  }
}

function getTimestamp(): string {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${hours}:${minutes}:${seconds} ${ampm}`;
}

function toRelativePath(filePath: string, root: string): string {
  if (filePath.startsWith(root)) {
    return filePath.slice(root.length);
  }
  return filePath;
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
  let root = process.cwd();

  const logger = (type: string, msg: string) => {
    if (log) {
      console.log(`${dim(getTimestamp())} ${green('[refresh-zen]')} ${colorType(type)} - ${msg}`);
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
      logger('paused', 'file changes will be batched');
    }
    return { paused, pending: pendingUpdates.length };
  };

  const resume = () => {
    clearAutoResumeTimer();
    if (paused && server) {
      const count = pendingUpdates.length;
      paused = false;

      if (count > 0) {
        logger('resumed', `${count} pending changes - triggering full reload`);
        server.ws.send({ type: 'full-reload' });
      } else {
        logger('resumed', 'no pending changes');
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
    logger('discarded', `${count} pending changes`);
    return { discarded: count };
  };

  return {
    name: 'vite-refresh-zen',

    configureServer(srv) {
      server = srv;
      root = srv.config.root;

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

      logger('ready', `endpoints at ${dim(basePath + '/*')}`);
    },

    handleHotUpdate(ctx: HmrContext) {
      if (!paused) {
        return;
      }

      pendingUpdates.push({
        file: ctx.file,
        timestamp: ctx.timestamp,
      });

      logger('buffered', `${dim(toRelativePath(ctx.file, root))} (x${pendingUpdates.length})`);

      scheduleAutoResume();

      return [];
    },
  };
}

export default refreshZen;
