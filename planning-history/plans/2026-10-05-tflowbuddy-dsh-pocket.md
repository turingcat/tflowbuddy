# TFlowBuddy dsh sync and mobile companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the latest DeepSeek Harness upstream into TFlowBuddy without losing TFlow customizations, then ship dsh-pocket so users can pair a phone by QR code over LAN or an explicitly enabled account-free Cloudflare Quick Tunnel.

**Architecture:** Upstream is merged forward into the fork and conflicts are resolved at the existing TFlow edition/provider/Electron seams. dsh-pocket is pinned as an independent `vendor/dsh-pocket` workspace package and mounted as a normal web-app plugin; it reuses the DSH WebSocket Connection and keeps the DSH server loopback-only while owning the external proxy, PIN, QR, and tunnel lifecycle. Desktop packaging includes the package and its client artifact through the existing package-closure pipeline.

**Tech Stack:** Git merge, pnpm workspaces, Cordis patch manifests, JavaScript ESM vendored plugin, Electron Desktop Host, Node `cloudflared` subprocess management, Vitest/Node tests, generated third-party notices, and existing desktop packaging smoke tests.

**Spec:** `docs/superpowers/specs/2026-10-05-tflowbuddy-dsh-pocket-design.md`

## Global Constraints

- Upstream target is `upstream/master` at `5badb15009ae1756c3afe0ae0cef1faafc290ccc`; do not replace TFlow-owned files with upstream copies without reviewing the diff.
- Pin dsh-pocket to an immutable reviewed revision, preferably release tag `v2.10.6` at `c21a3457a820cb727d0480d8cbf7fa12372fe264`; record the exact source revision actually vendored.
- Preserve the dsh-pocket package name, upstream copyright notices, GPL-2.0 license, and `client/mobile/LICENSE.dsh-web-mobile` MIT notice; do not relabel the package as MIT or rescope it.
- The DSH Web server stays loopback-only; dsh-pocket is the only external listener and must forward HTTP/WebSocket traffic to loopback.
- LAN access is available through a separate LAN PIN; public access is opt-in, requires an explicit disclaimer confirmation, and uses a separate public PIN.
- Quick Tunnel is account-free and temporary; Named Tunnel remains an advanced user-supplied token/hostname path. No shared Cloudflare credential or managed `tflow.online` relay is introduced.
- Desktop disables dsh-pocket self-update/self-restart; Electron owns update and process lifecycle.
- TFlow access tokens, refresh tokens, model keys, keyring records, and raw account responses never cross to the phone client or appear in logs.
- Existing modified icon files under `apps/desktop/resources/` are user-owned changes and must be retained and included in final resource/package verification.
- Do not expose a live public tunnel during automated tests; use mocked `cloudflared` and separately report any explicitly authorized real-phone/public-network check.

## Review Focus

- A partial upstream merge must not silently remove TFlow account/provider/edition behavior; Task 1's merge inventory and Task 7's TFlow regression/build checks pin this.
- An unscoped GPL workspace package must not be rejected, relabeled, omitted from notices, or accidentally published without its source/license; Tasks 2 and 6 add narrow package/release/notice tests.
- A stale dsh-pocket compatibility probe must not mis-detect Desktop and re-enable self-update/restart; Task 4 tests explicit Desktop injection and disabled RPC actions.
- A public Host/Origin or WebSocket upgrade must not bypass PIN or loopback trust; Task 5 tests fail-closed classification, separate PINs, rate limits, and authenticated WebSocket forwarding.
- A tunnel failure or Host disposal must not leave an orphaned `cloudflared` process or a still-valid public route; Task 5 tests cancellation, restart, failure, and cleanup.

---

### Task 1: Prepare and merge the upstream baseline

**Files:**
- Modify: Git history only; create a backup branch/reference before changing `master`.
- Inspect/resolve: all files reported by the upstream merge, with special attention to `apps/desktop/src/tflow/`, `apps/desktop/src/edition.ts`, `apps/desktop/src/paths.ts`, `apps/desktop-host/`, `packages/client/ui-settings-account-tflow/`, and TFlow docs/tests.
- Test: existing focused TFlow and Desktop Host tests selected after the merge.

