# TFlowBuddy 桌面端迁移方案分析

> 状态：仅分析，不实现。  
> 日期：2026-09-22

## 1. 已完成的仓库准备

- GitHub 公开仓库：<https://github.com/turingcat/tflowbuddy>
- 本地仓库基于 `deepseek-ai/deepseek-harness` 的 `master` 初始化。
- `upstream`：`https://github.com/deepseek-ai/deepseek-harness.git`
- `origin`：`https://github.com/turingcat/tflowbuddy.git`
- 当前基线：`c36a83ff6b`（`dsh-v0.1.7-alpha.1`）。

## 2. 迁移范围与现有实现依据

目标是在 `apps/desktop` 中迁移 AIBuddy 的产品身份及 TFlow 服务链路：

1. AIBuddy 品牌：产品名、图标、应用身份、桌面端聊天头部跳转到 `https://tflow.online`。
2. TFlow 登录：账号密码、验证码配置、TOTP 二次验证，以及多分组选择。
3. Model key 注入：登录成功后读取/创建 AIBuddy 专用 key，将面板令牌、网关地址、API key 写入受保护的凭证文件，并注入桌面 Host/后端进程。
4. Model 获取：通过 OpenAI-compatible `GET {gateway}/models` 获取模型，映射为桌面端模型选择器可消费的列表。

AIBuddy 中可直接作为迁移参考的模块：

| 能力 | 参考实现 |
|---|---|
| 品牌与站点入口 | `ui/desktop/src/brand.ts`、`components/ChatBrand.tsx`、`branding/brands.json` |
| 登录 UI | `components/auth/AIBuddyLoginForm.tsx`、`components/auth/LoginView.tsx` |
| 登录/2FA/刷新/key provisioning | `aibuddyAuthIpc.ts`、`sub2apiAuth.ts` |
| 凭证持久化与加密 | `credentials.ts`、`credentialsCrypto.ts` |
| 主进程 IPC | `main.ts`、`preload.ts`、`aibuddyAuthIpc.ts` |
| 服务进程环境变量注入 | `aibuddyServeEnv.ts` |
| 账户与模型运行时查询 | `aibuddyRuntimeIpc.ts`、`siteRuntime/sub2apiAdapter.ts` |
| 上游品牌同步机制 | `tools/aibuddy-rebrand/`、`docs/development/aibuddy-upstream-sync.md` |

现有 AIBuddy 的关键服务调用约定是：

- 面板公开设置：`GET /api/v1/settings/public`；
- 登录：`POST /api/v1/auth/login`；TOTP：`POST /api/v1/auth/login/2fa`；刷新：`POST /api/v1/auth/refresh`；
- key 查询/创建：`/api/v1/keys`，默认按 `AIBuddy` 名称和 active 状态管理；
- 网关模型：`GET {api_base_url}/v1/models`，使用下发的 API key；
- 网关地址由面板返回的 `api_base_url` 归一化为 OpenAI-compatible `/v1` 地址。

以上是对源码的迁移依据，不代表 TFlow 当前线上接口契约已经冻结。实施前应以服务端 OpenAPI/接口测试和真实响应为准。

## 3. 方案 A：最小产品化迁移（推荐起步）

### 设计

在 DeepSeek Harness 的桌面端增加一个 `TFlow` 产品适配层，尽量复用现有 Desktop Host、凭证服务、Provider/Model 设置和 Electron IPC：

- 用 `branding/brands.json` 或等价的产品 manifest 管理 `TFlowBuddy` 名称、图标、协议和站点 URL；
- 新增 `tflowAuth.ts` / `tflowAuthIpc.ts`，将 AIBuddy 的登录、TOTP、key provisioning、refresh 逻辑迁移为 TFlow 命名；
- 凭证仍由主进程持有，渲染进程只通过 typed preload IPC 触发登录和读取脱敏状态；
- 将 `baseUrl` 与 `apiKey` 注入 Harness 已有的模型提供方配置或 Host 启动环境；
- 复用模型刷新机制，把 `/v1/models` 的 `id` 映射到已有模型选择器；
- 先只支持一个预置的 TFlow provider，隐藏通用 provider/key 配置入口，避免用户绕过 TFlow 账户链路。

