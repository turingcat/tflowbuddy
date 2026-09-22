# Agent Note: TFlowBuddy desktop edition

Status: implemented

English | [中文](2026-09-22-tflowbuddy-desktop-edition.zh.md)

## Problem

The Electron desktop shell in `apps/desktop` presents the DeepSeek product: its window, menus, About panel, welcome flow, icons, installer, and update artifacts all carry DeepSeek Harness identity, and its sign-in path drives a DeepSeek Platform browser authorization that a TFlow account holder cannot complete. The TFlow deployment issues model keys through its own sub2api panel and serves models through an OpenAI-compatible gateway, so an account holder has no DeepSeek account to sign in with and no key to paste.

The product to ship is a TFlow account's desktop client: macOS Apple Silicon and Windows x64 only, no web client, no CLI, and no second client to coordinate with. Its readers are desktop users of Simplified Chinese who do not use a terminal, so every user-visible path has to work without one.

## Decision

One edition manifest and one sign-in flow own the product identity and the account session; everything else keeps the shared Harness runtime unchanged.

### Product identity is one manifest

`apps/desktop/src/edition.ts` declares the display name, bundle identifier, URL scheme, protocol name, Windows application identifier, executable and artifact stems, icon stem, account site, and site kind, and validates each value against what the operating system, installer, and protocol registry can represent. Every consumer reads it: `main.ts` sets `app.name` and the About panel, `locale.ts` composes the copy that names the product, and `electron-builder-config.mjs` derives `appId`, `protocols`, `productName`, the artifact name, the DMG title, and the icon paths. `resolveDesktopAppId` defaults to the edition bundle identifier, so a release environment does not repeat a reverse-DNS identity that belongs to the product.

A mismatch is a test failure rather than a build-time surprise: `tests/edition.spec.ts` asserts the packaged configuration against the manifest and refuses source that still spells the retired product name.

### Sign-in is the panel's own flow

The welcome window collects an address, a password, an optional captcha proof, and a TOTP code, then offers the groups the panel reports, because the deployment rejects an ungrouped key. `src/tflow/protocol.ts` holds the sub2api contract, `src/tflow/session.ts` sequences it, `src/tflow/login-backend.ts` owns the flow for the process, and `src/tflow/login-ipc.ts` registers the typed channels for one window and removes them when it closes. The renderer receives a closed view union carrying copy and safe values; no token, model key, or raw panel response crosses the IPC bridge, and every field a renderer supplies is validated in the main process.

The flow reaches `authenticated` only after the gateway lists a non-empty catalog for the minted key, so a workspace never opens able to talk to nothing.

### Credentials are desktop-owned and vault-sealed

`src/tflow/credentials.ts` persists one versioned record holding the panel tokens, the model key, and the addresses they belong to. The two secrets are sealed with the platform vault before they reach the document; `src/tflow/vault.ts` is the only TFlow module that touches an Electron API and uses `safeStorage`, with no plaintext fallback — a platform that cannot encrypt refuses the write. The record lives under Electron's per-user data directory, which separates the shell's session from the Host's credential document without carrying the protection itself.

### The model provider reuses the existing adapter

The signed-in route is published through `src/host-rpc.ts` into the `llm-pi-ai` settings namespace as a hand-declared `openai-completions` gateway whose `baseURL` is the panel's advertised gateway address and whose model list is the catalog the gateway just returned. The key travels through the Host credential seam under `TFLOW_MODEL_KEY`, so no secret enters the settings document, and the Models page keeps seeing a route rather than a secret.

### The retired DeepSeek surface is gone, not hidden

The DeepSeek Platform account view, its preload, the `dshPlatform` bridge, the Settings-page browser sign-in, and the API-key paste onboarding are removed. The locale dictionaries drop the keys those flows owned and keep one key set in both languages.

### Language

The welcome window opens in Simplified Chinese regardless of the operating-system language, because the product's readers are Chinese-speaking desktop users and the panel answers in Chinese. The workspace keeps the shared language preference.

### The panel contract this build implements

The panel is the sub2api deployment serving `https://tflow.online`, and its contract was verified field by field against the server source rather than inferred from the retired AIBuddy implementation. Every panel response is the envelope `{ code, message?, reason?, data? }` where `code === 0` is success:

