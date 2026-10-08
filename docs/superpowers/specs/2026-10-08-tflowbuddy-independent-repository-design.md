# TFlowBuddy Independent Repository Design

English | [中文](2026-10-08-tflowbuddy-independent-repository-design.zh.md)

## Status

Proposed migration, approved in conversation but not yet implemented. This specification requires review before the implementation plan is written.

## Goal

Give TFlowBuddy its own Git history and release numbering while retaining the ability to import DeepSeek Harness changes through reviewed synchronization branches. Upstream commit authors must not enter the new default branch through imported Git history. Copyright and license attribution remain intact.

## Repository migration

Rename the existing public repository from `turingcat/tflowbuddy` to `turingcat/tflowbuddy-legacy`. Create a new public, non-fork repository at `turingcat/tflowbuddy` with `main` as its default branch. Preserve the legacy repository, its branches, tags, releases, issues, and configuration; do not delete it or rewrite its history.

Use the committed product snapshot associated with `v0.1.1` as the code source. Include the approved migration documentation and tooling as explicit additions. Exclude uncommitted changes, untracked files, ignored files, build outputs, and credentials. Export tracked files without the old `.git` directory, preserving executable modes and symlinks. Inspect tracked files for credentials and files exceeding GitHub upload limits before any upload.

Initialize the exported directory with one parentless commit authored by the configured maintainer. Do not copy old tags, branches, or Git objects. The old repository's releases and issues remain at the legacy repository; the new repository does not represent them as newly created project history.

Prepare and verify the export before renaming either repository. Back up the old Git refs, local uncommitted changes, and repository settings outside the exported directory. Stage the new checkout beside the existing checkout, without replacing the current working directory. After verification, configure its `origin` to the new repository and the existing checkout's `origin` to the legacy repository. Existing local changes remain in the existing checkout.

## Upstream synchronization

Keep a separate upstream checkout of `deepseek-ai/deepseek-harness`. Do not push upstream refs to the new product repository. A synchronization record identifies the upstream repository and the exact last imported commit. The initial record uses the verified upstream ancestor already integrated into the product snapshot, not an arbitrary latest upstream revision.

For each update, fetch upstream and verify that the recorded base and requested target exist. Reject a target that does not descend from the recorded base unless a maintainer explicitly resolves the upstream history change. Create `sync/dsh-<date>` from the current TFlowBuddy `main`.

Generate the upstream tree difference between the recorded base and requested target, including additions, deletions, executable modes, binary files, and symlinks. Apply that difference to the product synchronization branch with three-way conflict handling when base objects are available. Missing base content or conflicts stop automatic completion; never resolve them by replacing the entire product tree with upstream.

Commit imported code as new product commits, without upstream parent commits or automatic upstream co-author trailers. Record the source revision for attribution and repeatability. Fetching upstream into a separate checkout does not import its ancestry into `main`.

Preserve product-owned release numbering, branding, account integration, distribution settings, and repository instructions during conflict resolution. Do not skip whole package manifests: import applicable dependency and configuration changes, then restore the product version fields. Regenerate affected lockfiles and generated records using their owning tools.

Run relevant tests and review the synchronization diff before merging its PR into `main`. Update the synchronization record in the same import commit, so code and its recorded base merge together. A second synchronization at the same target must produce no upstream changes. Product changes after the last import must survive a subsequent non-conflicting import.

## Independent versions

The initial product version is `0.1.1`. The root manifest, Desktop application, and first-party workspace packages share the TFlowBuddy version. Future versions follow product releases, not upstream release tags. Importing a dsh update does not automatically change the product version.

New first-party packages receive the current product version. Version checks cover private and publishable first-party packages and reject mismatches before packaging. The version-update operation can repair imported mismatches rather than refusing to run before normalization.

Third-party dependencies, vendored package versions, interpreter versions, Electron versions, Session format versions, and SQLite schema versions retain their independent meanings. This migration does not rename `@deepseek-ai/dsh-*` packages or change CLI entry points. Historical references to upstream releases remain factual references, not the product release version.

Product releases use `v<product-version>` tags. Release tag checks, installed Desktop identity, bundled runtime metadata, and installer filenames must agree on the full version string.

## GitHub configuration and release handling

Inventory repository settings, Actions permissions, variables, secret names, branch rules, and release assets before migration. Secret values are not recoverable through GitHub's API. Do not copy credentials from unrelated local services or claim that secrets migrated because their names were listed.

Keep Actions disabled in the new repository during its initial upload and configuration review. Adapt supported push and pull-request workflows to `main`. Do not activate inherited self-hosted runner lanes without matching registered runners, scheduled real-provider tests without their required credentials, or deployment workflows targeting upstream infrastructure.

Document intentionally inactive workflows and the prerequisites for enabling them. Retain tests and their failure signal; do not weaken assertions or mark failing tests successful to complete migration. Existing unrelated test failures remain reported separately.

The failed legacy `v0.1.1` run is not a successful product release. Repository migration can finish independently of repairing packaging. Do not publish the new repository's `v0.1.1` tag until the packaging failures are repaired and verified in a separately scoped change. The new repository may use the same version because no successful legacy `0.1.1` release was established, but its eventual tag points only to new product history.

## Verification

- Compare exported files, modes, and symlinks with the approved snapshot; allow only documented migration additions and edits.
- Verify the new repository is not a fork, its default branch is `main`, and the initial commit has no parents.
- Verify the new default branch does not contain the upstream base as an ancestor and no old upstream branches or tags were pushed.
- Test upstream import with non-conflicting changes, product edits, conflicts, additions, deletions, binary files, version changes, and a repeated identical target.
- Verify version normalization preserves third-party and persistence-format versions, updates new first-party packages, and rejects a mismatched release tag.
- Run focused synchronization tests, version checks, desktop packaging tests, build and packed-runtime checks, and applicable documentation checks.
- Verify legacy repository identity is preserved after rename, new repository identity differs, remote URLs are correct, and local uncommitted files remain unchanged.
- Confirm Actions configuration and report release jobs as pending, failed, or successful from current GitHub evidence.

GitHub contributor displays can refresh asynchronously. Validate Git ancestry immediately; do not promise that every contributor UI updates at upload time.

## Recovery

Stop before renaming when export verification, credential inspection, or backups fail. If the old repository was renamed but new repository creation fails, retain the old repository at the legacy name until its original name is available and a safe rename-back is possible. If initial upload fails, retry the prepared export without deleting the legacy repository.

If the new repository exists and later verification fails, leave both repositories intact, disable affected Actions, and report the exact incomplete step. Do not automatically delete a repository, force-push rewritten history, move release tags, or overwrite the original checkout.

## Non-goals

This migration does not conceal code attribution, rename all packages, repair existing desktop packaging or other inherited CI failures, migrate every GitHub issue or release, or replace upstream dependency licenses. These changes require separate scope and verification.
