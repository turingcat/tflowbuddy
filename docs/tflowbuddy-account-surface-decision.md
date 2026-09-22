# TFlowBuddy next-step choice: TypeSafe judgment record

English | [中文](tflowbuddy-account-surface-decision.zh.md)

> Date: 2026-09-22. Model: `jev-latest`, resolved to `jev-1.13.0` at request time.

> Purpose: structured judgment material for the choice between building the workspace account surface first and verifying a real sign-in first. The user makes the decision; a model judgment is not an approval.

TypeSafe was used only for this one semantic judgment. Interface fields, credential sealing, HTTP status classification, and permission rules stay with ordinary code and explicit contracts and never enter a model judgment.

## 1. State

The state sent to the model carries product facts only — no token, no model key, and no raw panel response.

```json
{
  "product": {
    "name": "TFlowBuddy",
    "what_it_is": "Electron desktop client (macOS arm64, Windows x64) for TFlow accounts. No web client, no CLI. Users are Simplified-Chinese desktop users who do not use a terminal.",
    "skill_level": "end users install a desktop app and sign in; they do not read logs or config files"
  },
  "shipped_and_committed": [
    "edition manifest giving the shell one product identity (name, bundle id, protocol, icons, artifact stem)",
    "welcome window sign-in flow: email, password, optional captcha, TOTP code, then group confirmation",
    "panel protocol client, vault-sealed credential record, sign-in state machine, typed IPC, Chinese welcome UI",
    "provider route published to the Host settings with the gateway model list, model key written through the credential seam",
    "default model selection set to the first model the registered route serves",
    "account read resolving balance and the subscription covering the selected group",
    "edition profile overlay disabling the two DeepSeek rows this product cannot serve"
  ],
  "verified_how": {
    "unit_tests": "222 passing across 11 desktop spec files; every module is tested with injected transports, vaults, and effects",
    "typecheck": "clean",
    "build": "clean",
    "NOT_verified": [
      "no real run of the Electron app in this environment",
      "no request has ever reached the real tflow.online panel or gateway",
      "the Host settings and credential RPC calls (settings/update, credentials/set, agent-default-model update, llm/listModels) have never executed against a real Host",
      "the seed profile patch has never been read by a real boot"
    ],
    "two_specs_cannot_run_here": "main-startup.spec.ts and installer-packaging.spec.ts time out from missing packaged Electron artifacts and installer tooling"
  },
  "remaining_known_gap": {
    "what": "the account surface inside the workspace: balance and subscription are readable through the shell bridge but nothing renders them",
    "why_it_is_missing": "the existing account UI package only activates through the DeepSeek Host account service, which this edition disables; a TFlow-specific client plugin package would have to be created, registered in the web bundle patch and manifests, and covered by client tests",
    "size": "a new client plugin package plus slot registrations plus locale dictionaries plus component tests"
  },
  "constraints": {
    "correctness_gate": "the product owner must be able to sign in and hold a conversation before any release claim is made",
    "unit_tests_cannot_replace": "a successful end-to-end sign-in; every failure classified by the current tests was classified by tests the same author wrote",
    "credential_rule": "no token or model key may ever be written in plaintext or reach the renderer"
  }
}
```

## 2. Questions

Three questions were asked in one request, each evaluated independently and unable to see the others' answers.

| id | Type | Question |
|---|---|---|
| `next_step` | Choice | Which next step best serves this product right now? Options: verify on a real machine first, build the workspace account surface now, or do both in parallel. |
| `unverified_risk` | Score | With the Host RPC layer, the panel calls, and the profile-patch seeding never executed against the real service while several subsystems are built on top, how much product risk does that carry? Four levels: minimal, contained, compounding, severe. |
| `build_first_cost` | Score | If the account surface is built first and the real run later shows the Host RPC layer needs rework, how much of that work is discarded? Four levels: none, small, moderate, large. |

Each Score level is written as an observable situation. "Compounding" reads: several later features are built on the unverified layer, so one wrong assumption near the bottom invalidates work layered above it and the failure is hard to attribute. "Severe" reads: a wrong assumption can silently produce wrong user-visible data or a wrong security outcome rather than a visible failure.

## 3. Raw answers

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "next_step": {
      "type": "choice",
      "choice": "verify_then_build",
      "confidence": 0.94,
      "probabilities": { "build_account_surface": 0.0, "both_in_parallel": 0.04, "verify_then_build": 0.96 }
    },
    "unverified_risk": {
      "type": "score",
      "score": 2.78,
      "confidence": 0.78,
      "probabilities": { "0": 0.0, "1": 0.0, "2": 0.22, "3": 0.78 }
    },
    "build_first_cost": {
      "type": "score",
      "score": 1.37,
      "confidence": 0.4,
      "probabilities": { "0": 0.11, "1": 0.47, "2": 0.35, "3": 0.07 }
    }
  },
  "usage": { "input_tokens": 1385, "output_tokens": 80 }
}
```

## 4. How code consumes these answers

The rules are explicit; weights and thresholds live in code and the model never decides whether to proceed.

1. `unverified_risk` at "compounding" or above (score ≥ 2, with levels 2 and 3 together carrying probability 1.00) means no further user-visible capability is built on the Host RPC layer before a real end-to-end run.
2. `next_step` chose `verify_then_build` at confidence 0.94, above 0.7, so the next step is real-machine verification rather than a new user-visible surface.
3. `build_first_cost` scored 1.37 at confidence 0.40, so it is **not** used to argue the opposite case. Low-confidence favorable evidence is not a release condition; its role is to show the account surface is recoverable, which makes it safe to schedule after verification rather than before.
4. The user holds the final override. Model output is decision material and never an approval to implement.

## 5. Conclusion

TypeSafe and the code rules together concluded: verify on a real machine first, then build the workspace account surface. Not because the surface is not worth building, but because it was the only user-visible capability standing on the unexecuted assumption that the Host RPC layer works; layering more on top would have made a wrong assumption near the bottom harder to attribute.

The account surface work should be kept scheduled rather than cancelled.

## 6. User override (2026-09-22)

The user decided to **finish the surface first, then verify**, overriding rules 1 and 2 of section 4.

The user's stated reason: real-machine verification needs them present and needs the runtime prepared, which is expensive, and verifying everything in one batch is cheaper than verifying twice. That reason was invisible to the model — the `unverified_risk` state did not include the human cost of a verification round, so its risk judgment was missing a real constraint behind rules 1 and 2.

What the override does and does not change:

- Rules 3 and 4 of section 4 are unaffected and still hold. The account surface sits above the account read, so reworking the Host RPC layer would change only its data-source binding; the override's rework surface is therefore bounded.
- The `unverified_risk` judgment still stands: verification must complete **before release**, and it must cover the new surface. It was deferred, not overturned.
- The verification checklist therefore gained an item: confirm the account block shows the balance and subscription the panel reports, and that a failed read leaves the conversation usable.

The override is not a rejection of the model's conclusion; it shows the model was missing a human-cost input. For any later choice of this shape, the state should carry the cost of a verification round, or the model will lean the same way again.

## 7. Reproducing

```sh
# .env must provide TYPESAFE_API_KEY
curl -sS https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d @request.json
```

Reference documentation: <https://docs.typesafe.ai/concepts/state.md>, <https://docs.typesafe.ai/primitives/choice.md>, <https://docs.typesafe.ai/primitives/score.md>, <https://docs.typesafe.ai/confidence.md>.
