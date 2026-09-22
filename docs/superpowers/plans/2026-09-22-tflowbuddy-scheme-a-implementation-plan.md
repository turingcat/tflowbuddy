# TFlowBuddy 方案 A 实施计划

> 状态：计划待用户拍板。计划阶段不实现功能，不启动子 Agent。  
> 设计依据：`docs/superpowers/specs/2026-09-22-tflowbuddy-scheme-a-design.md`

## 1. 实施目标

在 `apps/desktop` 中将 DeepSeek Harness 桌面壳改造成 TFlowBuddy 桌面产品，完成：

- TFlowBuddy 产品身份和品牌；
- TFlow 登录、验证码和 TOTP；
- access token / refresh token 生命周期；
- TFlow model key 查询/创建和安全存储；
- TFlow gateway 注入 Desktop Host/provider；
- TFlow `/v1/models` 模型目录；
- 账户菜单、余额和订阅信息展示；
- 退出登录、重新认证、浏览器跳转；
- macOS Apple Silicon 和 Windows x64 打包目标，Windows 10 兼容性核验。

第一阶段不包含 Web、CLI、移动端、其他客户端、Broker、充值、支付、购买订阅、套餐切换和取消订阅。

## 2. 实施前硬闸门

子 Agent 开始修改代码前，必须先由主 Agent 或用户补齐并确认：

1. TFlow 认证接口路径、请求字段、成功响应、错误码和 refresh 语义；
2. 验证码和 TOTP 的完整交互；
3. model key 查询、创建、命名、作用域、重复登录幂等、撤销和轮换语义；
4. 账户、余额、订阅/分组、日/周/月额度字段；
5. TFlow gateway 是否使用 `{base}/v1/models` 和 Bearer model key；
6. 聊天请求的 provider 类型、模型 ID 和错误协议；
7. Electron 44、原生依赖、keyring、安装器和更新器对 Windows 10 的支持结论；
8. TFlowBuddy 图标、bundle identity、协议名和用户数据目录命名。

如果接口契约没有正式资料，先建立本地 mock/contract fixture；不得凭 AIBuddy 旧实现猜测服务端字段后直接实现。

## 3. 分阶段计划

### 阶段 0：基线、产品边界和运行矩阵

**目标**：在写功能前确认 Harness 的桌面启动、账户、credential、provider、renderer 和发布 seam。

**检查范围**：

- `apps/desktop/src/main.ts`、`preload-*`、`host-process.ts`、`welcome-*`、`platform-*`；
- `packages/credentials/`、`packages/client/ui-settings-account/`、`packages/llm/`；
- `apps/desktop/locale.ts` 和现有账户 UI/IPC；
- `apps/desktop/package.json`、Electron builder、运行时和平台脚本；
- 根 `AGENTS.md`、`docs/architecture.md`、`docs/defensive-patterns.md`。

**产出**：

- TFlow 适配点清单；
- 现有 DeepSeek 用户可见入口清理清单；
- macOS arm64 / Windows x64 的构建和测试命令；
- Windows 10 兼容性结论或阻塞记录。

**验收**：不改变代码，能说明每个新模块的 owner、consumer、持久化位置和 IPC 入口。

### 阶段 1：产品 identity、品牌和本地化

**目标**：将用户可见桌面身份从 DeepSeek Harness 切换为 TFlowBuddy，同时保留底层 Harness 的中性运行能力。

**计划改动**：

- 新增或扩展 edition/brand manifest；
- 替换应用名、窗口标题、菜单、欢迎页、协议、bundle identity 和资源引用；
- 迁移 TFlowBuddy 图标到 Desktop 资源布局；
- 重写 `locale.ts` 中的产品相关文案，保留中英文 locale 结构；
- 清理或隔离 DeepSeek 官方登录、官方 API key onboarding 和用户可见 DeepSeek 账户入口；
- 为品牌 identity、资源路径、协议和 locale 添加单元测试。

