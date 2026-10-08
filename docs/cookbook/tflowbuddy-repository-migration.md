# TFlowBuddy Repository Migration

English | [中文](tflowbuddy-repository-migration.zh.md)

## Repository ownership

The migration preserves the old repository as `tflowbuddy-legacy` and uploads a parentless product snapshot to a new public `turingcat/tflowbuddy` repository on `main`. Backups and the old working directory remain separate; local modifications, credentials, old tags, and old commit objects are not uploaded. The product version is `0.1.1`; migration does not publish a release tag.

## Workflow prerequisites

Only CI, Sandbox, Node Addon System, and Release TFlowBuddy Desktop are eligible for enablement after configuration review. CI uses GitHub-hosted runners. Existing test failures remain failures. Desktop publication remains blocked by the separately tracked Electron 40 native-runtime and Windows ia32 build failures.

The inherited standby workflow requires matching self-hosted infrastructure. Real-provider E2E workflows require their documented API secrets. Preview and deployment workflows require product-owned hosting and credentials. Issue and weighted-approval workflows require a reviewed project policy and any referenced applications or credentials. These workflows remain disabled during migration; listing secret names is not migrating secret values.

## Verification and recovery

Before rename, verify backups, exported bytes, modes, symlinks, credential scans, and file sizes. Disable new-repository Actions before its first push. Push only `main`, verify distinct repository identities, a parentless initial commit, remote equality, and unchanged original local modifications. Contributor UI refresh may lag behind Git ancestry verification.

If any external step fails, retain both repositories and record the last completed step. Do not delete a repository, force-push, move release tags, or overwrite the original checkout. A rename-back is considered only when the original name is unoccupied. Follow the [synchronization procedure](tflowbuddy-upstream-sync.md) for future upstream imports.