**Interfaces:**
- Consumes: current `master` at `d4c844a0ef`, `upstream/master` at the pinned SHA, and the TFlow customization inventory in the approved spec.
- Produces: a merge commit whose tree contains upstream `dsh-v0.2.1-alpha.1` behavior plus the retained TFlow edition/provider/account/packaging seams, with no dsh-pocket code yet.

- [ ] **Step 1: Capture the pre-merge state without touching user files.**

  Run:
  ```bash
  git status --short --branch
  git branch backup/pre-dsh-pocket-upstream-20261005 HEAD
  git ls-remote upstream refs/heads/master refs/tags/dsh-v0.2.1-alpha.1
  git diff -- apps/desktop/resources
  ```

  Expected: the seven modified icon resources remain unstaged/unreverted, the three existing untracked `.desktop-build`/`.serena` paths remain untouched, and the remote SHA matches the selected upstream revision.

- [ ] **Step 2: Fetch the complete upstream object with a bounded retry strategy.**

  Use a normal fetch first; if the large sideband transfer disconnects, retry with a temporary alternate object directory or a codeload archive plus `git fetch` of the commit metadata. Verify the object before merging:
  ```bash
  git fetch upstream master --tags
  git cat-file -t 5badb15009ae1756c3afe0ae0cef1faafc290ccc
  git show -s --format='%H %D' 5badb15009ae1756c3afe0ae0cef1faafc290ccc
  ```

  Expected: `commit` and the expected tag decoration; do not treat `git ls-remote` alone as a completed fetch.

- [ ] **Step 3: Merge upstream and resolve only intentional conflicts.**

  Run:
  ```bash
  git merge --no-ff 5badb15009ae1756c3afe0ae0cef1faafc290ccc -m "merge: sync dsh upstream and preserve TFlowBuddy"
  ```

  For each conflict, keep upstream generic changes, reapply TFlow behavior through existing edition/provider/Electron seams, and leave unrelated fork CI/build changes intact. Never use destructive checkout/reset commands on the icon or existing user files.

- [ ] **Step 4: Verify the merge inventory before proceeding.**

  Run focused tests for TFlow auth, account UI, Desktop Host overlay, startup, and existing icon/resource checks. Inspect:
  ```bash
  git diff backup/pre-dsh-pocket-upstream-20261005...HEAD -- apps/desktop/src/tflow apps/desktop/src/edition.ts apps/desktop/src/paths.ts apps/desktop-host packages/client/ui-settings-account-tflow apps/desktop/resources
  ```

  Expected: every TFlow-owned path is either unchanged or has an intentional compatibility edit documented in the merge commit; no dsh-pocket package is present yet.

- [ ] **Step 5: Commit the merge separately from the pocket integration.**

  ```bash
  git add -u
  git commit -m "merge: sync dsh upstream and preserve TFlowBuddy"
  ```

### Task 2: Vendor dsh-pocket at an immutable revision

**Files:**
- Create: `vendor/dsh-pocket/` from the exact reviewed dsh-pocket release source, including `bin/`, `lib/`, `client/`, `cordis.patch.yml`, `README.md`, and `LICENSE`.
- Modify: `pnpm-workspace.yaml` only if the existing `vendor/*` member glob does not already include the package; otherwise no workspace glob change.
- Modify: `vendor/README.md` with a dedicated dsh-pocket manifest row, upstream release SHA, GPL-2.0 terms, and a local-modification log describing only integration changes.
- Test: `vendor/dsh-pocket/test/*.test.js` upstream tests plus a repository vendoring/payload test.

**Interfaces:**
- Consumes: dsh-pocket package `dsh-pocket@2.10.6`, its `dsh.bundle.patch`, and the existing Cordis `connection`/`webServer` services.
- Produces: a workspace package named exactly `dsh-pocket`, with a reproducible client artifact and no dependency on a second DSH runtime.

- [ ] **Step 1: Obtain and verify the release source.**

  Download the tag archive or clone at `c21a3457a820cb727d0480d8cbf7fa12372fe264`, verify the Git object and package version, compare it with the moving `main` snapshot, and copy only the release contents into `vendor/dsh-pocket`.

- [ ] **Step 2: Preserve package metadata and make only repository-required edits.**

  Keep `name: dsh-pocket`, `license: GPL-2.0`, `peerDependencies`, `dsh.client` injections, `files`, README, and both license files. Apply only changes needed for source/artifact policy, explicit Desktop injection, or build compatibility; do not rewrite the package to the Harness MIT/scoped conventions.