**约束**：不对通用 Harness 的 agent、session、provider runtime 做品牌字符串的全局盲替换；edition 边界必须可审计。

**验收**：启动欢迎页、应用菜单、窗口标题、账户入口、安装包身份均显示 TFlowBuddy；源码中用户可见路径不再引用 DeepSeek 产品身份。

### 阶段 2：TFlow 认证和凭证存储

**目标**：建立主进程拥有的 TFlow 登录会话。

**计划新增/调整模块**：

- `tflow-auth`：公开设置、登录、TOTP、refresh、logout、协议错误；
- `tflow-credentials`：版本化凭证类型、加密/keyring 读写、迁移和删除；
- `tflow-auth-ipc`：主进程注册 typed IPC；
- `preload`：只暴露认证结果和脱敏状态；
- LoginView / 登录组件：账户、密码、验证码、TOTP 状态机和错误展示。

**状态机**：

```text
signed-out -> submitting -> totp-required -> provisioning -> authenticated
     ^             |              |                |
     └─────────────┴──────────────┴──── failure ────┘
```

**安全规则**：密码和验证码只在提交期间存在于渲染表单状态；token 和 key 永不通过通用 renderer state、日志或原始 IPC 返回。

**测试**：每个登录状态、字段缺失、非 JSON、超时、401、refresh 失败、重复登录和退出登录分支；凭证文件权限/keyring 行为按 macOS 和 Windows 分别测试。

**验收**：无凭证进入登录；登录成功后能恢复会话；refresh 失败明确进入重新登录；退出登录清除会话和运行时凭证。

### 阶段 3：model key provisioning 和 provider 注入

**目标**：把登录后的 TFlow 会话变成可用的 TFlow provider 配置。

**计划改动**：

- 实现 key 查询和必要时创建；
- 对 key 响应做 wire-level runtime validation；
- 记录 key 所属分组、schema 版本和来源；
- 将 gateway base URL / model key 映射到现有 Host/provider config seam；
- 在启动、登录、refresh、key rotation、logout 时同步 provider runtime；
- 让初始化失败进入可恢复状态，而不是进入“已登录但不可对话”状态。

**测试**：现有 key、创建 key、重复创建保护、key 失效、refresh 后重新注入、logout 清理、敏感字段不出日志；Host 启动读取的是 TFlow provider，而不是 DeepSeek 默认 provider。

**验收**：无手工 provider/key 配置即可启动 TFlow 模型调用；TFlow key 不进入用户可编辑的通用 provider UI。

### 阶段 4：模型目录和模型选择

**目标**：获取 TFlow 模型并接入现有模型选择器。

**计划改动**：

- 实现 TFlow gateway adapter；
- 请求 `{gateway}/v1/models`；
- 校验 OpenAI-compatible response；
- 映射到现有模型目录/selector 类型；
- 明确加载、空列表、鉴权失败、网络失败和协议错误 UI；
- 默认模型选择只能来自 TFlow 返回目录。

**测试**：正常目录、多模型、空目录、缺 `data`、缺 `id`、401、429、超时、模型切换和对话请求。

**验收**：模型选择器显示 TFlow 模型并能发起一次真实或录制的 TFlow 对话；任何失败不会静默回退 DeepSeek 模型。

### 阶段 5：账户菜单、余额和订阅

**目标**：在已有 Desktop 账户菜单/账户 UI seam 中展示 TFlow 账户状态。

**计划改动**：

- `TFlowAccountAdapter`：当前用户、余额、订阅/分组、日/周/月额度；
- typed DTO：账户标识、余额、订阅状态、周期额度和错误状态；
- 账户菜单入口、加载、刷新、失败、登录失效和退出登录；
- 账户/订阅跳转 `https://tflow.online`；
- 不在 Renderer 传递原始 account API 响应或 credential；
- 不由客户端推算服务端余额或额度。

