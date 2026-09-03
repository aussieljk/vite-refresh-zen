#!/usr/bin/env bun
/**
 * Publish this package to npm and push the version bump.
 *
 *   bun run release                 publish unconditionally
 *   bun run release -- --if-changed publish only if this push touched the package
 *
 * Runs identically on a laptop and in the Release workflow; the only CI-specific
 * bits are the npm upgrade and the git identity.
 *
 * `--if-changed` is what the automatic release on a master push uses: a push that
 * only edited the README or the CI definition should not burn a version number.
 * A manual run (Actions → Release → Run workflow) publishes unconditionally.
 *
 * Which version ships:
 *
 *   package.json holds a version npm does not have   →  publish that version as-is
 *   npm already has it                               →  bump the prerelease, publish that
 *
 * The first case is what makes a hand-edited bump work. Someone who edits
 * package.json to 0.3.0 and pushes gets 0.3.0, not a prerelease of it — and a
 * re-run after a half-failed release republishes nothing, because by then npm
 * has the version and the bump moves past it. Both directions are idempotent,
 * which is the property that matters when the trigger is "every push to master".
 *
 * The automatic bump is `prerelease --preid=rc`, not `patch`, because a push to
 * master is not a considered release — it is whatever just landed. So 0.1.0
 * becomes 0.1.1-rc.0, then 0.1.1-rc.1, and the base version does not move until
 * someone deliberately promotes it:
 *
 *   npm version patch --no-git-tag-version   # 0.1.1-rc.3 → 0.1.1
 *
 * and pushes that. Semver sorts 0.1.1-rc.0 above 0.1.0 and below 0.1.1, so an rc
 * is a smaller step than a patch — which is the point. It is the same shape as
 * the 0.0.1-N series ljkui runs and the 0.0.1-canary.N series uight runs.
 *
 * These publish to the `latest` dist-tag, deliberately: `npm i <pkg>` gives the
 * newest rc. Nothing here is a stable-versus-preview split; the newest thing is
 * the thing.
 *
 * There is no npm token anywhere. In CI the publish authenticates by trusted
 * publishing: the job's `id-token: write` permission mints an OIDC token that npm
 * trades for scoped, short-lived publish rights. Locally it uses your `npm login`
 * session. Provenance is attached automatically where the repo is public; npm
 * skips it on a private repo rather than failing.
 *
 * The push uses GITHUB_TOKEN, whose pushes deliberately do not start new workflow
 * runs. That is load-bearing, not a detail: the release commit edits
 * package.json, which `--if-changed` counts as a package change, so a push with
 * any other credential would release forever.
 */
import { readFileSync } from 'node:fs';
import {
  CI,
  ROOT,
  capture,
  fail,
  name,
  publishedVersions,
  requireCleanTree,
  run,
  step,
  summary,
  version,
} from './lib.ts';

/** Trusted publishing landed in npm 11.5.1; older npm silently falls back to token auth. */
const MIN_NPM = [11, 5, 1];

/**
 * A change under one of these changes the tarball, so it earns a release.
 * Everything else in the repo — README, CLAUDE.md, ci/, scripts/ — does not.
 */
const PUBLISHED_PATHS = ["src/","package.json","README.md","LICENSE"];

/**
 * The files a push changed, or `undefined` when that cannot be determined (a
 * manual run, a branch's first push, a clone too shallow to hold the previous
 * commit). Callers treat `undefined` as "assume it changed": a missed release is
 * worse than a spare version number.
 */
function pushedFiles(): string[] | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;

  let before: string | undefined;
  try {
    before = JSON.parse(readFileSync(eventPath, 'utf8')).before;
  } catch {
    return undefined;
  }
  // All-zeros is a branch's first push, which has no diff base.
  if (!before || /^0+$/.test(before)) return undefined;

  const diff = Bun.spawnSync(['git', 'diff', '--name-only', `${before}..HEAD`], { cwd: ROOT });
  if (diff.exitCode !== 0) return undefined;
  return diff.stdout.toString().split('\n').filter(Boolean);
}

if (process.argv.includes('--if-changed')) {
  const files = pushedFiles();
  const touched = files?.some((file) => PUBLISHED_PATHS.some((path) => file === path || file.startsWith(path)));
  if (files && !touched) {
    step('Nothing published changed in this push — skipping the release');
    summary(
      `### 📦 No release\n\nThis push touched nothing under ${PUBLISHED_PATHS.map((p) => `\`${p}\``).join(', ')}, so the npm version is unchanged.`,
    );
    process.exit(0);
  }
}

const olderThanMin = (found: number[]) => {
  for (const [i, min] of MIN_NPM.entries()) {
    const part = found[i] ?? 0;
    if (part !== min) return part < min;
  }
  return false;
};

step('Checking the working tree');
requireCleanTree();

if (CI) {
  if (process.env.NODE_AUTH_TOKEN) {
    fail('NODE_AUTH_TOKEN is set — npm would use legacy token auth instead of trusted publishing');
  }

  const npm = capture(['npm', '--version']);
  if (olderThanMin(npm.split('.').map(Number))) {
    step(`npm ${npm} predates trusted publishing (need ${MIN_NPM.join('.')}) — upgrading`);
    run(['npm', 'install', '-g', 'npm@latest']);
  }

  run(['git', 'config', 'user.name', 'github-actions[bot]']);
  run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
}

const pkg = name();
const published = await publishedVersions(pkg);
const current = version();

if (published.has(current)) {
  step(`npm already has ${pkg}@${current} — bumping the rc`);
  run(['npm', 'version', 'prerelease', '--preid', 'rc', '--no-git-tag-version']);
} else {
  step(`npm does not have ${pkg}@${current} yet — publishing it as-is`);
}

const released = version();

step(`Publishing ${pkg}@${released}`);
// --access public so a scoped package does not default to a restricted publish.
// prepublishOnly builds the tarball; no --provenance flag, npm attaches it by
// itself over OIDC wherever the repo is public.
run(['npm', 'publish', '--access', 'public']);

// The lockfile records this package's own version, so skipping the refresh
// leaves the next `bun install --frozen-lockfile` failing in CI.
run(['bun', 'install', '--lockfile-only']);

if (capture(['git', 'status', '--porcelain'])) {
  step(`Committing ${released}`);
  run(['git', 'commit', '-am', `chore: release ${released}`]);
  // HEAD:<branch> so this works from CI's detached checkout as well as locally.
  const branch = process.env.GITHUB_REF_NAME ?? capture(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
  run(['git', 'push', 'origin', `HEAD:${branch}`]);
} else {
  step('Nothing to commit — package.json already held the released version');
}

summary(`### 📦 Published \`${pkg}@${released}\`\n\nhttps://www.npmjs.com/package/${pkg}/v/${released}`);
console.log(`\n✓ published ${pkg}@${released}`);
