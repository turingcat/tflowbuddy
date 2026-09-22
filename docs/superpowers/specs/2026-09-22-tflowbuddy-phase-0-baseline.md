# TFlowBuddy 方案 A 阶段 0 基线

> 状态：阶段 0 产出，供后续阶段引用。
> 日期：2026-09-22
> 设计依据：`2026-09-22-tflowbuddy-scheme-a-design.md`
> 实施计划：`2026-09-22-tflowbuddy-scheme-a-implementation-plan.md`

## 1. 硬闸门结论

### 1.1 TFlow 服务端契约 —— 已冻结

契约以本机 `/Users/turingcat/Project/sub2api`（tflow.online 服务端源码，远端 `Wei-Shaw/sub2api`）为准，逐项核对到 handler 与 DTO。所有面板接口的响应信封为 `{ code, message?, reason?, data? }`，`code === 0` 表示成功。

| 用途 | 请求 | 关键字段 |
|---|---|---|
| 公开设置 | `GET /api/v1/settings/public` | `aliyun_captcha_enabled`、`aliyun_captcha_scene_id`、`aliyun_captcha_prefix`、`aliyun_captcha_region`、`api_base_url` |
| 登录 | `POST /api/v1/auth/login` | 请求 `email`、`password`、`turnstile_token`；响应 `access_token`、`refresh_token?`、`requires_2fa`、`temp_token?`、`user_email_masked?` |
| 二次验证 | `POST /api/v1/auth/login/2fa` | 请求 `temp_token`、`totp_code`（长度 6）；响应同登录 |
| 刷新 | `POST /api/v1/auth/refresh` | 请求 `refresh_token`；响应 `access_token`、`refresh_token`（服务端轮换，必须整体回写） |
| 账户 | `GET /api/v1/auth/me` | `email`、`username`、`balance`（美元） |
| Key 列表 | `GET /api/v1/keys?page&page_size&search&status&group_id` | `items[]`，每项含 `name`、`status`、`key`、`group_id` |
| Key 创建 | `POST /api/v1/keys` | 请求 `name`、`group_id`（数字）；支持 `Idempotency-Key` 头 |
| 可用分组 | `GET /api/v1/groups/available` | `data` 为 `{ id, name }` 数组 |
| 订阅进度 | `GET /api/v1/subscriptions/progress` | `data[]`，每项 `subscription.group_id` 与 `progress.group_name`、`progress.daily/weekly/monthly.remaining_usd` |
| 模型目录 | `GET {gateway}/v1/models` | OpenAI 兼容 `{ object, data: [{ id }] }`，Bearer 模型 Key |

网关基址由 `settings.public` 的 `api_base_url` 提供，模型调用使用 `{api_base_url}/v1/chat/completions`。键名与 AIBuddy 现网实现一致，因此无契约缺口，也不需要 mock fixture。

### 1.2 Windows 平台下限 —— 与计划冲突，已改判

仓库锁定 Electron 44（`pnpm-lock.yaml` 解析为 `electron@44.0.0`），而上游自 Electron 40 起已将最低 Windows 版本提升到 Windows 11。因此计划中的「Windows 10 为最低支持版本」无法在不降级 Electron 主版本的前提下成立。

用户已确认按 Windows 11 重新确认需求；设计文档第 7 节已同步。降级 Electron 会同时触碰版本资格、代码签名、运行时准备锁和发布测试，不属于本方案范围。

## 2. TFlow 适配点清单

| 关注点 | 现有 owner | TFlow 落点 |
|---|---|---|
| 产品身份 | `apps/desktop/src/main.ts` 内联字面量 | `apps/desktop/src/edition.ts`（已完成） |
| 外壳文案 | `apps/desktop/src/locale.ts` | 同左，产品名取自 edition（已完成） |
| 打包身份 | `apps/desktop/scripts/electron-builder-config.mjs` | 同左，读 edition manifest（已完成） |
| 应用标识 | `apps/desktop/scripts/desktop-release-environment.mjs` | `DSH_DESKTOP_APP_ID` 缺省取 edition bundleId（已完成） |
| 图标资源 | `apps/desktop/resources/icon-*.png` | `icon-tflowbuddy.{icns,ico,png,svg}`（已完成） |
| 欢迎页品牌位图 | `apps/desktop/renderer/assets/welcome-brand.svg` | `welcome-brand.png`（已完成） |
| 账户后端 | `apps/desktop/src/account-backend.ts` 包装 `@deepseek-ai/dsh-deepseek-account` | 新增 TFlow 面板适配器，替换该包装 |
| 账户入口元数据 | `apps/desktop/src/welcome-backend.ts` | 登录态由 TFlow 适配器提供；API Key 写入改走 TFlow model key provisioning |
| 凭证存储 | `packages/credentials/{credentials,credentials-local,authorization}`、`deepseek-account` | 复用通用 credentials seam，新增 TFlow 专用 ref 与记录类型 |
| provider 注入 | `packages/bundle/base/cordis.patch.yml` 的 `llm-pi-ai` 与 `llm-deepseek` 条目 | 新增 TFlow provider 路由，指向 `{api_base_url}/v1` |
| 模型目录 | `packages/llm/llm` 的 provider 目录与模型选择器 | TFlow 模型来自 `/v1/models`，不落回 DeepSeek 默认 |
| 账户 UI | `packages/client/ui-settings-account`、`packages/api/account-controller` | 账户 DTO 适配到现有设置页账户区块 |

