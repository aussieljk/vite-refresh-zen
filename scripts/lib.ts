/**
 * Shared plumbing for the repo scripts — paths, child processes, CI reporting.
 *
 * `scripts/release.ts` runs in two places (this laptop, and the Release
 * workflow), so anything that differs between the two is decided here or behind
 * `CI`, never duplicated in the workflow.
 *
 * This file is generated from a shared template. The same copy lives in every
 * one of these single-package repos; keep them identical.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Repo root. In these repos the root *is* the published package. */
export const ROOT = resolve(import.meta.dir, '..');
export const CI = !!process.env.CI;

export function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

export function step(message: string) {
  console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
}

/**
 * Any token that reaches a command as argv would otherwise be echoed by the
 * `$ …` line below. Actions masks its own secrets; this covers local runs and
 * anything a child process prints back at us.
 */
const secrets = ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'GITHUB_TOKEN']
  .map((name) => process.env[name])
  .filter((value): value is string => !!value);

const redact = (text: string) => secrets.reduce((acc, secret) => acc.replaceAll(secret, '***'), text);

/** Run a command, streaming its output. Any non-zero exit aborts the script. */
export function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  console.log(`$ ${redact(cmd.join(' '))}`);
  const { exitCode } = Bun.spawnSync(cmd, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (exitCode !== 0) fail(`${redact(cmd.join(' '))} failed (exit ${exitCode})`);
}

/** Same, but captures stdout instead of streaming it. */
export function capture(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): string {
  console.log(`$ ${redact(cmd.join(' '))}`);
  const { exitCode, stdout, stderr } = Bun.spawnSync(cmd, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    stderr: 'pipe',
  });
  const out = stdout.toString();
  if (exitCode !== 0) fail(redact(`${cmd.join(' ')} failed (exit ${exitCode})\n${out}${stderr.toString()}`));
  return out.trim();
}

/** Markdown appended to the GitHub Actions job summary; a no-op locally. */
export function summary(markdown: string) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${markdown}\n`);
}

/** Abort unless the working tree is clean (untracked files count). */
export function requireCleanTree() {
  const dirty = capture(['git', 'status', '--porcelain']);
  if (dirty) fail(`uncommitted changes — commit or stash first:\n${dirty}`);
}

const manifest = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The package name, from package.json. */
export const name = (): string => manifest().name;

/** The version, read fresh (it changes mid-script during a release). */
export const version = (): string => manifest().version;

/**
 * Every version npm already has for this package, or an empty set when the
 * package has never been published (a 404 on the registry).
 *
 * Callers use this to decide whether a hand-edited version in package.json is
 * still waiting to ship. A registry that is down throws rather than answering
 * "not published" — publishing a version twice is a hard error on npm anyway,
 * but silently *bumping past* a version the user meant to ship is not, and that
 * is the mistake this guards.
 */
export async function publishedVersions(pkg: string): Promise<Set<string>> {
  const response = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2f')}`);
  if (response.status === 404) return new Set();
  if (!response.ok) fail(`npm registry returned ${response.status} for ${pkg}`);
  const body = (await response.json()) as { versions?: Record<string, unknown> };
  return new Set(Object.keys(body.versions ?? {}));
}
