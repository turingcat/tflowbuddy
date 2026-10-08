# TFlowBuddy Independent Repository Implementation Plan

English | [中文](2026-10-08-tflowbuddy-independent-repository.zh.md)

> **For agentic workers:** Use `executing-plans` for inline execution or `subagent-driven-development` if the user selects delegated execution. Complete tasks in order; do not rename repositories before Task 4 passes.

**Goal:** Create an independent public TFlowBuddy repository with product version `0.1.1` and reviewed upstream code imports that do not import upstream commit ancestry.

**Architecture:** Prepare migration tools and verify an exported snapshot before external changes. Keep upstream Git history in a separate checkout; import binary-capable patches into product-owned synchronization branches. Preserve the original checkout and repository as legacy records.

**Tech Stack:** Node.js ESM, TypeScript through the existing tsx launcher, Git, pnpm, Vitest, GitHub CLI, GitHub REST API.

**Spec:** [Approved independent repository design](../specs/2026-10-08-tflowbuddy-independent-repository-design.md).

## Global Constraints

- New repository: public `turingcat/tflowbuddy`; default branch: `main`; old repository: `turingcat/tflowbuddy-legacy`.
- Initial product version: `0.1.1`; all first-party root, application, and package manifests agree; vendor, dependency, interpreter, Electron, Session, and schema versions remain independent.
- Export the committed `v0.1.1` code snapshot plus explicitly approved migration changes; do not copy local modifications, ignored files, credentials, old refs, or Git history.
- Preserve licenses, copyright, executable modes, symlinks, and the original working directory. Do not force-push, delete repositories, or move tags.
- No initial release tag; existing Electron 40 and Windows ia32 packaging failures are separate work.
- Keep Actions disabled during upload and configuration review; do not enable unavailable runner pools, credential-dependent scheduled tests, or upstream deployments.
- Source imports commit both code and the new upstream revision record; conflicts never advance that record.

## Review Focus

- A renamed repository may collide with an existing name or an unexpected repository identity; verify names and IDs before each external mutation and stop on mismatch.
- A binary, deleted file, executable mode, or symlink may be lost by text-only copying; compare Git tree entries and test binary-capable import.
- Concurrent edits or unresolved conflicts may invalidate a prepared import; require a clean tree, reject existing synchronization state, and retain conflict evidence without advancing the base.
- New private packages and dependency changes may arrive with upstream versions; normalize only first-party version fields while preserving imported dependency edits.
- Inherited workflows may queue forever or fail without secrets; test runner labels, branch triggers, and inactive workflow configuration before enabling Actions.

## File Ownership

- `scripts/product-version.ts` owns first-party version discovery, checking, and normalization; `scripts/product-version.spec.ts` owns its regression cases.
- `scripts/upstream-sync.ts` owns the explicit upstream import command; `scripts/upstream-sync.spec.ts` owns temporary Git repository integration fixtures.
- `.upstream/dsh.json` records the last imported upstream revision and repository; it does not store credentials or release versions.
- `scripts/tests/tflowbuddy-workflows.spec.ts` validates the new repository's workflow policy; existing desktop release tests continue to own installer behavior.
- `docs/cookbook/tflowbuddy-upstream-sync.md` and its bilingual pair own the maintainer procedure; the root instructions link it rather than restating it.
- `docs/cookbook/tflowbuddy-repository-migration.md` and its bilingual pair own the operational migration and recovery procedure.

## Task 1: Product Version Ownership

**Files:** Create `scripts/product-version.ts` and `scripts/product-version.spec.ts`; modify `package.json`, `scripts/release/bump.ts`, `.github/workflows/release.yml`, and `scripts/tests/desktop-release.spec.ts`; add the corresponding maintainer documentation in Task 3.

**Interfaces:** Export `checkProductVersions(root: string, tag?: string): string` and `normalizeProductVersions(root: string, version: string): string[]`. The checker returns the root product version or throws with mismatched paths. The normalizer validates an explicit complete version, rewrites only changed first-party manifest version fields, and returns changed paths.

