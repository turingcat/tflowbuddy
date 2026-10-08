# TFlowBuddy 方案 A 设计

> 状态：设计已根据用户确认冻结，等待用户审阅。本文不包含实现代码。

> 日期：2026-09-22

## 1. 目标和边界

TFlowBuddy 是面向 TFlow 账户的 Electron 桌面客户端。第一阶段在 DeepSeek Harness 的 `apps/desktop` 中完成 AIBuddy 产品能力迁移，支持登录、凭证注入、模型获取、余额、账户菜单和订阅信息展示。

客户端只发布两个目标：macOS Apple Silicon（arm64）和 Windows x64。Windows 最低支持 Windows 11（第 7 节记录与 Windows 10 的冲突及改判）。不提供 Web、CLI、移动端、Linux、macOS Intel、Windows arm64 或本地 Broker 服务。

**目标读者是只使用中文桌面应用、不使用命令行也不使用浏览器的普通用户。** 因此：

- 用户可见路径全部以简体中文呈现，欢迎页与登录流程无论操作系统语言如何都以中文打开；工作区保留共享语言偏好；
- 不要求用户理解环境变量、模型密钥或配置文件，也不提供粘贴密钥的引导；
- 账户相关操作只通过跳转 `https://tflow.online` 完成，桌面端不承载交易。

账户能力只面向当前桌面应用；“多客户端”不属于本项目范围。macOS 和 Windows 是同一桌面客户端的两个发布目标，不要求额外的跨客户端共享服务。

第一阶段不在桌面端实现充值、支付、购买订阅、套餐切换或取消订阅；账户菜单和订阅区域只展示服务端状态，并提供跳转 `https://tflow.online` 进行管理的入口。

## 2. 产品身份

产品专用身份集中在一个 manifest/edition 适配层，不将 TFlow 文案散落在通用桌面组件中。该层负责：

- 显示名称：TFlowBuddy；
- 产品图标和安装包资源；
- 应用协议、bundle/app identity 和用户数据目录标识；
- TFlow 站点 URL；
- 账户菜单、登录页、聊天头部的产品展示；
- macOS arm64 和 Windows x64 的打包身份。

原 DeepSeek 产品身份、DeepSeek 账户登录和官方模型配置不得继续出现在 TFlowBuddy 用户可见路径。通用 Harness 能力继续保留，产品差异必须通过 edition/provider 边界表达。

阶段 1、2 的实现记录见 [TFlowBuddy 桌面发行版 Agent Note](../../../.agents/notes/implemented/architecture/2026-09-22-tflowbuddy-desktop-edition.md)。

## 3. 模块设计

### 3.1 TFlow 认证适配器

主进程中的 `TFlowAuthAdapter` 负责面板账户 API：

- 读取公开登录配置；
- 账号密码登录；
- 验证码证明传递；
- TOTP 二次验证；
- access token 和 refresh token 解析；
- refresh token 换新；
- 退出登录；
- 将服务端错误转换为用户可处理的认证错误。

渲染进程只能通过 preload 的 typed IPC 调用认证操作，不能直接请求账户 API，也不能读取 token。

### 3.2 凭证与 model key

主进程保存一个 TFlow 专用凭证记录，至少包含：

- access token；
- refresh token（如服务端提供）；
- TFlow 面板地址；
- TFlow OpenAI-compatible gateway base URL；
- TFlow model key；
- model key 对应的分组标识（如接口提供）；
- 凭证 schema 版本和产品站点类型。

记录使用现有凭证加密/keyring 机制或其明确的 Desktop 等价实现。Unix 文件权限和 Windows 凭证存储必须分别验证。凭证文件、IPC 返回值、日志和错误对象不得输出 token 或完整 model key。

登录成功后由主进程查询现有 TFlow model key；不存在且服务端允许自动创建时，创建一个产品专用 key。key provisioning 完成后才将会话状态置为可用。

### 3.3 Provider 环境注入

TFlow 适配器将已验证的 gateway URL 和 model key 转换为现有 Desktop Host/provider 可消费的配置。注入只发生在主进程到受管 Host/runtime 的路径中：

```text
TFlow gateway URL -> TFlow provider base URL
TFlow model key   -> TFlow provider API key
selected model    -> existing model configuration
```

不让 TFlow key 进入通用用户配置 UI，不复用 DeepSeek 官方 key 字段，不在 Renderer 中拼装 provider 环境。

### 3.4 模型目录

模型适配器请求 TFlow gateway 的 OpenAI-compatible 模型列表，默认端点为：

```text
GET {gatewayBaseUrl}/v1/models
Authorization: Bearer {modelKey}
```

返回值转换为 Desktop 现有模型目录类型，至少保留模型 ID，并按现有 provider/model selector 的契约展示。以下情况必须有明确状态：网络失败、HTTP 非 2xx、鉴权失败、响应格式错误和空模型列表。空列表不能静默回退到 DeepSeek 默认模型。

