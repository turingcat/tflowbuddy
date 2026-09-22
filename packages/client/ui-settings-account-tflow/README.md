---
description: "Show the signed-in TFlow account, balance, and subscription in the desktop Settings panel and sidebar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-account-tflow

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-client-ui-settings-account-tflow` is the TFlow edition's account surface. It renders the signed-in account's display name, USD balance, and the remaining allowance of the subscription covering the selected model group, and it links to the TFlow website for everything the desktop app does not own: topping up, buying a plan, and changing the group.

The package activates only inside a renderer the Electron shell loaded, identified by that shell's account bridge. An ordinary browser renderer, and the DeepSeek edition where the Host account service is present instead, keep their own account UI and register nothing here.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in a browser roster that the desktop application loads. It contributes two settings seats: the Account page through `settings.section`, and the sidebar launcher through `settings.launcher`.

The launcher registers at priority 1. `settings.launcher` is a single-cell slot and two registrations at the same priority are refused, so the higher priority leaves the DeepSeek edition's launcher intact where that edition composes it, and renders this one where it does not.

The signed-out, loading, and failed states are distinct: a signed-out account is asked to sign in, a loading account is not shown as empty, and a failed read offers a retry without disturbing the model session. A window the panel did not report is omitted rather than rendered as a zero, and a payload this build cannot render is reported as a failure rather than as a partial card.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client/AccountSection.tsx` renders the page and the launcher's menu; both consume one snapshot through the `useAccount` hook seat and call `refresh` and `manage` through the inject face. `src/client/index.ts` reads the shell's `dshDesktopAccount` bridge once at apply time, publishes snapshots to subscribers, joins concurrent refreshes into one request, and validates every payload before it reaches a component.

The package holds no session state and no credentials. The panel session, the model key, and the token lifecycle belong to `apps/desktop`, which owns the sign-in flow; this package renders what that flow reports.

<a id="further-exploration"></a>
## Further Exploration

- [Account section](src/client/AccountSection.tsx) — the page, the launcher menu, and the snapshot contract.
- [Registration](src/client/index.ts) — bridge validation and the two seat registrations.
- [Copy](src/client/locales.ts) — the English and Chinese dictionaries.
- [Electron shell account flow](../../../apps/desktop/src/tflow/login-backend.ts) — the session this surface reads.
- [Desktop edition note](../../../.agents/notes/implemented/architecture/2026-09-22-tflowbuddy-desktop-edition.md) — why the TFlow edition owns its own account surface.

<a id="model-experience"></a>
## Model Experience

None, as account credentials affect HTTP authentication and never enter model prompts, Session logs, or tool results.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The surface reads the account once per mount and on demand. It does not poll: the shell's account read reaches the TFlow panel, and a background poll would spend panel requests on a value the user is not looking at.
- Balance and subscription are both rendered only when the shell reports them. The panel's own notion of a group with no subscription is reported as "no subscription for this group" rather than as a zero balance.
- The subscription display covers the daily, weekly, and monthly windows the panel reports. A window the panel omits is not shown, and no allowance is computed locally.
- Sign-out is not offered here. The session belongs to the Electron shell, and this product has no signed-out workspace to return to; a user who needs to change account does so by signing in again.
- The package renders in a plain browser renderer's roster without contributing anything, which the registration spec covers. Reusing it outside the desktop shell would require a bridge of the same shape.

<a id="dev-note"></a>
### Dev Note

The [desktop edition note](../../../.agents/notes/implemented/architecture/2026-09-22-tflowbuddy-desktop-edition.md) records why the account surface reads a shell bridge instead of the Host account Remote, and what the DeepSeek edition keeps.