### 优点

- 改动面最小，能最大化复用 DeepSeek Harness 的安全、更新和桌面打包能力；
- 登录、凭证、provider、模型选择的责任边界清楚；
- 便于后续从 `TFlow` 改成多产品 edition，而不把 TFlow 逻辑散落在 UI 中。

### 风险与代价

- 需要准确适配 Harness 当前的 provider 配置和启动生命周期；
- 如果当前 Harness 的模型配置默认面向 DeepSeek 官方账户，可能需要新增一个明确的 TFlow provider seam；
- AIBuddy 的账户余额/订阅展示不在最小范围内，需要后续单独设计。

### 适用条件

适合优先验证“能登录、能注入 key、能看到模型、能发起一次对话”的端到端闭环。

## 4. 方案 B：TFlow 账户服务与模型网关分层

### 设计

把 AIBuddy 的实现拆成两个显式适配器：

1. `TFlowAccountClient`：只处理登录、TOTP、refresh、当前用户、分组和 key provisioning。
2. `TFlowModelGateway`：只处理网关 URL、API key、`/v1/models`、模型能力映射和请求鉴权。

Desktop 主进程维护一个 `TFlowSession`，其中包含会话令牌和 gateway credentials；渲染进程只消费 `AuthStatus`、`ModelSummary[]` 等脱敏 DTO。Host/agent 侧只获得最小的 `baseUrl`、`apiKey` 和模型配置。

### 优点

- 最贴合 AIBuddy 当前源码中“面板 API”和“OpenAI-compatible 网关”已经分开的事实；
- 便于 key 轮换、access token refresh、模型网关迁移和离线错误重试；
- 未来可把账户余额、订阅额度、模型目录缓存分别演进；
- 更容易写契约测试：账户服务测试不需要启动模型网关，模型网关测试不需要登录。

### 风险与代价

- 类型、错误分类和生命周期状态更多；
- 需要定义凭证刷新时 Host 环境如何同步，避免“面板 token 已刷新、模型 key 仍旧”的半更新状态；
- 需要明确模型列表的缓存失效策略和无网时行为。

### 适用条件

适合把 TFlowBuddy 当作长期产品，而不是一次性品牌皮肤。若预计后续加入余额、套餐、权限或多个模型路由，此方案更稳健。

## 5. 方案 C：TFlow Broker/本地桥接服务

### 设计

桌面端只负责 TFlow 登录和本地会话；新增一个本地 broker（可作为 Desktop Host 插件或独立受管子进程），由 broker 负责：

- 保存并刷新 TFlow 会话；
- 创建/轮换 model key；
- 对外提供本地统一的 OpenAI-compatible endpoint；
- 代理 `/v1/models` 和聊天请求；
- 向桌面端提供脱敏账户状态。

Harness 的 provider 固定指向 `127.0.0.1` 的 broker，真实 TFlow URL 和 key 不进入通用 provider 配置。

### 优点

- TFlow 认证细节与 Harness 模型调用彻底隔离；
- 可集中处理 refresh、重试、审计、配额和未来多网关路由；
- 未来 CLI、Web、Desktop 可以共用同一套本地/远端账户桥接协议。

### 风险与代价

- 进程生命周期、端口占用、崩溃恢复、单实例和升级复杂度显著增加；
- 本地代理会增加一跳延迟和新的安全面；
- 需要设计本地 IPC 鉴权，不能仅依赖“监听 localhost”；
- 对当前“先把桌面端跑通”的目标可能过度设计。

### 适用条件

只有在 TFlow 需要同时服务多个客户端、复杂路由/配额策略或统一审计时才建议采用。

## 6. TypeSafe 分析

TypeSafe 适合分析方案选择中的语义判断和不确定性，不应代替确定性的接口解析、凭证加密、HTTP 状态处理或权限规则。按照 TypeSafe 当前文档，建议将同一份状态分别交给多个窄问题，再由代码按阈值和硬规则组合；低置信度进入人工决策，而不是自动选型。