| Purpose | Request | Fields read |
|---|---|---|
| Public settings | `GET /api/v1/settings/public` | `aliyun_captcha_*`, `api_base_url` |
| Sign in | `POST /api/v1/auth/login` | request `email`, `password`, `turnstile_token`; response `access_token`, `refresh_token?`, `requires_2fa`, `temp_token?`, `user_email_masked?` |
| Second factor | `POST /api/v1/auth/login/2fa` | request `temp_token`, `totp_code` |
| Refresh | `POST /api/v1/auth/refresh` | request `refresh_token`; response rotates the pair |
| Account | `GET /api/v1/auth/me` | `email`, `balance` |
| Model keys | `GET /api/v1/keys`, `POST /api/v1/keys` | `name`, `status`, `key`, `group_id`; create takes `Idempotency-Key` |
| Groups | `GET /api/v1/groups/available` | `id`, `name` |
| Subscription | `GET /api/v1/subscriptions/progress` | `subscription.group_id`, `progress.group_name`, `progress.daily|weekly|monthly.remaining_usd` |
| Models | `GET {gateway}/v1/models` | OpenAI-compatible `data[].id` |

### What shipped in this phase

The edition manifest, the welcome sign-in flow, the panel protocol client, the vault-sealed credential record, the sign-in state machine, the per-window IPC bridge, the Chinese welcome surface, the provider route with its catalog and default model, the account read, and the account surface. The profile overlay disables the two base-bundle rows this product cannot serve.

Two findings from building it are worth keeping: the provisioned group had to be persisted with the model key, because the account read asks the panel for the subscription covering that group and a later sign-in reuses the key that group owns; and the Host RPC layer beneath the provider route has never executed against a real Host, which is the risk the deferred verification addresses.

## Alternatives considered

**Fork AIBuddy's desktop implementation.** AIBuddy already has a sub2api login, a credential file, and a TFlow gateway provider. It is a different Electron shell built on a different agent runtime, so reusing its modules would mean porting its identity, credential, and provider layers into a codebase that already has Host-owned provider, credential, and settings seams. The sub2api contract was reused as evidence and as the source of the field names; the code was not, because the seams here already exist.

**Copy the verified contract into a new mock fixture layer.** A local mock would let implementation proceed before the server contract was trusted. The deployment's own source was available on this machine, so the contract was verified field by field against the handlers and DTOs — including the login request, the second-factor exchange, the rotating refresh grant, the key list and create payloads, the group list, the subscription progress windows, and the gateway model list. A mock would have added a second contract to keep true with no gap left to fill.

**Store the panel session in the Host credential seam.** The Host's credential document is written by the credentials plugin and read by providers, and it is already reachable from the shell over RPC. Its reference grammar is a POSIX environment-variable name, and the inherited environment outranks the document, so a desktop session stored there would be shadowed by an unrelated variable of the same name and would live in a document the user's Models page also edits. The shell's session goes in a document only the shell writes.

**Keep the DeepSeek Platform sign-in and add TFlow beside it.** Two account entries in a settings page whose readers cannot use one of them is worse than one entry, and the design forbids the DeepSeek account from appearing in a TFlowBuddy user-visible path.

**Reuse the installed pi-ai catalog for the gateway.** Omitting the route's `models` list serves the installed catalog for that route name, and the TFlow gateway is not a catalog provider. The route declares the models the gateway advertised, which is also what makes a gateway that renames a model visible at the next sign-in.

**Ship the DeepSeek web client with TFlow branding.** Out of scope by the product decision: this ships a desktop client for macOS and Windows, and the browser client is not a release target.

## Consequences

The desktop shell now has a product identity it can be tested against instead of literals spread across three files, and a sign-in flow whose failure classification the renderer can act on. The expense is a fork that must track upstream: `apps/desktop` is a copy of DeepSeek Harness with an edition layer over it, and upstream changes to the shell, the packaging inputs, or the provider adapter have to be reconciled here.

The model list on the route is written at sign-in rather than read per request, so a gateway that changes its catalog mid-session is reflected at the next sign-in or refresh rather than immediately.

The workspace still registers the base bundle's DeepSeek account plugin and official model adapter, so the Settings page can still present DeepSeek entries. Removing them from the Desktop profile composition is deferred; the locale dictionaries and the welcome flow no longer reference them.

`apps/desktop/tests/main-startup.spec.ts` and `apps/desktop/tests/installer-packaging.spec.ts` could not run in the environment where this work was done: the first does not complete without packaged Electron artifacts, and the second needs installer tooling. Their welcome-path changes are unverified by execution and are the first thing to re-run.

## Verification

`pnpm run test` covers the TFlow modules end to end without Electron: the panel contract including every classified failure, the credential record's sealing and refusal paths, the sign-in state machine, and the renderer contract's projections. `apps/desktop/tests/main-startup.spec.ts` covers the process wiring, and `apps/desktop/tests/welcome-window.spec.ts` covers the per-window IPC ownership and the frame that may drive it.
