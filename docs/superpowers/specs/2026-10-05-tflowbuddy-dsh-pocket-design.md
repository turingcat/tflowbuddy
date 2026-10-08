# TFlowBuddy upstream sync and mobile companion design

> Status: design approved in conversation; implementation starts only after this document is reviewed and an implementation plan is approved.

> Date: 2026-10-05

## 1. Intent and acceptance criteria

TFlowBuddy will follow the latest `upstream/master` DeepSeek Harness release while retaining the fork's TFlow account, provider, desktop-edition, packaging, branding, and data-directory customizations. It will also ship dsh-pocket as an embedded plugin so a user can scan a QR code with a phone and operate the same desktop DSH sessions, including live streamed output and interactive controls.

The ordinary path must not require a Cloudflare account, a domain, a command line, or a separate server. A user on the same network can use a LAN QR code. A user who explicitly enables remote access can use a temporary Cloudflare Quick Tunnel without creating a Cloudflare account. The fixed-domain Named Tunnel path remains an advanced option for users who bring their own Cloudflare account, domain, and tunnel token.

Success means that a clean TFlowBuddy desktop build starts with the retained TFlow experience, the mobile companion is available in the settings surface, LAN QR access reaches the same sessions, Quick Tunnel access reaches the same sessions from another network, and no TFlow credential is sent to the phone client.

The current user-provided TFlowBuddy icon asset changes remain part of the release work and must be included in the final desktop resource validation; they are not to be reverted or regenerated from the old artwork.

## 2. Upstream synchronization

The synchronization uses a merge of the selected latest `upstream/master` snapshot into the TFlowBuddy branch, not a replacement of the fork with upstream files. Before the merge, the implementation records a backup reference and inventories the TFlow-specific diff. Conflicts are resolved by retaining the upstream behavior where it is generic and reapplying TFlow behavior at the existing edition, provider, account, credential, Electron IPC, path, and packaging seams.

The merge must preserve, or deliberately revalidate, these fork-owned areas:

- TFlow authentication, credential vault, model-key provisioning, provider injection, account/usage/balance UI, and model selection;
- `TFlowBuddy` edition identity, application protocol, bundle identifiers, `~/.tflowbuddy` packaged home, and desktop-host overlay;
- unsigned macOS/Windows packaging behavior, desktop build scripts, and the current icon resources;
- TFlow-owned documentation, tests, and Agent Notes.

The exact upstream revision and the dsh-pocket source revision are recorded in the implementation change and dependency metadata. The merge is accepted only after the TFlow regression suite and a built desktop-host composition pass.

## 3. dsh-pocket integration

dsh-pocket is added as an independent vendored workspace under `vendor/dsh-pocket`, pinned to a reviewed immutable upstream release revision. Its upstream package name, source copyright notices, GPL-2.0 license text, and mobile MIT notice remain intact. The package is not relabeled as an MIT Harness package and is not silently converted into a repository-owned `@deepseek-ai` package.

The web-app bundle receives a dependency and Cordis roster entry for the pocket host/client plugin. The Desktop closure tooling is updated so the package, its runtime dependencies, its client bundle, and its license files are packed into the Desktop Host payload. The plugin remains an ordinary extension: it does not fork the DSH session store, agent loop, Connection protocol, or model provider. The phone and desktop browsers use the existing Connection and Gateway WebSocket transport and therefore observe the same sessions and live events.

The DSH web server remains loopback-only. dsh-pocket owns the external listener and rewrites the incoming Host/Origin authority to the loopback DSH authority before forwarding HTTP and WebSocket traffic. This keeps the DSH trust fence intact while allowing the phone to use the existing `/api/remote.mux` transport. The integration must not add an SSE dependency: Cloudflare Quick Tunnels do not support Server-Sent Events, while the current remote transport uses WebSocket.

Desktop detection is supplied explicitly by the Desktop Host composition rather than relying on obsolete service probes. In the desktop build, dsh-pocket's self-update and self-restart RPC actions are disabled; Electron owns application restart and update lifecycle. Pocket's proxy, PIN, QR, and tunnel state are disposed with the Host fiber.

## 4. Connection modes and user experience

### 4.1 LAN mode

The pocket proxy starts with the desktop Host and exposes a LAN URL when LAN access is enabled. The settings surface shows a LAN QR code and an independent LAN PIN. LAN access is enabled by default for the phone-companion feature, but remains protected by its own PIN by default; users can disable LAN access or LAN authentication explicitly. A LAN PIN is never reused as the public PIN.