**展示规则**：

- 有余额无订阅：展示余额，订阅区域显示无订阅；
- 有订阅：展示分组/套餐、状态和服务端提供的周期剩余值；
- 过期：显示过期状态并提供网站管理入口；
- 余额或订阅加载失败：独立显示失败并允许刷新，不破坏已经可用的模型会话；
- 401：统一刷新会话；刷新失败则清理账户 UI 和模型会话。

**测试**：账户正常、余额为零、无订阅、订阅有效、订阅过期、周期字段缺失、非 JSON、401、刷新和退出登录。

### 阶段 6：端到端和发布验证

**目标**：验证两个明确发布目标，不扩展平台范围。

**macOS arm64**：

- development startup；
- 登录、key 注入、模型列表、对话、账户菜单和订阅手工 smoke；
- 打包、签名/未签名本地验证、用户数据目录和 keyring；
- 更新路径 smoke。

**Windows x64 / Windows 10**：

- Windows 10 启动、登录、key 注入和模型对话；
- 安装/卸载、用户数据目录、凭证存储；
- x64 打包和更新路径；
- 验证不存在 macOS-only API 或不兼容原生依赖。

**安全验收**：扫描构建日志、Renderer 可见状态、配置文件、崩溃错误和发布目录，确认没有密码、token、验证码或完整 model key。

## 4. 文件级预期变更面

以下是调查后的预期范围，不是允许无审查修改的文件清单：

| 区域 | 预期职责 |
|---|---|
| `apps/desktop/src/main.ts` | 生命周期、IPC 注册、provider/credential 初始化接入 |
| `apps/desktop/src/preload-*.ts` | 最小 typed API 暴露 |
| `apps/desktop/src/locale.ts` | TFlowBuddy 相关 locale |
| `apps/desktop/src/client/*`、welcome | 登录/欢迎入口 |
| `apps/desktop/src/account-backend.ts`、账户 UI seam | 账户状态和菜单适配 |
| `apps/desktop/src/host-process.ts`、host protocol | provider 环境/运行时同步 |
| `packages/credentials/*` | 复用或扩展凭证存储，不泄露 DeepSeek 账户边界 |
| `packages/llm/*` | 仅在现有 provider seam 不足时增加 TFlow provider 能力 |
| `apps/desktop/resources/*` | TFlowBuddy 图标和平台资源 |
| `apps/desktop/scripts/*` | 仅调整 mac-arm64 / win-x64 打包选择和检查 |
| `apps/desktop/tests/*` | 单元、集成、发布 smoke 和敏感信息检查 |

如果某项可以由现有 seam 完成，不新建包；如果需要新包，必须说明 Service Definition、Provider、Consumer 三者及其测试。

## 5. TypeSafe 对计划的分析

### 5.1 输入状态

```json
{
  "approvedDesign": "方案 A，加入余额、账户菜单和订阅展示",
  "releaseTargets": ["macOS arm64", "Windows x64"],
  "windowsMinimum": "Windows 10",
  "clients": ["TFlowBuddy macOS desktop", "TFlowBuddy Windows desktop"],
  "notInScope": ["web", "cli", "mobile", "broker", "payment", "recharge", "plan mutation"],
  "implementationStages": [
    "baseline and platform matrix",
    "brand and identity",
    "auth and credentials",
    "key provisioning and provider injection",
    "models",
    "account balance subscription",
    "e2e and release"
  ],
  "uncertainties": [
    "TFlow response contracts need confirmation",
    "Windows 10 compatibility needs verification",
    "Harness account/provider seams may need adaptation"
  ]
}
```

### 5.2 结构化判断