- [ ] Write a failing fixture test with root/Desktop version `0.1.1`, a private first-party package at `0.2.1-alpha.1`, and vendor version `2.10.6`. Assert checking throws; normalization changes the private package to `0.1.1` without changing vendor or dependency versions. Add a newly introduced publishable package and assert it is normalized too.
- [ ] Run `pnpm exec vitest run scripts/product-version.spec.ts` and confirm failure comes from the absent implementation.
- [ ] Discover only `package.json`, `apps/*/package.json`, and `packages/*/*/package.json`; use the existing release-family manifest ownership rather than including fixtures, native packages, or `python/sdk-runtime`. Preserve formatting and exactly one trailing newline. Validate prerelease versions and reject invalid input before writes.
- [ ] Add tests that `checkProductVersions(root, 'v0.1.1')` succeeds and `checkProductVersions(root, 'v0.1.2')` throws. Assert normalization preserves an imported dependency addition and does not rewrite Session or schema files.
- [ ] Add `product:version:check` and `product:version:set` scripts using `tsx scripts/product-version.ts check` and `tsx scripts/product-version.ts set`. CLI commands require a version argument for `set`; they never infer the version from upstream. Remove the dsh bump path's pre-normalization mismatch refusal, while retaining vendor-family checks and existing bump tests.
- [ ] Add `pnpm run product:version:check` before release build and packaging steps. The existing release workflow retains its exact tag/full-version verification. Test both the ordering and rejection of a mismatched private manifest.
- [ ] Run `pnpm exec vitest run scripts/product-version.spec.ts scripts/release/families.spec.ts scripts/tests/desktop-release.spec.ts`, then `pnpm run product:version:check`. Commit only this task's changes after reviewing hook-generated files.

Use these assertions inside an owned temporary manifest fixture; `root` contains the manifests described in the first step:

```typescript
expect(() => checkProductVersions(root)).toThrow('packages/example/private/package.json')
expect(normalizeProductVersions(root, '0.1.1')).toContain('packages/example/private/package.json')
expect(checkProductVersions(root, 'v0.1.1')).toBe('0.1.1')
expect(() => checkProductVersions(root, 'v0.1.2')).toThrow()
expect(JSON.parse(readFileSync(join(root, 'vendor/example/package.json'), 'utf8')).version).toBe('2.10.6')
```

## Task 2: History-Free Upstream Import

**Files:** Create `scripts/upstream-sync.ts`, `scripts/upstream-sync.spec.ts`, and `.upstream/dsh.json`; modify `package.json` and narrowly adapt `scripts/verify-repository-references.ts` with its tests for the machine-owned revision record.

**Interfaces:** Export `prepareUpstreamImport(productRoot: string, upstreamRoot: string, target: string, branch: string): Promise<{ changed: boolean; base: string; target: string; branch: string }>`; it prepares changes but does not commit, push, open a PR, or merge. CLI: `pnpm run upstream:sync --upstream-dir <directory> --target <revision> --branch sync/dsh-<date>`. Read `.upstream/dsh.json` fields `repository` and `revision`; the revision is an exact full commit ID, verified in the separate upstream checkout.

- [ ] Create isolated temporary Git repositories in a Vitest fixture with explicit author identity. Record a base containing a file shared with product; upstream adds a line and product changes a different file. Assert the import updates upstream content, retains the product edit, and does not make the upstream commit an ancestor of the product branch. Register recursive temporary-directory cleanup immediately and await every child command.
- [ ] Run `pnpm exec vitest run scripts/upstream-sync.spec.ts` and confirm the missing implementation fails.
- [ ] Resolve base/target only in the upstream checkout with `git rev-parse --verify <revision>^{commit}`. Validate ancestry using `git merge-base --is-ancestor`. Require the product to have a clean index and working tree, be on `main`, and have no merge/rebase in progress; reject an existing requested branch. Fetching upstream is an explicit preceding runbook step, not an implicit product fetch.
- [ ] Generate `git diff --binary --full-index <base> <target>` in the separate checkout. Import only required base blobs into the product object database with `git cat-file blob <id>` and `git hash-object -w --stdin`; never fetch or copy commit objects. Apply the patch using the existing Git index with `git apply --3way --index`, using shell-free argument arrays and binary-safe I/O. Verify fixtures where base content differs locally, files are added/deleted, a binary file changes, and a symlink or executable mode changes.
- [ ] On conflict, stop, preserve the branch and unresolved index, report paths, and leave the synchronization record unchanged. Do not normalize versions or write a completion record after an apply failure. Document manual conflict completion and record update only after all conflicts are resolved and reviewed.
- [ ] On success, call `normalizeProductVersions(productRoot, originalProductVersion)`, stage normalized manifests, and update `.upstream/dsh.json` in the same pending change. Do not skip package manifests or overwrite branding/instructions automatically. The maintainer reviews these changes before committing.
- [ ] Test repeated identical targets as a clean no-op without creating a branch; test divergent upstream history, dirty product state, invalid revision, already existing branch, deleted locally customized files, and apply conflicts. Assert every rejection leaves the base record unchanged. Test an upstream release bump plus a new private package and dependency addition.
- [ ] Establish the initial revision using `git merge-base v0.1.1 upstream/master` and verify it is an ancestor of the approved snapshot; do not choose the latest fetched revision merely because it exists. Record the verified value without embedding a historical commit literal in this plan.
- [ ] Add an exact path exemption for the validated revision field in `.upstream/dsh.json` to the repository-reference checker. Retain all other checks; test that an invalid record, an arbitrary second SHA field, and commit references in another maintained file remain rejected when the object exists.
- [ ] Run `pnpm exec vitest run scripts/upstream-sync.spec.ts scripts/product-version.spec.ts scripts/verify-repository-references.spec.ts`. Commit the sync tool and initial record only after fixture ancestry assertions pass.

