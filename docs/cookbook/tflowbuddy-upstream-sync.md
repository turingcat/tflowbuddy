# Synchronizing TFlowBuddy with dsh

English | [中文](tflowbuddy-upstream-sync.zh.md)

## Scope

Import code differences through a product synchronization branch without importing upstream commit ancestors. Keep upstream in a separate checkout. The root product version remains independent; licenses and source attribution remain intact.

## Import

1. Start on clean product `main`. Read `.upstream/dsh.json` for the last imported revision.
2. Fetch the requested upstream branch in the separate source checkout. Review the upstream change range before choosing its target.
3. Run the preparation command in the product checkout:

```sh
pnpm run upstream:sync --upstream-dir ../deepseek-harness-source --target origin/master --branch sync/dsh-20261008
```

4. Review the staged changes, including branding, account integration, repository instructions, workflow settings, deletions, and package dependencies. The tool does not protect customized files by silently skipping them.
5. Run `pnpm install --lockfile-only --ignore-scripts` if dependencies changed, then `pnpm run product:version:check` and the affected tests. Stage the resulting lockfile and records.
6. Commit imported code and `.upstream/dsh.json` together. Push only the product sync branch, open a PR against `main`, and merge after review and checks. Do not merge upstream refs or use `--allow-unrelated-histories`.

## Conflicts

An apply failure retains its branch and index and leaves the upstream record unchanged. Inspect `git diff --name-only --diff-filter=U`, resolve and stage each file, and preserve the root product version with `pnpm run product:version:set <product-version>`. After all conflicts are resolved, update the record to the verified full target revision from the separate upstream checkout, regenerate affected outputs, check versions, and test before committing. Missing base files, upstream history rewrites, and submodule changes require explicit review rather than automatic completion.

The tool requires a clean checkout on `main` and a new `sync/` branch name. Re-importing the recorded revision does nothing. To abandon work, first explicitly preserve or discard the conflicted changes; the tool never resets or cleans the working directory for you.