The QR payload points to the pocket proxy, not to the loopback DSH port. The browser loads the normal web client and establishes the existing authenticated Connection to the desktop Host. TFlow account controls remain governed by the existing Electron bridge and are not exposed as raw credentials to the phone.

### 4.2 Public Quick Tunnel

Public access is opt-in and is never started merely because the application launches. The settings surface explains that the phone session can execute code through the desktop DSH and requires an explicit confirmation before starting a tunnel. Starting the tunnel launches the bundled or safely downloaded `cloudflared` binary in Quick Tunnel mode and displays the temporary HTTPS `trycloudflare.com` URL as a QR code.

Quick Tunnel requires no Cloudflare account or domain. The URL is temporary, changes when the tunnel is recreated, and stops working when the process exits. The public PIN is separate from the LAN PIN and is generated/rotated according to pocket's public-access rules. Stopping the tunnel invalidates the public route; restarting the application does not promise a stable public URL.

Cloudflare documents Quick Tunnel limitations that the UI and documentation must state accurately: no uptime guarantee, a 200 in-flight-request limit, and no SSE support. The implementation therefore tests WebSocket streaming through the proxy and does not claim production-grade tunnel availability.

### 4.3 Named Tunnel (advanced)

Named Tunnel is retained only as an advanced configuration for a user who supplies a Cloudflare Tunnel token and hostname. TFlowBuddy never embeds a shared TFlow Cloudflare credential, never provisions a cross-user tunnel through `tflow.online`, and never routes all customers through one public tunnel. A future managed `tflow.online` service would require a separate backend with per-device identity, routing isolation, expiry, revocation, quotas, and abuse controls; it is explicitly outside this change.

## 5. Authentication and data handling

The pocket proxy preserves separate LAN and public authentication and treats unknown hosts as public (fail closed). The public route always requires a PIN, including a custom fixed hostname. Authentication failures are rate limited by pocket's existing mechanism. PINs are displayed only to the local controller in the settings surface when required for pairing; they are not written to logs or sent to TFlow services.

The phone receives the web UI, session events, and user actions needed to control the desktop DSH. It does not receive the TFlow access token, refresh token, model key, keyring record, or raw account API response. Model requests continue through the desktop Host's existing provider injection. Renderer and main-process redaction rules remain in force for the new status/RPC path.

The proxy and tunnel subprocess lifecycle follows `docs/defensive-patterns.md`: bounded startup and shutdown, no orphaned `cloudflared` process, cancellation on Host disposal, safe error classification, and no secret values in diagnostics. Downloaded `cloudflared` binaries are verified using the existing pocket download policy and are stored below the pocket data directory, not in the repository.

## 6. Licensing and distribution

dsh-pocket is distributed as GPL-2.0 code with its original license and notices. The embedded desktop distribution must include the corresponding source or the repository's source-offer mechanism, the GPL text, the dsh-pocket copyright notice, and third-party notices for its runtime dependencies. The mobile adaptation's MIT notice remains in its source location. The repository's notice generator and package-license gates are extended narrowly for this direct GPL component; existing MIT DSH package declarations are not changed.

The implementation records the exact dsh-pocket release pin, checks that the packed payload contains the license files, and verifies that generated third-party notices are current. No license text is hand-edited or replaced with a generic project notice.

## 7. Tests and verification

The implementation plan must include focused checks for:

- upstream merge composition and TFlow account/provider/edition regressions;
- dsh-pocket package loading, client bundle inclusion, Desktop Host closure, and license/notice generation;
- proxy authority rewriting, loopback trust, LAN/public host classification, separate PINs, rate limiting, and WebSocket upgrade/authentication;
- Quick Tunnel subprocess lifecycle with a mocked `cloudflared` (start, URL discovery, stop, restart, failure, and cleanup), without requiring a live public tunnel in automated tests;
- phone-oriented browser composition through `/api/remote.mux`, including reconnect and simultaneous desktop/phone session activity;
- icon resource inclusion and packaged desktop startup smoke on macOS arm64 and Windows x64 where the existing release matrix permits.

Acceptance also includes one manual LAN scan on a real phone. A live public-network Quick Tunnel check is performed only when explicitly authorized for the test environment and is reported separately from automated tests. The report distinguishes browser/mocked verification from physical-device and public-network evidence.

## 8. Scope exclusions

This change does not create a TFlow-hosted relay, a fixed `tflow.online` endpoint, account-linked phone identities, a new mobile-native application, a second conversation backend, a cloud session store, or an automatic public tunnel at application startup. It does not expose TFlow credentials to the phone, change the DSH session format, or relax the DSH loopback trust rule.