- [ ] **Step 3: Run the vendored package tests before integration edits.**

  Run:
  ```bash
  node --test --test-timeout=30000 "vendor/dsh-pocket/test/*.test.js"
  ```

  Expected: upstream proxy/auth/service/tunnel tests pass against the pinned source; failures caused by a changed dsh API are recorded as integration fixes, not hidden.

- [ ] **Step 4: Add an immutable-source/payload regression test.**

  Test that `vendor/dsh-pocket/package.json` has the exact name/license/version, `LICENSE` begins with GPL-2.0 text, `client/mobile/LICENSE.dsh-web-mobile` remains present, and `files` includes the runtime/client assets required by the bundle.

- [ ] **Step 5: Commit the vendor source and manifest record.**

  ```bash
  git add vendor/dsh-pocket vendor/README.md
  git commit -m "vendor: add pinned dsh-pocket mobile companion"
  ```

### Task 3: Make release, workspace, and notices gates understand the direct GPL vendor

**Files:**
- Modify: `scripts/check-workspace-constraints.ts` and its specs for the exact unscoped `dsh-pocket` workspace exception and `workspace:~` dependency range.
- Modify: `scripts/release/families.ts` and release specs so VendorFamily admits only the documented `dsh-pocket` unscoped identity while preserving the `@deepseek-ai/*` rule for all other vendor packages.
- Modify: `scripts/verify-dsh-package-licenses.ts` only if its current DSH-only scan incorrectly includes/excludes the new package; keep all existing MIT enforcement unchanged.
- Modify: `scripts/gen-third-party-notices.ts` and `scripts/gen-third-party-notices.spec.ts` to render a separate GPL vendored section, resolve its dependencies, and keep `assertRuntimeLicenses` fail-closed for all unrelated non-permissive runtime packages.
- Modify: generated `THIRD_PARTY_NOTICES.md` and any narrow release/payload metadata generated by the gates.

**Interfaces:**
- Consumes: `vendor/dsh-pocket/package.json`, `vendor/README.md`, and the package's original license/notice files.
- Produces: passing workspace/release/license/notice gates that explicitly disclose GPL-2.0 dsh-pocket without relabeling it or weakening the general MIT policy.

- [ ] **Step 1: Write failing gate tests.**

  Add cases proving that an exact `vendor/dsh-pocket` row is accepted and disclosed as GPL-2.0, an unrelated unscoped vendor package is still rejected, a missing dsh-pocket manifest row fails notices generation, and an unrelated GPL runtime dependency still fails `assertRuntimeLicenses`.

- [ ] **Step 2: Implement the narrow exception and disclosure model.**

  Use an exact package identity/path check; do not change the global vendor rescope rule or permissive-license allowlist. Preserve dsh-pocket's source directory, upstream repository, upstream name, and license in generated output.

- [ ] **Step 3: Regenerate and verify notices.**

  ```bash
  pnpm run gen-third-party-notices
  pnpm run verify-third-party-notices
  pnpm run verify-dsh-package-licenses
  pnpm run check:workspace
  ```

  Expected: the generated notice names GPL-2.0 dsh-pocket and its runtime dependencies, while all existing MIT vendor rows remain unchanged.

- [ ] **Step 4: Commit the gate changes and generated notice.**

  ```bash
  git add scripts/check-workspace-constraints.ts scripts/check-workspace-constraints.spec.ts scripts/release/families.ts scripts/release/families.spec.ts scripts/verify-dsh-package-licenses.ts scripts/gen-third-party-notices.ts scripts/gen-third-party-notices.spec.ts THIRD_PARTY_NOTICES.md
  git commit -m "build: account for dsh-pocket GPL vendor package"
  ```

### Task 4: Mount dsh-pocket in the Web bundle with explicit Desktop behavior

**Files:**
- Modify: `packages/bundle/web-app/package.json` to declare `dsh-pocket` as a workspace runtime dependency.
- Modify: `packages/bundle/web-app/cordis.patch.yml` to insert the dsh-pocket host/client plugin row after the Web transport services it injects.
- Modify: `vendor/dsh-pocket/lib/index.js` only where needed to accept explicit `internals.isDesktop`/`internals.port`/`internals.home` from the Desktop Host and to disable update/restart on Desktop without probing removed services.
- Modify: `vendor/dsh-pocket/lib/service.mjs`, `lib/proxy.mjs`, or `lib/tunnel.mjs` only for current dsh Connection/WebSocket compatibility and defensive lifecycle behavior; retain the upstream logic otherwise.
- Test: `packages/bundle/web-app/tests/dsh-pocket-composition.spec.ts` and focused vendored service/proxy tests.

