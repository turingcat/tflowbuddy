# Agent Note: TFlowBuddy 桌面发行版

Status: implemented

[English](2026-09-22-tflowbuddy-desktop-edition.md) | 中文

## Problem

`apps/desktop` 中的 Electron 桌面外壳呈现的是 DeepSeek 产品：窗口、菜单、关于面板、欢迎流程、图标、安装包与更新产物都带 DeepSeek Harness 身份，登录路径驱动的是 TFlow 账号持有者无法完成的 DeepSeek Platform 浏览器授权。TFlow 部署通过自己的 sub2api 面板签发模型密钥、通过 OpenAI 兼容网关提供模型，因此账号持有者既没有可用于登录的 DeepSeek 账号，也没有可粘贴的密钥。

要交付的产品是 TFlow 账号的桌面客户端：只发布 macOS Apple Silicon 与 Windows x64，不做 Web 客户端、不做 CLI、也没有需要协调的第二类客户端。其读者是不使用终端的中文桌面用户，因此每条用户可见路径都必须不依赖终端。

## Decision

一个 edition manifest 与一条登录流程负责产品身份与账户会话；其余部分保持共享 Harness 运行时不变。

### 产品身份集中在一个 manifest

`apps/desktop/src/edition.ts` 声明显示名称、bundle identifier、URL scheme、协议名、Windows 应用标识、可执行文件与产物 stem、图标 stem、账户站点与 site kind，并校验每个值都是操作系统、安装器和协议注册表能够表达的形式。所有消费方都读取它：`main.ts` 设置 `app.name` 与关于面板，`locale.ts` 组合提及产品名的文案，`electron-builder-config.mjs` 据此推导 `appId`、`protocols`、`productName`、产物名、DMG 标题与图标路径。`resolveDesktopAppId` 缺省即 edition bundle identifier，因此发布环境无需重复一个本就属于产品的反向域名标识。

不一致会表现为测试失败而不是构建期的意外：`tests/edition.spec.ts` 用 manifest 断言打包配置，并拒绝仍写出已退役产品名的源码。

### 登录即面板自身的流程

欢迎窗口收集邮箱、密码、可选验证码凭证和 TOTP 验证码，然后让用户确认面板报告的分组，因为该部署会拒绝未分组的密钥。`src/tflow/protocol.ts` 承载 sub2api 契约，`src/tflow/session.ts` 编排顺序，`src/tflow/login-backend.ts` 为进程持有该流程，`src/tflow/login-ipc.ts` 为单个窗口注册 typed 通道并在窗口关闭时移除。渲染进程收到的是闭合的 view union，只携带文案与安全值；任何 token、模型密钥或面板原始响应都不跨越 IPC 桥，渲染进程提供的每个字段都在主进程校验。

只有当网关为新签发的密钥返回非空目录后，流程才会进入 `authenticated`，因此工作区不会在无法对话的状态下打开。

### 凭证由桌面端持有并用平台保险库封装

`src/tflow/credentials.ts` 持久化一条带版本号的记录，包含面板令牌、模型密钥及其所属地址。两个密钥在进入文档前先由平台保险库封装；`src/tflow/vault.ts` 是唯一触碰 Electron API 的 TFlow 模块，使用 `safeStorage`，且不做明文回退——无法加密的平台会拒绝写入。记录位于 Electron 的按用户数据目录，这将外壳会话与 Host 的凭证文档分开，但保护本身并不来自位置。

### 模型 provider 复用现有适配器

登录后的路由通过 `src/host-rpc.ts` 发布到 `llm-pi-ai` settings 命名空间，形式是手工声明的 `openai-completions` 网关：`baseURL` 为面板公布的网关地址，模型列表即网关刚返回的目录。密钥经 Host 凭证 seam 以 `TFLOW_MODEL_KEY` 写入，因此没有密钥进入 settings 文档，模型页看到的是一条路由而不是一个密钥。

### 退役的 DeepSeek 界面是移除而非隐藏

DeepSeek Platform 账户视图及其 preload、`dshPlatform` 桥、设置页中的浏览器登录、以及粘贴 API Key 的引导流程均已移除。locale 字典删除了这些流程拥有的键，并在两种语言中保持同一套键。

### 语言

欢迎窗口无论操作系统语言如何都以简体中文打开，因为产品读者是中文桌面用户且面板以中文应答。工作区保留共享语言偏好。

### 本构建实现的面板契约

面板是服务于 `https://tflow.online` 的 sub2api 部署，其契约是逐字段对照服务端源码核验的，而不是从已退役的 AIBuddy 实现推断。每个面板响应都是信封 `{ code, message?, reason?, data? }`，其中 `code === 0` 表示成功：