## Task 3: Repository Workflow Policy and Maintainer Instructions

**Files:** Modify `.github/workflows/ci.yml`, `.github/workflows/ci-master.yml`, `.github/workflows/sandbox.yml`, `.github/workflows/node-addon-system.yml`, `scripts/ci-workflow.spec.ts`, `scripts/tests/ci-master-platforms.spec.ts`, `AGENTS.md`, and affected Desktop release-version documentation; create `scripts/tests/tflowbuddy-workflows.spec.ts` and the two cookbook bilingual pairs named in File Ownership.

**Interfaces:** The new repository enables only `CI`, `Sandbox`, `Node Addon System`, and the desktop release workflow after configuration review. Other workflows remain disabled through GitHub's workflow API and are listed with their enabling prerequisites in the migration runbook. The old `ci-master.yml` standby workflow remains disabled until matching infrastructure exists.

- [ ] Write a failing YAML policy test asserting that supported push filters use `main`, active PR jobs use available GitHub-hosted labels, and `release.yml` checks product versions before packaging. Keep installer behavior assertions in the existing desktop release suite.
- [ ] Run `pnpm exec vitest run scripts/tests/tflowbuddy-workflows.spec.ts` and confirm the old labels/branch filters fail.
- [ ] Replace inherited custom enterprise/self-hosted runner selection in active `ci.yml` jobs with target-appropriate hosted runners (`ubuntu-24.04`, `windows-2025`, `macos-15`). Preserve job steps, timeouts, and tests; lower worker concurrency through existing configuration if host memory requires it. Replace supported master push filters in Sandbox and native-addon workflows with `main`; do not blindly rewrite historical documentation.
- [ ] Update existing workflow-test expectations only where the approved runner and branch policy changes behavior; preserve assertions about test lanes, isolation, and failure reporting. Run `pnpm exec vitest run scripts/ci-workflow.spec.ts scripts/tests/ci-master-platforms.spec.ts scripts/tests/tflowbuddy-workflows.spec.ts` together.
- [ ] Keep E2E, pi-ai E2E, deployment, preview, weighted-approval, issue automation, and standby workflows inactive at migration. List credentials, installed apps, runner provisioning, or policy review required for each. Do not weaken key preflight checks or self-skip active required checks to claim green.
- [ ] Update root instructions to name product-owned versions and require the history-free sync procedure. Update affected README/JSDoc statements that require Desktop to use an upstream release version. Leave historical version references, package names, and frozen Agent Notes unchanged.
- [ ] Write the synchronization runbook with explicit steps: clean `main`, fetch upstream in its separate checkout, run `upstream:sync`, review product-owned files, regenerate the lockfile, run focused tests, commit code and revision together, push the sync branch, open a PR against `main`, and merge only after review/checks. State that direct upstream merge and `--allow-unrelated-histories` violate this procedure.
- [ ] Document conflict recovery: inspect `git diff --name-only --diff-filter=U`, manually resolve and stage files, preserve product versions, update the record to the previously verified target, run checks, then commit. Do not automate destructive cleanup. Document abandoning the branch by switching to clean `main` only after the maintainer preserves or discards conflict work explicitly.
- [ ] Record bilingual pairs with `pnpm run verify-translation-pairing --write` followed by each source path. Run focused workflow tests, `pnpm run test:docs`, `pnpm run doc-sync`, `pnpm run lint`, and `git diff --check`; distinguish new findings from known baseline failures. Commit only the approved changes.

## Task 4: Backup and Verify the Prepared Export

**Files:** Create operational backups outside the repository at `/Users/turingcat/Project/TFlowBuddy-migration-backup-20261008`; prepare the new checkout at `/Users/turingcat/Project/TFlowBuddy-independent`. Never overwrite an existing directory at either path.

**Interfaces:** A migration manifest records the original repository ID, original refs, product snapshot, approved migration commits, export tree entries, original status, and completed steps. The manifest and backups stay outside the uploaded repository; they may contain sensitive settings and use owner-only permissions.