**Interfaces:**
- Consumes: `connection.authenticatedUrl`, `webServer.port`, the existing `/api/remote.mux` WebSocket Gateway, and dsh-pocket's `dsh.bundle.patch`/client export.
- Produces: one `dsh-pocket` Cordis row that starts the proxy with the Host, serves its settings UI, and forwards the same WebSocket session transport.

- [ ] **Step 1: Write failing composition tests.**

  Assert that the web bundle patch contains exactly one `dsh-pocket` row, `web-app` declares its runtime dependency, its inject list resolves against the current upstream services, and its client export is present in the assembled browser roster. Add a Desktop composition case where update/restart actions are unavailable but proxy/status actions remain available.

- [ ] **Step 2: Update the bundle manifest and Cordis patch.**

  Add the bare `dsh-pocket` dependency and patch row without changing the TFlow account row or disabling the existing browser modules. Position the row after `webserver`/`connection` providers are available; use the package's own patch only for its browser/client additions.

- [ ] **Step 3: Adapt Desktop detection and current transport contracts.**

  Pass an explicit `isDesktop: true` from the Desktop Host composition. Verify the latest `connection.authenticatedUrl` and Gateway WebSocket route. Keep DSH's server bind at `127.0.0.1`; never replace it with `0.0.0.0`.

- [ ] **Step 4: Add lifecycle and compatibility tests.**

  Test proxy start/stop with a fake WebSocket-capable upstream, public/LAN host classification, `remote.mux` upgrade forwarding, and disposal after an injected start failure. Test that Desktop never invokes dsh-pocket's `update` or `restart` implementation.

- [ ] **Step 5: Run composition and package dependency gates, then commit.**

  ```bash
  pnpm exec vitest run packages/bundle/web-app/tests/dsh-pocket-composition.spec.ts vendor/dsh-pocket/test/*.test.js
  pnpm run verify-cordis-config
  pnpm run verify-client-packages
  pnpm run verify-package-dependencies
  git add packages/bundle/web-app/package.json packages/bundle/web-app/cordis.patch.yml vendor/dsh-pocket
  git commit -m "feat: mount dsh-pocket in the web bundle"
  ```

### Task 5: Implement and test the LAN/Quick Tunnel security and lifecycle contract

**Files:**
- Modify: `vendor/dsh-pocket/lib/index.js`, `lib/service.mjs`, `lib/proxy.mjs`, `lib/tunnel.mjs`, and `lib/web-rpc.js` only for the approved TFlowBuddy Desktop integration and current DSH APIs.
- Test: `vendor/dsh-pocket/test/auth-routing.test.js`, `proxy.test.js`, `service.test.js`, `tunnel-args.test.js`, plus new mocked-`cloudflared` lifecycle tests.
- Modify: `docs/defensive-patterns.md` only if the new subprocess lifecycle establishes a reusable repository rule not already covered.
- Create/modify: the owning user-facing dsh-pocket/TFlowBuddy documentation page for pairing and the temporary-tunnel warning, keeping Chinese UI copy locale-owned.

**Interfaces:**
- Consumes: dsh-pocket RPC endpoints and the Desktop Host's local settings UI; Cloudflare Quick Tunnel output from a mocked `cloudflared` process.
- Produces: LAN QR pairing, explicit public Quick Tunnel start/stop, separate PINs, fail-closed public authentication, bounded subprocess cleanup, and no secret-bearing diagnostics.

- [ ] **Step 1: Pin failing security tests.**

  Cover: unknown Host classified public; public requests require the public PIN even when LAN auth is disabled; LAN and public PINs differ; failed attempts hit the existing rate limit; WebSocket upgrade checks the same auth; `Host`/`Origin` are rewritten to loopback before reaching DSH.

- [ ] **Step 2: Pin failing tunnel lifecycle tests.**

  Use a fake executable/script that emits a Quick Tunnel URL, stalls, exits non-zero, or ignores cancellation. Assert URL discovery, public-PIN rotation behavior, bounded termination, no orphan process, and route invalidation after stop. Do not contact Cloudflare in this test.