| TypeSafe 问题 | 选项/等级 | 代码决策 |
|---|---|---|
| Choice：第一实现落点 | 现有 Desktop seam、独立 adapter、等待 BFF、契约不足 | 优先现有 Desktop seam；契约不足时暂停实现 |
| Score：阶段风险 | 低/中/高，按可观察失败条件描述 | 认证、凭证、provider、平台分别设门，不用总分掩盖硬风险 |
| Noul：服务端契约是否足够 | yes/no | no 则只做 fixtures/契约准备，不做线上适配 |
| Noul：Windows 10 是否满足运行要求 | yes/no | no 则不能声明 Windows 10 支持 |
| Noul：是否存在凭证泄露路径 | yes/no | yes 则阻断发布，优先修复 |
| Choice：账户展示优先级 | 余额优先、订阅优先、并列展示、状态不足 | 保留服务端原始语义，代码显式组合，不由模型决定权限/金额 |

TypeSafe 的建议是：先完成阶段 0 的契约和平台核验，再并行推进品牌、认证、账户 DTO 和模型 adapter 的测试设计；阶段 3 的 provider 注入是所有模型功能的硬依赖，阶段 5 可以在 API fixture 完成后与阶段 4 并行开发，但不能绕过凭证边界。

### 5.3 风险排序

1. **高风险**：TFlow 服务端接口字段/错误码未冻结；
2. **高风险**：Windows 10 与 Electron 44/原生依赖/更新器兼容性；
3. **高风险**：provider 注入生命周期与 refresh/key rotation 不一致；
4. **中风险**：现有 Desktop 账户菜单是 DeepSeek 专用边界，需确认可否安全替换；
5. **中风险**：macOS/Windows 凭证存储语义不同；
6. **中风险**：余额/订阅状态组合和字段缺失；
7. **低风险**：TFlowBuddy 品牌资源和 locale 替换。

## 6. 提交和 Agent 执行策略

### 本阶段

- 设计文档和计划文档独立提交；
- 计划提交前只运行 Markdown 检查、`git diff --check` 和文档自审；
- 不推送功能代码；
- 不启动 `luna high`。

### 用户拍板后

用户确认计划后，主 Agent 再使用 `luna high` 启动子 Agent。子 Agent 必须：

- 先读取本计划、设计稿、根 `AGENTS.md`、`docs/architecture.md`、`docs/defensive-patterns.md`；
- 按阶段提交，禁止一次性大改；
- 每阶段先测试后实现（TDD）；
- 不修改 `upstream` 历史或远程配置；
- 不越过“服务端契约”和“Windows 10 兼容性”硬闸门；
- 每阶段报告实际修改文件、测试命令、失败原因和未验证项；
- 主 Agent 在每个阶段结束后审查并决定是否继续。

### 建议子 Agent 分工

不是按 Web/CLI 等客户端分工，而是按桌面能力分工：

1. `desktop-foundation`：阶段 0/1，基线、identity、brand、locale、资源；
2. `tflow-auth`：阶段 2/3，认证、凭证、key provisioning、provider 注入；
3. `tflow-account-ui`：阶段 5，账户菜单、余额、订阅 DTO/UI；
4. `desktop-release`：阶段 6，mac arm64、Windows x64、Windows 10 发布验证。

阶段 2/3 与阶段 5 只有在共享 DTO 和 credential 接口冻结后才可并行；否则保持顺序执行，避免共享状态冲突。

## 7. 计划验收

计划获批后，最终实现完成的必要条件是：

- 两个平台只显示 TFlowBuddy 身份；
- 登录、refresh、logout 可恢复；
- model key 从主进程安全注入；
- 模型目录和对话只使用 TFlow provider；
- 账户菜单显示账户和余额；
- 订阅信息显示服务端提供的状态和周期剩余值；
- 交易操作只跳转 TFlow 网站；
- macOS arm64 与 Windows x64 通过对应 smoke；
- Windows 10 兼容性有实际验证证据；
- 关键错误和敏感字段测试通过；
- 没有 Web、CLI、Broker 或其他客户端实现；
- 主 Agent 完成最终验证后，才能声称任务完成。