### 3.5 账户菜单、余额和订阅

账户 API 适配器负责将 TFlow 面板响应转换为脱敏的 UI DTO：

- 账户展示名或脱敏邮箱；
- 账户余额及货币/显示单位；
- 当前订阅分组或套餐；
- 订阅状态和有效期；
- 日、周、月额度及剩余额度；
- 无订阅、过期、加载中、失败和登录失效状态。

账户菜单只接收 DTO，不接收 token/key。余额和订阅查询使用 access token；401 进入统一 refresh/re-login 流程，其他失败显示可重试错误。余额与订阅是两种可同时存在的服务端状态，UI 不自行推导权益、不自行计算服务端剩余金额。

账户菜单提供：

- 当前账户标识；
- 余额；
- 订阅信息入口/摘要；
- 刷新；
- 打开 TFlow 网站管理账户；
- 退出登录。

购买、充值、改套餐和取消订阅只通过浏览器打开 TFlow 网站，不在桌面端实现交易。

## 4. 主要状态流

```text
启动
  -> 读取 TFlow 凭证
  -> 无凭证：展示登录
  -> 有凭证：验证/刷新会话
  -> 会话有效：检查/恢复 model key
  -> key 有效：注入 provider
  -> 获取模型目录
  -> 进入主界面
  -> 按需加载账户、余额和订阅
```

登录、key provisioning 或模型目录初始化失败时，不进入一个看似可用但无法对话的主界面；应展示具体恢复动作。账户/订阅刷新失败不应破坏已经建立的模型会话，但登录失效必须使账户数据和模型调用同时进入需要重新认证的状态。

刷新会话后，主进程必须重新同步凭证和 Host 注入，避免面板 access token 已更新而运行时仍使用旧值。model key 轮换也必须在更新运行时之前完成持久化。

## 5. IPC 与数据最小化

建议新增或调整以下 typed IPC 能力，具体名称以现有 Desktop API 为准：

- `get-tflow-auth-state`：返回登录状态和脱敏账户摘要；
- `login-via-tflow`：提交账号、密码和验证码证明；
- `complete-tflow-2fa`：提交临时 token 和 TOTP；
- `refresh-tflow-session`：主进程内部或受控调用；
- `logout-tflow`：删除 TFlow 凭证并清理注入；
- `get-tflow-account`：返回账户、余额和订阅 DTO；
- `refresh-tflow-account`：重新读取账户、余额和订阅；
- `list-models-via-tflow`：返回模型 ID 和 UI 所需元数据。

IPC 返回类型使用闭合 discriminated unions 表达成功、认证失效、协议错误、网络错误和服务端错误。渲染进程不能通过 IPC 请求原始 HTTP 响应或原始凭证。

## 6. 错误和安全规则

- 401：先按 refresh token 流程尝试一次；刷新失败后清除会话并要求重新登录；
- 403：显示无权限，不自动重复请求；
- 429：显示限流状态，使用现有受控重试策略，不自行扩大重试次数；
- 非 JSON/字段缺失：视为协议错误，保留安全的用户提示和可诊断日志；
- 超时/网络失败：允许用户重试，不删除有效凭证；
- key provisioning 失败：不将登录状态标记为完全可用；
- 模型列表为空：不自动选用 DeepSeek 或其他未授权 provider；
- 日志只记录请求类别、HTTP 状态、错误分类和 request id（如有），禁止记录 Authorization、密码、验证码、token、key；
- 所有外部服务响应在主进程 wire boundary 做运行时字段校验；
- 账户 DTO 与 credential 类型严格分离。

## 7. 平台和发布设计

只保留两个发布目标：

| 目标 | 架构 | 最低版本 |
|---|---|---|
| macOS | Apple Silicon / arm64 | 按现有 Electron 支持矩阵确认最低 macOS 版本 |
| Windows | x64 | Windows 11 |

阶段 0 核验结论：仓库锁定 Electron 44（`pnpm-lock.yaml`），上游自 Electron 40 起已将最低 Windows 版本提升到 Windows 11，因此 **Windows 10 不在支持范围内**。用户已确认按 Windows 11 重新确认需求。若后续必须支持 Windows 10，只能通过降级 Electron 主版本实现，那会同时改动版本资格、签名、运行时锁和发布测试，需要单独立项。

macOS Intel、Windows arm64、Linux 的构建目标和测试矩阵不属于本次交付。跨平台共享 TypeScript 适配器；平台差异集中在凭证存储、应用路径、打包资源、安装器和更新配置。

## 8. 测试设计

### 单元测试

