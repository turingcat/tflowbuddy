---
description: "Show the signed-in TFlow account, balance, subscription, and usage in the desktop Settings panel and sidebar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-account-tflow

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-client-ui-settings-account-tflow` is the TFlow edition's account surface. It renders the signed-in account's name, USD balance, the subscription allowance for the selected model group, and today's and all-time usage, and it links to the TFlow website for everything the desktop app does not own: topping up, buying a plan, and changing the group.

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

Account cards and actions use the shared radius scale; keyboard focus rings respect the shared input-modality color.

The username menu offers Settings, account management, and sign-out. Usage is available inside Settings only.

Mount this plugin in a browser roster that the desktop application loads. It contributes an account page (`tflow-account`) and a usage page (`tflow-usage`) through `settings.section`, and a sidebar launcher through `settings.launcher` that shows the signed-in username and starts the account read when it mounts.

The launcher registers at priority 1. `settings.launcher` is a single-cell slot and two registrations at the same priority are refused, so the higher priority leaves the DeepSeek edition's launcher intact where that edition composes it, and renders this one where it does not. The TFlow edition's profile overlay disables that launcher's row.

The signed-out, loading, and failed states are distinct: a signed-out account is asked to sign in, a loading account is not shown as empty, and a failed read offers a retry without disturbing the model session. A window the panel did not report is omitted rather than rendered as a zero, and a payload this build cannot render, including usage missing any total, is reported as a failure rather than as a partial card.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client/AccountSection.tsx` renders the account page and `src/client/AccountMenu.tsx` the launcher; both consume one snapshot through the `useAccount` hook seat and call `refresh` and `manage` through the inject face. `src/client/UsageSection.tsx` renders the usage page from a separate snapshot through the `useUsage` hook seat. `src/client/index.ts` reads the shell's `dshDesktopAccount` bridge once at apply time; for its `read` and `usage` operations it publishes snapshots to subscribers, joins concurrent refreshes into one request, and validates every payload before it reaches a component. The shell answers `usage` from the panel's `/api/v1/usage/dashboard/stats`, and the page shows the deducted amount (`actual_cost`), not the standard price.

The package holds no session state and no credentials. The panel session, the model key, and the token lifecycle belong to `apps/desktop`, which owns the sign-in flow; this package renders what that flow reports.

<a id="further-exploration"></a>
## Further Exploration

- [Account section](src/client/AccountSection.tsx) — the account page and the snapshot contract.
- [Usage section](src/client/UsageSection.tsx) — the usage page and its snapshot contract.
- [Registration](src/client/index.ts) — bridge validation and the seat registrations.
- [Copy](src/client/locales.ts) — the English and Chinese dictionaries.
- [Electron shell account flow](../../../apps/desktop/src/tflow/login-backend.ts) — the session this surface reads.
- [Desktop edition note](../../../.agents/notes/implemented/architecture/2026-09-22-tflowbuddy-desktop-edition.md) — why the TFlow edition owns its own account surface.

<a id="model-experience"></a>
## Model Experience

None, as the account surface renders panel-reported balance, subscription, and usage and contributes nothing to a model request.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The surface reads the account and the usage once per mount and on demand. It does not poll: the shell's account read reaches the TFlow panel, and a background poll would spend panel requests on a value the user is not looking at.
- Balance and subscription are both rendered only when the shell reports them. The panel's own notion of a group with no subscription is reported as "no subscription for this group" rather than as a zero balance.
- The subscription display covers the daily, weekly, and monthly windows the panel reports. A window the panel omits is not shown, and no allowance is computed locally.
- The package renders in a plain browser renderer's roster without contributing anything, which the registration spec covers. Reusing it outside the desktop shell would require a bridge of the same shape.

<a id="dev-note"></a>
### Dev Note

### Dev Note

The [desktop edition note](../../../.agents/notes/implemented/architecture/2026-09-22-tflowbuddy-desktop-edition.md) records why the account surface reads a shell bridge instead of the Host account Remote, and what the DeepSeek edition keeps.

#### KV Cache effect

No model request prefix changes.
