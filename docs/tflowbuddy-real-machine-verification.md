# TFlowBuddy real-machine verification checklist

English | [中文](tflowbuddy-real-machine-verification.zh.md)

> Purpose: verify the TFlowBuddy sign-in-to-conversation path on a real machine. Every check on the implementation so far is at the unit level, and the Host RPC calls, the panel calls, and the the edition overlay have never executed against the real service.

> Basis: the account-surface decision record, which put this checklist before any further user-visible surface was built on the unverified layer.

## 0. Prerequisite: the shell environment

This machine exports `GIT_CONFIG_COUNT=1` without a matching `GIT_CONFIG_KEY_0`, so every `git` subprocess fails with `missing config key GIT_CONFIG_KEY_0`. That breaks the build steps that read git. Run this first:

```sh
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=credential.helper
export GIT_CONFIG_VALUE_0="!'/Users/turingcat/Library/Application Support/app.codeg/git-credential-codeg.sh'"
```

The first launch prepares the runtime under `apps/desktop/.desktop-build/`, which takes a while.

## 1. Launch

```sh
cd /Users/turingcat/Project/TFlowBuddy
pnpm run dev:desktop
```

**Passes when**: the application window opens on the Chinese sign-in page — brand mark, "登录 TFlowBuddy", and the email and password fields.

**When it fails**, record the text shown in the window or on the Electron console. Early failures:

| Symptom | Most likely cause |
|---|---|
| Blank window or a `preload` error | `lib/preload-tflow.cjs` was not built; run `pnpm --filter @deepseek-ai/dsh-desktop build` first |
| The page shows "正在连接 TFlow 服务…" with the button disabled | `GET https://tflow.online/api/v1/settings/public` did not answer, and the button is disabled by design |
| It opens straight into the workspace | A previous run left usable credentials; continue at step 3 |

## 2. Sign in

Enter **email → password → captcha (when the panel asks) → the 6-digit TOTP code (when enabled) → confirm the group**.

**Passes when**: "已登录 / 正在打开工作区…" appears and the main window then shows the workspace.

**When it fails**, record the Chinese error text verbatim. Match it against the classification:

| On-screen text | Classification | Meaning |
|---|---|---|
| 无法连接 TFlow 服务，请检查网络 | `network` | the panel is unreachable |
| 请求超时，请稍后重试 | `timeout` | no answer within 15s |
| 邮箱或密码错误 / 验证码错误 | `unauthorized` / `service` | the credential or code was refused; retryable |
| 账号已停用 | `forbidden` | account-level refusal; not retryable, and no retry button is shown |
| TFlow 服务响应格式异常 | `protocol` | a panel field does not match the contract — **this is the class that most needs reporting** |
| 当前账号没有可用的模型分组 | `service` | the account has no usable group |
| TFlow 网关未返回可用模型 | `protocol` | the key was issued but the gateway listed no model |

## 3. Models and the default model

After a successful sign-in, confirm:

1. The model picker lists **the models the TFlow gateway returned**, and no DeepSeek model such as `deepseek-flash`.
2. A new conversation starts on the first model without a manual choice.

When the first does not hold, check that the installed runtime ships `@deepseek-ai/dsh-desktop-host/edition.cordis.patch.yml`; the Host applies it after every profile patch to disable `ui-settings-account`, `deepseek-account`, and `llm-deepseek`.

## 4. Conversation

Send one message.

**Passes when**: a model reply arrives.

**When it fails**: `MISSING_CREDENTIAL` means the model key never reached the Host credential seam (the `credentials/set` hop); a `no adapter` error means the provider route did not register (the `llm-pi-ai` hop). Both point at the Host RPC layer, which is the unverified link this checklist exists to test.

## 5. What to report back

Bring these back; you do not need to investigate first:

1. The step it stopped at, plus the **verbatim** text from the window or console.
2. Whether any `protocol`-class error from the table appeared.
3. The contents of `~/.dsh/profiles/desktop/cordis.patch.yml` (plugin switches only, no secrets).
4. Whether `~/.dsh/profiles/desktop/tflow-credentials.json` exists — **do not paste its contents**, only answer whether it is there; it holds sealed tokens.

## 6. Out of scope for this checklist

- Packaging, signing, installers, and the update path.
- A real Windows machine (this one is macOS).
- The workspace account surface is verified by inspection: it now exists, so watch the Account page render the balance and subscription the panel reports, and confirm a failed read leaves the conversation usable.
