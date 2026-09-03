#!/usr/bin/env bun
/**
 * Renders `ci/workflows.ts` into `.github/workflows/*.yml`.
 *
 *   bun run workflows          write the YAML (and delete any stale file)
 *   bun run workflows:check    fail if the YAML on disk differs — CI runs this,
 *                              so a hand-edited workflow never survives a PR
 *
 * The workflows map owns the whole directory: a .yml in there that isn't in the
 * map is stale, because the only way to get one is to have written it by hand.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { render } from './dsl.ts';
import { workflows } from './workflows.ts';

const DIR = join(import.meta.dir, '../.github/workflows');
const check = process.argv.includes('--check');

const stale: string[] = [];
const changed: string[] = [];

mkdirSync(DIR, { recursive: true });

for (const [file, workflow] of Object.entries(workflows)) {
  const path = join(DIR, file);
  const next = render(workflow);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === next) continue;

  changed.push(file);
  if (!check) await Bun.write(path, next);
}

for (const file of readdirSync(DIR)) {
  if (!file.endsWith('.yml') || file in workflows) continue;
  stale.push(file);
  if (!check) rmSync(join(DIR, file));
}

if (check && (changed.length || stale.length)) {
  console.error('✗ .github/workflows is out of date with ci/workflows.ts');
  for (const file of changed) console.error(`  changed: ${file}`);
  for (const file of stale) console.error(`  stale:   ${file}`);
  console.error('\nRun `bun run workflows` and commit the result.');
  process.exit(1);
}

const wrote = changed.length ? `wrote ${changed.join(', ')}` : '';
const removed = stale.length ? `removed ${stale.join(', ')}` : '';
console.log(
  check
    ? '✓ .github/workflows is in sync'
    : `✓ ${[wrote, removed].filter(Boolean).join('; ') || '.github/workflows already up to date'}`,
);
