/**
 * The repo's CI/CD, in TypeScript. `bun run workflows` renders this file to
 * `.github/workflows/*.yml`; never edit the YAML by hand (CI checks it matches).
 *
 * Two workflows, split by branch rather than by purpose, so the check does not
 * run twice for the same commit:
 *
 *   ci.yml       pull requests. The check job, nothing else.
 *   release.yml  every push to master, plus a manual button (Actions → Release →
 *                Run workflow). The same check, then publish to npm and push the
 *                version commit.
 *
 *                On a push it publishes only when the push touched the package
 *                (`release.ts --if-changed`); a README- or CI-only commit does
 *                not burn a version. A manual run always publishes.
 *
 * Both run on GitHub-hosted `ubuntu-latest` runners — npm rejects OIDC tokens
 * minted on self-hosted ones.
 *
 * npm needs no token at all: the release publishes over OIDC (trusted
 * publishing), configured on npmjs.com against this repo + `release.yml`. That
 * filename is part of the trust config, so publishing has to stay in this
 * workflow or npmjs.com has to be updated to match first.
 */
import { cacheBunStore, checkout, install, setupBun, setupNode, sh, type Runner, type Workflow } from './dsl.ts';

/** GitHub-hosted; also what npm's trusted publishing requires (cloud-hosted only). */
const RUNNER: Runner = 'ubuntu-latest';

/** Trusted publishing needs npm >= 11.5.1 / node >= 22.14.0; node 24 ships npm 11. */
const NODE_VERSION = '24';

const BUN_VERSION = '1.3.11';

const MASTER = 'master';

/**
 * Deep enough for `release.ts --if-changed` to diff the push against its `before`
 * commit. The checkout action's default of 1 has no previous commit to diff
 * against, which makes the gate fail open on every run and do nothing at all.
 */
const DIFF_HISTORY = 100;

/** The gate, shared by both workflows — one place, so a PR runs what a release runs. */
const check = () => [
  checkout(DIFF_HISTORY),
  setupBun(BUN_VERSION),
  cacheBunStore(),
  install(),
  // Cheap and pure-text first, so a drifted workflow fails in seconds.
  sh('Workflows in sync', 'bun run workflows:check'),
  sh("Typecheck", "bun run typecheck"),
  sh("Build", "bun run build"),
];

const ci: Workflow = {
  name: 'CI',
  // Pull requests only. Master pushes are release.yml's, which runs the same check.
  on: { pull_request: { branches: [MASTER] } },
  // One run per branch; a new push cancels the one in flight.
  concurrency: { group: 'ci-${{ github.ref }}', 'cancel-in-progress': true },
  permissions: { contents: 'read' },
  jobs: {
    check: {
      name: 'Check',
      'runs-on': RUNNER,
      'timeout-minutes': 15,
      steps: check(),
    },
  },
};

const release: Workflow = {
  name: 'Release',
  on: {
    push: { branches: [MASTER] },
    // A manual button in the Actions tab; it takes no inputs, so publishing is
    // the only thing it can do.
    workflow_dispatch: {},
  },
  // Never overlap releases, and never cancel one mid-publish.
  concurrency: { group: 'release', 'cancel-in-progress': false },
  // contents: pushing the version-bump commit back to master.
  // id-token: minting the OIDC token npm trades for publish rights.
  permissions: { contents: 'write', 'id-token': 'write' },
  jobs: {
    release: {
      name: 'Publish',
      'runs-on': RUNNER,
      'timeout-minutes': 20,
      if: `github.ref == 'refs/heads/${MASTER}'`,
      steps: [
        ...check(),
        // node is only needed here: `npm publish` is what talks OIDC to the registry.
        setupNode(NODE_VERSION),
        // No NODE_AUTH_TOKEN — setting one sends npm back down the legacy token
        // path and silently skips trusted publishing. release.ts hard-fails if
        // it ever finds one set.
        //
        // Two steps rather than one with an inline ternary: on a push the release
        // is conditional on the package having changed, on a manual run it is not.
        sh('Publish to npm', 'bun scripts/release.ts --if-changed', {
          if: "github.event_name == 'push'",
        }),
        sh('Publish to npm (manual)', 'bun scripts/release.ts', {
          if: "github.event_name == 'workflow_dispatch'",
        }),
      ],
    },
  },
};

/** Filename → workflow. The generator treats this map as the whole of `.github/workflows`. */
export const workflows: Record<string, Workflow> = {
  'ci.yml': ci,
  'release.yml': release,
};
