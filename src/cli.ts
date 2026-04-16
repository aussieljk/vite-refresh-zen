#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

const DEFAULTS = {
  url: 'http://localhost:5173',
};

// Parse CLI args
const args = process.argv.slice(2);
const flags = {
  yes: args.includes('-y') || args.includes('--yes'),
  url: args.find((a) => a.startsWith('--url='))?.split('=')[1],
  help: args.includes('-h') || args.includes('--help'),
};

const isInteractive = process.stdin.isTTY && !flags.yes;

let rl: readline.Interface | null = null;
if (isInteractive) {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

const ask = (question: string, defaultValue?: string): Promise<string> => {
  if (!isInteractive) return Promise.resolve(defaultValue || '');
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl!.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
};

const confirm = async (question: string, defaultYes = true): Promise<boolean> => {
  if (!isInteractive) return Promise.resolve(defaultYes);
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${question} ${hint}`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
};

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function printHelp() {
  console.log(`
${green('vite-refresh-zen')} installer

Usage: refresh-zen [options]

Options:
  -y, --yes         Accept all defaults (non-interactive)
  --url=<url>       Dev server URL (default: http://localhost:5173)
  -h, --help        Show this help

Examples:
  refresh-zen                          # Interactive setup
  refresh-zen -y                       # Accept all defaults
  refresh-zen -y --url=https://app.localhost
`);
}

async function main() {
  if (flags.help) {
    printHelp();
    process.exit(0);
  }
  console.log('\n' + green('vite-refresh-zen') + ' installer\n');
  console.log(dim('Pause Vite HMR while Claude Code edits files,'));
  console.log(dim('then apply all changes at once when done.\n'));

  const cwd = process.cwd();

  // Step 1: Dev URL
  console.log(yellow('1. Dev server URL'));
  const devUrl = flags.url || await ask('   Enter your dev server URL', DEFAULTS.url);
  if (flags.url) console.log(dim(`   Using: ${flags.url}`));
  const useEnvVar = devUrl !== DEFAULTS.url;

  // Step 2: Configure Claude hooks
  console.log('\n' + yellow('2. Claude Code hooks'));
  const configureHooks = await confirm('   Configure .claude/settings.json?');

  if (configureHooks) {
    const claudeDir = join(cwd, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');

    let settings: Record<string, unknown> = {};

    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        console.log(dim('   Found existing .claude/settings.json'));
      } catch {
        console.log(dim('   Found .claude/settings.json but could not parse, will overwrite hooks'));
      }
    } else {
      if (!existsSync(claudeDir)) {
        mkdirSync(claudeDir, { recursive: true });
      }
      console.log(dim('   Creating .claude/settings.json'));
    }

    // Build hook command
    const urlPart = useEnvVar
      ? '${VITE_ZEN_URL:-' + devUrl + '}'
      : devUrl;
    const pauseCmd = `curl -sk ${urlPart}/__zen/pause > /dev/null`;
    const resumeCmd = `curl -sk ${urlPart}/__zen/resume > /dev/null`;

    // Merge hooks
    const hooks = (settings.hooks as Record<string, unknown[]>) || {};

    // Add PreToolUse hook
    const preToolUse = (hooks.PreToolUse as unknown[]) || [];
    const preToolUseHook = {
      matcher: 'Edit|Write',
      hooks: [
        {
          type: 'command',
          command: pauseCmd,
        },
      ],
    };
    // Check if similar hook already exists
    const hasPreHook = preToolUse.some(
      (h: unknown) => {
        if (typeof h !== 'object' || h === null) return false;
        const hooksArr = (h as Record<string, unknown>).hooks;
        if (!Array.isArray(hooksArr)) return false;
        return hooksArr.some((inner: unknown) =>
          typeof inner === 'object' && inner !== null &&
          'command' in inner && String((inner as Record<string, unknown>).command).includes('__zen/pause')
        );
      }
    );
    if (!hasPreHook) {
      preToolUse.push(preToolUseHook);
    }
    hooks.PreToolUse = preToolUse;

    // Add Stop hook
    const stop = (hooks.Stop as unknown[]) || [];
    const stopHook = {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: resumeCmd,
        },
      ],
    };
    const hasStopHook = stop.some(
      (h: unknown) => {
        if (typeof h !== 'object' || h === null) return false;
        const hooksArr = (h as Record<string, unknown>).hooks;
        if (!Array.isArray(hooksArr)) return false;
        return hooksArr.some((inner: unknown) =>
          typeof inner === 'object' && inner !== null &&
          'command' in inner && String((inner as Record<string, unknown>).command).includes('__zen/resume')
        );
      }
    );
    if (!hasStopHook) {
      stop.push(stopHook);
    }
    hooks.Stop = stop;

    settings.hooks = hooks;

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(green('   ✓ Hooks configured'));

    if (useEnvVar) {
      console.log(dim(`   Tip: export VITE_ZEN_URL=${devUrl} in your shell`));
    }
  }

  // Step 3: Configure vite.config
  console.log('\n' + yellow('3. Vite config'));
  const configureVite = await confirm('   Add plugin to vite.config?');

  if (configureVite) {
    // Find vite config
    const configFiles = [
      'vite.config.ts',
      'vite.config.js',
      'vite.config.mts',
      'vite.config.mjs',
    ];

    let configPath: string | null = null;
    for (const file of configFiles) {
      const fullPath = join(cwd, file);
      if (existsSync(fullPath)) {
        configPath = fullPath;
        break;
      }
    }

    if (!configPath) {
      console.log(dim('   No vite.config found, skipping'));
    } else {
      let content = readFileSync(configPath, 'utf-8');
      const filename = configPath.split('/').pop();

      // Check if already configured
      if (content.includes('refreshZen') || content.includes('vite-refresh-zen')) {
        console.log(dim('   Plugin already configured in ' + filename));
      } else {
        // Add import
        const importStatement = "import { refreshZen } from 'vite-refresh-zen';\n";

        // Find where to insert import (after last import)
        const importRegex = /^import .+ from .+;?\n/gm;
        let lastImportEnd = 0;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          lastImportEnd = match.index + match[0].length;
        }

        if (lastImportEnd > 0) {
          content = content.slice(0, lastImportEnd) + importStatement + content.slice(lastImportEnd);
        } else {
          content = importStatement + content;
        }

        // Add to plugins array
        const pluginsRegex = /plugins:\s*\[/;
        const pluginsMatch = content.match(pluginsRegex);
        if (pluginsMatch && pluginsMatch.index !== undefined) {
          const insertPos = pluginsMatch.index + pluginsMatch[0].length;
          content = content.slice(0, insertPos) + 'refreshZen(), ' + content.slice(insertPos);
        } else {
          console.log(dim('   Could not find plugins array, add manually:'));
          console.log(dim('   plugins: [refreshZen(), ...]'));
        }

        writeFileSync(configPath, content);
        console.log(green('   ✓ Added to ' + filename));
      }
    }
  }

  // Step 4: Check if package is installed
  console.log('\n' + yellow('4. Dependencies'));
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['vite-refresh-zen']) {
      console.log(dim('   vite-refresh-zen already installed'));
    } else {
      console.log(dim('   Run: bun add -D vite-refresh-zen'));
    }
  }

  console.log('\n' + green('Done!') + ' Restart your Vite dev server to activate.\n');

  rl?.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