| 用途 | 请求 | 读取字段 |
|---|---|---|
| 公开设置 | `GET /api/v1/settings/public` | `aliyun_captcha_*`、`api_base_url` |
| 登录 | `POST /api/v1/auth/login` | 请求 `email`、`password`、`turnstile_token`；响应 `access_token`、`refresh_token?`、`requires_2fa`、`temp_token?`、`user_email_masked?` |
| 二次验证 | `POST /api/v1/auth/login/2fa` | 请求 `temp_token`、`totp_code` |
| 刷新 | `POST /api/v1/auth/refresh` | 请求 `refresh_token`；响应轮换令牌对 |
| 账户 | `GET /api/v1/auth/me` | `email`、`balance` |
| 模型密钥 | `GET /api/v1/keys`、`POST /api/v1/keys` | `name`、`status`、`key`、`group_id`；创建需 `Idempotency-Key` |
| 分组 | `GET /api/v1/groups/available` | `id`、`name` |
| 订阅 | `GET /api/v1/subscriptions/progress` | `subscription.group_id`、`progress.group_name`、`progress.daily|weekly|monthly.remaining_usd` |
| 模型 | `GET {gateway}/v1/models` | OpenAI 兼容 `data[].id` |

### 本阶段交付内容

edition manifest、欢迎页登录流程、面板协议客户端、保险库密封的凭证记录、登录状态机、按窗口的 IPC 桥、中文欢迎界面、带目录与默认模型的 provider 路由、账户读取，以及账户界面。profile overlay 禁用了本产品无法服务的两行 base bundle 条目。

构建过程中有两点值得保留：签发密钥时必须把所选分组一并持久化，因为账户读取需要按该分组向面板查询订阅，而下一次登录会复用该分组已有的密钥；provider 路由之下的 Host RPC 层从未对真实 Host 执行过，这正是被推迟的验证所针对的风险。

## Alternatives considered

**直接复用 AIBuddy 的桌面实现。** AIBuddy 已有 sub2api 登录、凭证文件与 TFlow 网关 provider。但它是构建在另一套 agent 运行时之上的 Electron 外壳，复用其模块意味着把它的身份、凭证与 provider 层移植进一个已经拥有 Host 侧 provider、凭证与 settings seam 的代码库。sub2api 契约被作为证据与字段名来源复用；代码没有复用，因为这里的 seam 已经存在。

**先把已验证契约落成新的 mock fixture 层。** 本地 mock 可以让实现早于服务端契约被信任之前推进。该部署自身源码在本机可得，因此契约是逐字段对照 handler 与 DTO 核验的——包括登录请求、二次验证交换、轮换式 refresh 授权、密钥列表与创建载荷、分组列表、订阅进度窗口，以及网关模型列表。mock 只会新增一份需要维持正确的契约，而没有留下任何缺口。

**把面板会话存进 Host 凭证 seam。** Host 的凭证文档由 credentials 插件写入、由 provider 读取，且从外壳经 RPC 即可到达。其引用语法是 POSIX 环境变量名，而继承环境优先于该文档，因此存放在那里的桌面会话会被同名无关变量遮蔽，并且会落进用户模型页同样会编辑的文档。外壳自己的会话放进只有外壳写入的文档。

**保留 DeepSeek Platform 登录并在旁边加上 TFlow。** 在读者根本用不了其中之一的设置页里放两个账户入口，比只放一个更糟，而且设计要求 DeepSeek 账户不得出现在 TFlowBuddy 的用户可见路径中。

**复用已安装的 pi-ai catalog 作为该网关。** 省略路由的 `models` 列表会为该路由名提供已安装 catalog，而 TFlow 网关并不是 catalog provider。该路由声明网关公布的模型，这也让网关改名后的模型在下一次登录时可见。

**在 DeepSeek Web 客户端上套 TFlow 品牌位。** 产品决策已排除：本次交付的是 macOS 与 Windows 桌面客户端，浏览器客户端不是发布目标。

## Consequences

桌面外壳如今有了可被测试的产品身份，而不是散落在三个文件里的字面量，也有了渲染进程能据以处置的失败分类登录流程。代价是一个必须跟随上游的 fork：`apps/desktop` 是 DeepSeek Harness 的副本外加一层 edition，上游对外壳、打包输入或 provider 适配器的改动都需要在此重新收敛。

路由上的模型列表在登录时写入而非每次请求读取，因此网关在会话中途更换目录时，要等到下一次登录或刷新才会体现。

工作区仍会注册 base bundle 的 DeepSeek 账户插件与官方模型适配器，因此设置页仍可能呈现 DeepSeek 条目。将它们从 Desktop profile 组合中移除的工作被推迟；locale 字典与欢迎流程已不再引用它们。

`apps/desktop/tests/main-startup.spec.ts` 与 `apps/desktop/tests/installer-packaging.spec.ts` 在完成本工作的环境中无法运行：前者在没有打包好的 Electron 产物时不会结束，后者需要安装器工具链。它们的欢迎路径改动未经执行验证，是首先要重跑的部分。

## Verification

`pnpm run test` 覆盖了不依赖 Electron 的 TFlow 模块全链路：面板契约（含每条已分类失败）、凭证记录的封装与拒绝路径、登录状态机，以及渲染进程契约的投影。`apps/desktop/tests/main-startup.spec.ts` 覆盖进程接线，`apps/desktop/tests/welcome-window.spec.ts` 覆盖按窗口的 IPC 归属以及允许驱动它的 frame。