- [ ] **Step 3: Implement the minimal integration changes.**

  Keep public access opt-in and disclaimer-protected. Preserve account-free Quick Tunnel invocation, separate PIN files, fail-closed host classification, and WebSocket-only live transport. Ensure cancellation is attached to Cordis disposal and errors contain only classifications, not tokens or full URLs with secrets.

- [ ] **Step 4: Add the user-facing flow and localized copy.**

  The settings tab must distinguish LAN from public access, state that Quick Tunnel needs no Cloudflare account but is temporary and has no uptime guarantee, warn that DSH can execute code, and reserve Named Tunnel fields for advanced users. Public startup cannot occur on application launch.

- [ ] **Step 5: Run focused tests and commit.**

  ```bash
  node --test --test-timeout=30000 "vendor/dsh-pocket/test/*.test.js"
  pnpm exec vitest run vendor/dsh-pocket/test/*.test.js
  git add vendor/dsh-pocket docs
  git commit -m "feat: secure mobile LAN and Quick Tunnel access"
  ```

### Task 6: Include dsh-pocket in Desktop packaging and runtime closure

**Files:**
- Modify: `apps/desktop/scripts/prepare-package-set.ts`, `apps/desktop/src/core-package-set.ts`, and `apps/desktop/scripts/prepare-dsh.ts` only if the existing package-set closure cannot discover the unscoped vendor package or its runtime files.
- Modify: `apps/desktop/scripts/package-target.ts` and `apps/desktop/scripts/desktop-build-paths.mjs` only if a separate dsh-pocket packed input is required; prefer the existing vendor family output.
- Modify: `apps/desktop-host/src/index.ts` to pass explicit dsh-pocket Desktop internals/identity if the composition seam requires it.
- Test: `apps/desktop/tests/package-set.spec.ts`, `apps/desktop-host/tests/edition-overlay.spec.ts`, runtime closure tests, and a package payload assertion for `dsh-pocket/LICENSE`, `client/client.js`, and `cloudflared` download/cache policy.

**Interfaces:**
- Consumes: the packed dsh and vendor tarball directories, the Web bundle dependency graph, and Desktop Host profile `desktop`.
- Produces: a Desktop package set and installed runtime containing dsh-pocket and its client/license assets, with no registry resolution for the packaged core dependency.

- [ ] **Step 1: Write failing closure/payload tests.**

  Assert that the package closure includes `dsh-pocket`, that its tarball contains the runtime/client/license paths, that the package-set descriptor lists it exactly once, and that the prepared runtime can load the Desktop Host composition without resolving it from the registry.

- [ ] **Step 2: Update closure and Host wiring.**

  Add only the dependency/peer handling necessary for the existing closure walk. Pass `isDesktop: true`, the resolved `DSH_HOME`, and the actual Web port through the Host's existing profile composition; do not create a second web server or runtime.

- [ ] **Step 3: Run package and built-runtime smokes.**

  ```bash
  pnpm run prepare:packages
  pnpm run prepare:dsh -- --defer-runtime-smoke
  pnpm exec vitest run apps/desktop/tests/package-set.spec.ts apps/desktop-host/tests/edition-overlay.spec.ts
  ```

  Expected: the descriptor and integrity checks pass, dsh-pocket files are present, and the built Host still uses the TFlow overlay.

- [ ] **Step 4: Commit the packaging integration.**

  ```bash
  git add apps/desktop/scripts apps/desktop/src/core-package-set.ts apps/desktop-host/src/index.ts apps/desktop/tests apps/desktop-host/tests
  git commit -m "build: package dsh-pocket in TFlowBuddy Desktop"
  ```

### Task 7: Preserve and verify TFlow branding, icons, and release behavior

**Files:**
- Modify: the seven existing resources under `apps/desktop/resources/` only by staging the user's already-created icon changes; do not regenerate them from old source art.
- Test: `apps/desktop/tests/main-startup.spec.ts`, `apps/desktop-host/tests/edition-overlay.spec.ts`, desktop resource/payload checks, and existing TFlow account tests.
- Modify: owning TFlow release/verification docs if the final package contents or user pairing path changes their current contract.

