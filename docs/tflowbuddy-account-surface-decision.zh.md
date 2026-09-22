# TFlowBuddy 下一步选择：TypeSafe 判断记录

[English](tflowbuddy-account-surface-decision.md) | 中文

> 日期：2026-09-22。模型：`jev-latest`，请求时解析为 `jev-1.13.0`。

> 用途：为「先建工作区账户界面，还是先在真机验登录」提供结构化判断材料。最终决定由用户做出，模型判断不作为批准。

TypeSafe 只用于这一步的语义判断。接口字段、凭证密封、HTTP 状态分类和权限规则仍由普通代码与明确契约决定，不进入模型判断。

## 1. 状态（state）

传给模型的状态只包含产品事实，不含任何 token、模型密钥或面板响应原文。

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

## 2. 判断问题

三个问题在同一请求中并行提出，彼此不可见对方的答案。

| id | 类型 | 问题 |
|---|---|---|
| `next_step` | Choice | 当前最有利于这个产品的下一步是什么？选项：先真机验证再建界面 / 直接建工作区账户界面 / 一边验证一边并行建界面 |
| `unverified_risk` | Score | 在 Host RPC、面板调用与 profile patch 播种全部从未对真实服务执行过的情况下，却有多个子系统建立在其上，这带来多大的产品风险？四级：最小 / 局部 / 复合 / 严重 |
| `build_first_cost` | Score | 若现在先建账户界面，而之后的真机运行显示 Host RPC 层需要返工，多少账户界面工作量会被推翻？四级：无 / 小 / 中 / 大 |

各 Score 的等级描述均写成可观察情形（例如「复合」= 多个后续功能建立在未验证层之上，底层一个错误假设会使上层工作失效且难以归因；「严重」= 错误假设会静默产生错误的用户可见数据或错误的安全结果，而不是可见失败）。

## 3. 原始答案

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

## 4. 代码如何消费这些答案

规则是显式的，权重和阈值写在代码里，不由模型决定是否放行。

1. `unverified_risk` 落在「复合」及以上（score ≥ 2，其概率区间 2 与 3 合计 1.00）→ 在任何真机端到端运行之前，不再扩大建立在 Host RPC 层之上的用户可见功能。
2. `next_step` 选中 `verify_then_build`，且置信度 0.94 高于 0.7 → 下一步是真机验证，而不是新建用户可见界面。
3. `build_first_cost` 为 1.37、置信度仅 0.40 → **不**用它来论证「既然返工小就先建」。低置信度的优势证据不构成放行条件；它的作用是说明账户界面并非不可回收，因此可以安全地排在验证之后，而不是排在前面。
4. 用户掌握最终改判权。模型输出只是判断材料，不构成对实现的批准。

## 5. 结论

TypeSafe 与代码规则的共同结论是：先真机验证，再建工作区账户界面。理由不是账户界面不值得做，而是账户界面是当前唯一建立在「Host RPC 层可用」这一未经执行假设之上的用户可见功能；在它之上继续叠加会让底层假设出错时的归因变难。

账户界面的工作应作为待办排期保留，而不是取消。

## 6. 用户改判（2026-09-22）

用户决定**先写完界面，再验证**，覆盖第 4 节第 1、2 条规则。

改判理由（用户给出）：真机验证需要用户本人在场且要准备运行时，成本高；批量验证一次比分两次验证省事。这条理由对模型不可见——模型看到的 `unverified_risk` 状态没有包含「验证轮次的人力成本」这一项，因此它的风险判断在第 1、2 条规则上缺少一个真实约束。

改判的代价与保留项：

- 第 4 节第 3、4 条规则不受影响，仍然有效：账户界面高于账户读取，Host RPC 层若返工只需改数据源绑定，因此这次改判的返工面是有界的。
- 第 3 节的 `unverified_risk` 判断仍然成立：验证必须在**发布前**完成，且必须覆盖新增界面。它不是被推翻，而是被排到界面之后。
- 因此 `docs/tflowbuddy-real-machine-verification.md` 的清单在新增界面后需要补一条：确认账户区块显示的余额/订阅与服务端一致，并确认读取失败时模型会话不受影响。

这条改判不是对模型结论的否定，而是说明模型缺少一项人力成本输入。若后续还有同类选择，`state` 里应补上验证轮次的成本，否则同类问题会得到同样的偏向。

## 7. 复现

```sh
# .env must provide TYPESAFE_API_KEY
curl -sS https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d @request.json
```

参考文档：<https://docs.typesafe.ai/concepts/state.md>、<https://docs.typesafe.ai/primitives/choice.md>、<https://docs.typesafe.ai/primitives/score.md>、<https://docs.typesafe.ai/confidence.md>。