- [ ] Stop if either destination already exists, if the GitHub account lacks repository admin rights, or if `tflowbuddy-legacy` already exists. Re-query old repository identity immediately before later rename; do not rely on this session's cached values.
- [ ] Create the backup directory with restrictive permissions. Run `git bundle create <backup>/legacy.bundle --all` and `git bundle verify <backup>/legacy.bundle`. Verify referenced commit/tree/blob objects are available despite the old checkout's partial-clone configuration; if missing, hydrate the required source objects or retain a verified mirror before proceeding.
- [ ] Save `git status --porcelain=v1 -z`, `git diff --binary`, `git diff --cached --binary`, and a local-only copy of the existing untracked paths. Do not upload those copies. Save repository/settings, Actions permissions, variables, secret names, branch rules, workflow states, releases, and asset inventories using `gh api`; do not log request headers or secret values. If an API is unsupported, record that explicitly instead of inventing an empty result.
- [ ] Export the approved source tree using `git archive --format=tar <approved-head>` into the new empty directory. Verify every difference from `v0.1.1` is an approved Task 1-3 or migration-document change. Do not copy the original working tree wholesale.
- [ ] Check exported contents for tracked credentials and oversized files; use an installed secret scanner with redacted output and inspect tracked configuration names. Check for Git LFS pointers and attributes: hydrate and validate required LFS content or stop for a documented handling decision. Inspect files at or above GitHub's 100 MiB limit before upload.
- [ ] Compare exported file bytes, symlink targets, and executable modes with `git ls-tree -rz <approved-head>`. Test the comparison against a changed file, missing binary, changed symlink, and changed executable bit using a temporary export; it must reject all four.
- [ ] Initialize with `git init -b main`, configure the maintainer identity from the original checkout, stage the export, and create one initial commit. Run `git rev-list --count main` (expect `1`), `git rev-list --parents -n 1 main` (expect no parent), and `git show-ref --tags` (expect no tags). Confirm no original or upstream commit objects were imported.
- [ ] Run `pnpm install --frozen-lockfile`, the focused product-version/sync/workflow/desktop tests, `pnpm run product:version:check`, `pnpm run build:official`, and `pnpm run release:pack --family dsh --out <backup>/packed-dsh` in the new checkout. Do not trigger full installer packaging. Investigate a new failure before repository mutation; report unchanged known baseline failures separately.

## Task 5: Rename, Publish, and Verify GitHub State

**Files:** Update only local Git remote configuration and the external migration manifest; retain the existing checkout and all its local changes.

**Interfaces:** The verified export becomes the new repository's sole `main` history. The original repository ID remains assigned to `tflowbuddy-legacy`; the new repository receives a different ID.

- [ ] Verify GitHub names and repository ID again. Rename using `gh api --method PATCH repos/turingcat/tflowbuddy -f name=tflowbuddy-legacy`; verify the returned ID matches the backup. Do not archive the old repository automatically or interrupt running jobs without an explicit reason.
- [ ] Create the new empty repository using `gh repo create turingcat/tflowbuddy --public --description 'TFlowBuddy desktop AI assistant'`. Do not import, fork, initialize a README, or use a command that pushes immediately.
- [ ] Disable Actions before the first push with `gh api --method PUT repos/turingcat/tflowbuddy/actions/permissions -F enabled=false`. If the API fails, stop without uploading. Confirm the new ID differs from legacy and `fork` is false.
- [ ] Add `origin` to the prepared checkout and push only `main` using `git push -u origin main`. Do not use `--mirror`, `--all`, or `--tags`. Set the default branch using `gh repo edit turingcat/tflowbuddy --default-branch main`.
- [ ] Inventory the newly registered workflow IDs, disable every workflow, then enable only the Task 3 allowlist. Restore repository-level Actions enablement with read-only default token permissions and reviewed action policy. Verify inactive workflows remain disabled before enabling any scheduled work. Do not copy legacy secret values or unsupported custom-runner variables.
- [ ] Point the original checkout's `origin` explicitly to `https://github.com/turingcat/tflowbuddy-legacy.git`. Keep the prepared checkout's `origin` at `https://github.com/turingcat/tflowbuddy.git`; keep upstream only in its separate source checkout for synchronization. Do not move or overwrite either local directory.
- [ ] Verify remote main equals prepared local main, repository IDs and default branch are correct, no legacy tags or branches were pushed, and the initial commit is parentless. Compare original working-tree status and local changes with the backup. Query contributors but treat UI refresh latency separately from ancestry verification.
- [ ] Query Actions runs and report actual pending/failure/success states. Do not push `v0.1.1` or claim installers exist. Report new and legacy URLs, new working directory, backup path, disabled workflows, unavailable secrets, known CI failures, and the next upstream sync command.
- [ ] On failure, save the last successful step and leave both repositories intact. If rename succeeded but creation failed, consider rename-back only after checking the original name is unoccupied. Do not delete the new repository, force-push, or overwrite local files as automatic recovery.

## Execution Handoff

The approved specification determines behavior; this plan determines execution order. Review this plan before implementation. Inline execution is recommended because the repository rename, source snapshot, backup manifest, and remote verification share sequential external state. Delegated task-by-task execution remains available if explicitly selected.