**Interfaces:**
- Consumes: the merged upstream tree, dsh-pocket-enabled Desktop runtime, and existing TFlow edition overlay.
- Produces: a release candidate whose visible identity remains TFlowBuddy and whose packaged icons, protocol, paths, account surface, and mobile companion coexist.

- [ ] **Step 1: Add/adjust failing resource assertions.**

  Assert that every icon resource is included in the intended platform payload, that the app ID/protocol/home remain TFlow values, and that the Desktop overlay still disables the official DeepSeek account/model rows while retaining TFlow account rows.

- [ ] **Step 2: Stage the user's icon changes with no binary rewrite.**

  ```bash
  git add apps/desktop/resources/icon-macos.png apps/desktop/resources/icon-tflowbuddy.icns apps/desktop/resources/icon-tflowbuddy.ico apps/desktop/resources/icon-tflowbuddy.png apps/desktop/resources/icon-windows.png apps/desktop/resources/icon.png apps/desktop/resources/logo-tflowbuddy.png
  ```

- [ ] **Step 3: Run focused startup and resource checks.**

  ```bash
  pnpm exec vitest run apps/desktop/tests/main-startup.spec.ts apps/desktop-host/tests/edition-overlay.spec.ts apps/desktop/tests/tflow-*.spec.ts
  git diff --cached --check
  ```

- [ ] **Step 4: Commit branding/resource preservation.**

  ```bash
  git commit -m "feat: ship refreshed TFlowBuddy icon resources"
  ```

### Task 8: Full focused verification, documentation, and handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-10-05-tflowbuddy-dsh-pocket-design.md` only for factual corrections discovered during implementation; do not turn it into a status log.
- Modify: the owning user documentation/README and any required upgrade guide for the new phone-access setting and GPL-distributed component.
- Test: all focused suites and gates listed below; manual LAN phone acceptance artifact stays outside source control unless the repository has an existing evidence location.

**Interfaces:**
- Consumes: all prior task commits and the approved design/plan.
- Produces: a reproducible verification report distinguishing automated, mocked, physical-phone, and public-network evidence.

- [ ] **Step 1: Run source-plane and package gates.**

  ```bash
  pnpm run typecheck
  pnpm run lint
  pnpm run verify-cordis-config
  pnpm run verify-client-packages
  pnpm run verify-package-dependencies
  pnpm run verify-third-party-notices
  pnpm run doc-sync
  pnpm run test:docs
  ```

- [ ] **Step 2: Run focused behavior and composition tests.**

  ```bash
  pnpm exec vitest run vendor/dsh-pocket/test/*.test.js packages/bundle/web-app/tests apps/desktop/tests apps/desktop-host/tests
  pnpm run test:snapshot
  ```

  Select the affected owner-local/keyless snapshot after the composition test identifies its owner, then rerun only that named snapshot if the repository supports filtering. Report the exact snapshot command and result; do not claim a snapshot passed if no affected snapshot exists.

- [ ] **Step 3: Run the supported desktop build smoke.**

  Use the existing unsigned macOS arm64 workflow available on the current machine and the repository's Windows x64/Wine or CI-owned path where applicable. Verify the prepared payload includes dsh-pocket, the TFlow icons, GPL license, and mobile client bundle.

- [ ] **Step 4: Perform manual LAN acceptance on a real phone.**

  Start TFlowBuddy, open Settings → 手机访问, scan the LAN QR code from a phone on the same Wi-Fi, enter the LAN PIN, send/observe one session action, and confirm desktop and phone show the same live stream. Record platform/build and result without recording credentials.

- [ ] **Step 5: Perform public Quick Tunnel acceptance only with explicit test authorization.**

  Start the tunnel from the settings confirmation, scan the public QR code from a different network, verify public PIN enforcement and WebSocket streaming, stop the tunnel, and verify the old URL no longer works. Report this separately from automated evidence; if not authorized or network conditions fail, state that clearly rather than substituting a local test.

- [ ] **Step 6: Review history and finish with one integration commit or the repository's approved stacked-commit flow.**

  ```bash
  git status --short --branch
  git diff origin/master...HEAD --stat
  git log --oneline --decorate --max-count=12
  ```

  Confirm the three existing untracked user/tooling paths were not added accidentally, all intended icon changes are committed, generated notices are current, and the final report lists only commands actually run.