## 3. DeepSeek 用户可见入口清理清单

| 位置 | 现状 | 处理阶段 |
|---|---|---|
| `apps/desktop/src/main.ts` | About 面板、协议注册、`app.name` | 阶段 1（已完成） |
| `apps/desktop/src/locale.ts` | 22 处产品名 | 阶段 1（已完成） |
| `apps/desktop/scripts/electron-builder-config.mjs` | `productName`、`protocols`、`artifactName`、麦克风用途说明 | 阶段 1（已完成） |
| `apps/desktop/tests/expected/**` | 关于面板、应用菜单、欢迎页、致命错误快照 | 阶段 1（已完成） |
| `packages/client/ui-brand-official` | 侧栏品牌位由官方鲸鱼标记与 `DeepSeek Harness` 字标占据，仅在 `DSH_CLIENT_BUILD_PROFILE=official` 时注册 | 阶段 1 剩余项：需要 TFlowBuddy 品牌位与构建 profile 决策 |
| `packages/client/ui-settings-account/src/client/locales.ts` | 「返回 DeepSeek Harness」「登录 DeepSeek Harness 账号」等账户文案 | 阶段 5 |
| `packages/client/ui-settings-models/src/client/locales.ts` | DeepSeek Harness 0.1 测试期公告 | 阶段 4 |
| `packages/client/ui-plugin-manager/src/client/locales.ts`、`ui-sidebar-documentpreview/src/client/office/locales.ts` | 插件安全与文档预览文案中的产品名 | 阶段 6 前统一 |
| `packages/client/ui-primitives` | `FishLogo`、`BrandWordmark` 为 DeepSeek 专用图元 | 阶段 1 剩余项 |

## 4. 构建与测试命令

macOS Apple Silicon：

```sh
pnpm install
npx tsc -b apps/desktop/tsconfig.json
pnpm --filter @deepseek-ai/dsh-desktop build
pnpm run package:desktop:mac:arm64
```

Windows x64（需在 Windows x64 主机执行）：

```sh
pnpm install
pnpm run package:desktop:win:x64
pwsh -NoProfile -File apps/desktop/scripts/smoke-windows.ps1 -Makensis $Makensis -SevenZip $SevenZip -PluginDir $PluginDir
```

聚焦测试：

```sh
npx vitest run --project thread-safe apps/desktop/tests/edition.spec.ts
npx vitest run --project thread-safe apps/desktop/tests/locale.spec.ts apps/desktop/tests/welcome-renderer.client.spec.tsx
```

## 5. 环境限制

以下失败与本方案改动无关，属于当前开发环境前置条件缺失，记录以免误判为回归：

- `apps/desktop/tests/main-startup.spec.ts`、`apps/desktop/tests/installer-packaging.spec.ts` 在无 Electron 打包产物的环境下超时。
- 依赖代码签名硬件、`makensis`、Windows 主机的用例（`windows-signing-*`、`macos-notarization-proxy`、`installed-update-*`、`upload-with-credentials`）失败。
- 环境同时设置 `NO_COLOR` 与 `FORCE_COLOR`，Node 的告警文本进入子进程 stderr，使 `host-process.spec.ts` 的 stderr 断言失配。
- 环境导出的 `GIT_CONFIG_COUNT=1` 与 `GIT_CONFIG_KEY_0` 不匹配，任何 `git` 子进程都以 `missing config key GIT_CONFIG_KEY_0` 失败，影响 `desktop-build-commit.spec.ts` 与 `package-target-errors.spec.ts`。
