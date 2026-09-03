/**
 * Typed GitHub Actions DSL — the only place that knows the Actions schema.
 *
 * Workflows are authored in `ci/workflows.ts` and rendered to
 * `.github/workflows/*.yml` by `ci/generate.ts` (`bun run workflows`). Nothing
 * here is repo-specific; it is the subset of the schema we actually use, plus
 * the step builders that keep the definitions to one line each.
 *
 * Keep every `run` a single line: Bun's YAML writer emits multi-line strings as
 * quoted scalars with \n escapes rather than `|` blocks — valid, but unreadable.
 * Anything longer than one command belongs in a `scripts/*.ts` file, which is
 * the point of doing this in TypeScript at all.
 */

export type Runner = 'ubuntu-latest' | 'macos-latest';

export type Permissions = Partial<
  Record<'actions' | 'contents' | 'id-token' | 'packages' | 'pull-requests', 'read' | 'write' | 'none'>
>;

export type Env = Record<string, string>;

export type Step = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  with?: Record<string, string | number | boolean>;
  run?: string;
  env?: Env;
  'working-directory'?: string;
  'continue-on-error'?: boolean;
};

export type Job = {
  name?: string;
  'runs-on': Runner;
  needs?: string | string[];
  if?: string;
  permissions?: Permissions;
  env?: Env;
  'timeout-minutes'?: number;
  steps: Step[];
};

export type DispatchInput = {
  description: string;
  type: 'boolean' | 'string' | 'choice';
  required?: boolean;
  default?: string | boolean;
  options?: string[];
};

export type Triggers = {
  push?: { branches?: string[]; tags?: string[]; paths?: string[] };
  pull_request?: { branches?: string[]; types?: string[]; paths?: string[] };
  workflow_dispatch?: { inputs?: Record<string, DispatchInput> };
  schedule?: { cron: string }[];
};

export type Workflow = {
  name: string;
  on: Triggers;
  permissions?: Permissions;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  env?: Env;
  jobs: Record<string, Job>;
};

// ---------------------------------------------------------------- step builders

/** A shell step. Extra keys cover the occasional `if` / `env` / `id`. */
export const sh = (name: string, run: string, extra: Omit<Step, 'name' | 'run' | 'uses'> = {}): Step => ({
  name,
  run,
  ...extra,
});

/**
 * `fetchDepth` maps to `actions/checkout`'s `fetch-depth`. The action defaults to `1` — a
 * clone with no history — which silently starves anything that reads the log: the explorer's
 * "Recently Changed" report shells out to `git log -n 60` and renders an empty list on every
 * deployed build without this. Pass a bounded depth rather than `0`; full history is slower
 * and nothing here needs it.
 */
export const checkout = (fetchDepth?: number): Step => ({
  name: 'Checkout',
  uses: 'actions/checkout@v7',
  ...(fetchDepth === undefined ? {} : { with: { 'fetch-depth': fetchDepth } }),
});

export const setupBun = (version: string): Step => ({
  name: 'Setup bun',
  uses: 'oven-sh/setup-bun@v2',
  with: { 'bun-version': version },
});

/** Only the release needs node — `npm publish` is what talks OIDC to the registry. */
export const setupNode = (version: string): Step => ({
  name: 'Setup node',
  uses: 'actions/setup-node@v7',
  with: { 'node-version': version },
});

export const cache = (name: string, path: string, key: string, restoreKeys: string): Step => ({
  name: `Cache ${name}`,
  uses: 'actions/cache@v6',
  with: { path, key, 'restore-keys': restoreKeys },
});

export const cacheBunStore = (): Step =>
  cache(
    'bun store',
    '~/.bun/install/cache',
    "bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}",
    'bun-${{ runner.os }}-',
  );

export const install = (): Step => sh('Install', 'bun install --frozen-lockfile');

// ---------------------------------------------------------------- rendering

const HEADER = [
  '# GENERATED FILE — DO NOT EDIT.',
  '# Authored in TypeScript at ci/workflows.ts; run `bun run workflows` to regenerate.',
  '# CI fails if this file drifts from the TypeScript source (`bun run workflows:check`).',
].join('\n');

/** YAML text for one workflow, with the generated-file banner on top. */
export function render(workflow: Workflow): string {
  const yaml = Bun.YAML.stringify(workflow, null, 2)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  return `${HEADER}\n\n${yaml}\n`;
}