- 登录成功、TOTP、refresh、退出登录；
- 公开设置和认证响应字段校验；
- key 查询、创建、重复登录幂等；
- 凭证加密、读取、迁移、删除及敏感字段不泄露；
- gateway URL 归一化和 `/v1/models` 响应转换；
- 账户、余额和订阅 DTO 映射；
- 401、403、429、超时、非 JSON、缺字段和空列表；
- IPC 返回 union 的每个分支；
- TFlow brand/edition 的用户可见身份。

### 桌面集成测试

- 无凭证启动进入登录；
- 登录后 key 注入并启动/刷新 Host；
- 模型选择器展示 TFlow 模型并可以发起对话；
- 账户菜单展示账户和余额；
- 订阅信息展示日/周/月剩余额度和过期状态；
- refresh 后模型请求和账户请求使用新凭证；
- 退出登录清除凭证、账户数据和运行时注入。

### 发布验证

- macOS arm64 打包和启动 smoke；
- Windows x64 打包、安装、升级和 Windows 10 兼容性验证；
- 两个平台都不能将 TFlow key 写入日志、渲染进程可见配置或发布产物。

## 9. TypeSafe 决策分析

TypeSafe 只用于对不确定的产品设计选择进行结构化判断；接口字段、加密、HTTP 状态和权限规则仍由普通代码和明确契约决定。

### 输入状态

```json
{
  "goal": "将 AIBuddy 的 TFlow 能力迁移到 DeepSeek Harness apps/desktop",
  "scope": {
    "clients": ["TFlowBuddy macOS arm64", "TFlowBuddy Windows x64"],
    "windowsMinimum": "Windows 10",
    "included": ["login", "model key", "models", "balance", "account menu", "subscription display"],
    "excluded": ["web", "cli", "mobile", "broker", "payment", "recharge", "plan purchase", "plan switching"]
  },
  "candidate": "方案 A：在现有 Desktop 主进程、preload、provider、credential 和 renderer seam 增加 TFlow 适配层",
  "evidence": [
    "AIBuddy 已有登录、2FA、refresh、key provisioning、凭证和 /v1/models 参考实现",
    "DeepSeek Harness 已有 Electron/Desktop Host、provider、账户和发布体系",
    "账户数据和模型网关属于不同服务路径，适合分别适配",
    "本项目不需要 Web/CLI/移动端等第二类客户端"
  ]
}
```

### 判断问题

1. **Choice**：在不引入 Broker 的前提下，TFlow 能力应如何落点：现有 Desktop seam、独立 TFlow adapter package、或先等待服务端 BFF？增加“接口契约不足，暂缓实现”选项。
2. **Score**：分别对实现复杂度、凭证隔离、账户/订阅可测试性、跨平台发布风险、未来桌面版本演进进行评分。评分等级描述具体可观测条件。
3. **Noul**：TFlow 是否已经提供并稳定承诺登录、refresh、key、余额、订阅和 `/v1/models` 的响应字段？未确认时禁止进入代码实现。
4. **Noul**：Windows 10 的 Electron、原生依赖、keyring 和更新器是否全部满足最低版本要求？未确认时禁止声明 Windows 10 支持。

### 代码组合规则

- 服务端字段未确认或 Windows 10 兼容性未确认：设计可继续，实施计划必须列为前置阻塞；
- 凭证泄露风险属于硬否决，不允许被账户 UI 或交付速度的高分抵消；
- 在硬闸门通过后，采用现有 Desktop seam + TFlow adapter；
- TypeSafe 结果只能作为决策材料，不能自动批准实现；最终由用户拍板。

## 10. 实施前待确认清单

1. TFlow 认证、key、余额、订阅和模型接口的正式字段/错误码；
2. TFlow gateway 是否稳定支持 `GET /v1/models` 及聊天请求；
3. 账户余额和订阅同时存在时的展示优先级与文案；
4. 无订阅但有余额、余额为零、订阅过期、订阅额度耗尽等状态；
5. ~~Windows 10 的 Electron/原生依赖/keyring/更新器兼容性~~ —— 已核验为不兼容，平台下限改为 Windows 11（见第 7 节）；
6. TFlowBuddy 图标、bundle identity、协议名和用户数据目录命名；
7. 模型 key 的名称、作用域、轮换与撤销策略。

第 1、2、4、7 项的核验结论见 `2026-09-22-tflowbuddy-phase-0-baseline.md`。

## 11. 用户确认记录

- 已确认采用方案 A；
- 已确认加入余额、账户菜单和订阅信息展示；
- 已确认订阅交易操作只跳转 TFlow 网站，不在桌面端实现；
- 已确认只支持 TFlowBuddy macOS Apple Silicon 和 TFlowBuddy Windows x64；
- 已确认 Windows 最低支持 Windows 10；
- 已确认不支持 Web、CLI、移动端或其他客户端；
- 本文完成后，先由用户审阅设计和计划，再决定是否使用 `luna high` 启动子 Agent 执行。