### 6.1 输入状态

后续若实际调用 TypeSafe，可将以下结构作为 state（不含任何真实 token/key）：

```json
{
  "goal": "在 apps/desktop 迁移 TFlow 登录、model key 注入和模型获取",
  "constraints": [
    "当前只分析，不实现",
    "复用 DeepSeek Harness 桌面能力",
    "凭证不能进入渲染进程或仓库",
    "TFlow 接口契约可能仍需确认"
  ],
  "options": [
    {"id": "A", "name": "最小产品化迁移"},
    {"id": "B", "name": "账户服务与模型网关分层"},
    {"id": "C", "name": "TFlow Broker/本地桥接服务"}
  ],
  "evidence": {
    "aibuddy": [
      "登录、TOTP、refresh、key provisioning 已在 sub2apiAuth.ts 集中实现",
      "模型通过 OpenAI-compatible /v1/models 获取",
      "凭证由主进程保存并加密",
      "serve 环境通过独立适配器注入"
    ],
    "harness": [
      "apps/desktop 已有受管 Electron/Host/credential/update 体系",
      "provider、模型、账户和桌面启动均是现有扩展面"
    ]
  }
}
```

### 6.2 建议的 TypeSafe 问题

1. **Choice**：在当前约束下，A/B/C 哪个方案最适合第一阶段？标准应分别描述改动量、长期扩展性、安全隔离和交付风险，增加“证据不足，先补接口契约”选项。
2. **Score**：分别对每个方案评估“迁移复杂度”“凭证安全隔离”“模型链路可测试性”“未来多客户端复用性”，等级必须描述可观察情形，而不是泛泛的高/中/低。
3. **Noul**：在没有 TFlow 正式接口契约、错误码和 token 生命周期文档前，是否允许直接进入实现？该问题应作为硬闸门，而不是并入加权总分。
4. **Noul**：TFlow 的真实模型接口是否已经确认与 OpenAI `/v1/models` 兼容？若否，先做契约验证。

### 6.3 组合规则

- 若“接口契约未确认”为 `yes` 概率超过实施阈值，停止编码，先补服务端契约测试。
- 若任何凭证安全问题为高风险，直接排除该方案，不被其他维度的高分抵消。
- 在硬闸门通过后，用 Score 结果比较 A/B/C；A 作为低风险起步候选，B 作为长期产品候选，C 只有在多客户端/统一代理需求被确认后进入候选。
- TypeSafe 的结果只作为决策材料，最终方案由用户选择；不把模型置信度当成安全许可。

## 7. 当前建议与待用户决策事项

当前建议：**优先在 A 与 B 之间选择**。若目标是尽快验证闭环，选 A；若 TFlowBuddy 将持续维护并计划扩展账户权益、额度和多模型路由，选 B。C 暂不建议作为第一阶段方案。

在开始实现前需要用户确认：

1. 选择方案 A、B 或 C；
2. TFlowBuddy 的产品名、图标和 bundle/protocol 是否沿用 AIBuddy 的资产，还是重新设计；
3. TFlow 线上接口是否以 AIBuddy 当前 `/api/v1/*` 和 OpenAI-compatible `/v1/models` 为准；
4. 第一阶段是否只做登录/key/model/对话闭环，暂不迁移余额、订阅和账户菜单。

## 8. 参考资料

- AIBuddy 本地源码：`/Users/turingcat/Project/AIBuddy`
- AIBuddy 上游同步说明：`/Users/turingcat/Project/AIBuddy/docs/development/aibuddy-upstream-sync.md`
- AIBuddy 三阶段拆分：`/Users/turingcat/Project/AIBuddy/docs/superpowers/specs/2026-08-11-implementation-phases-split.md`
- TypeSafe System One：<https://docs.typesafe.ai/concepts/system-one.md>
- TypeSafe State：<https://docs.typesafe.ai/concepts/state.md>
- TypeSafe Confidence：<https://docs.typesafe.ai/confidence.md>
- DeepSeek Harness 桌面端说明：`apps/desktop/README.md`
