# TFlowBuddy 真机验证清单

> 用途：在真机上验证 TFlowBuddy 的登录到对话主链路。当前实现的所有验证都在单元层，Host RPC、面板调用与 profile patch 播种从未对真实服务执行过。
> 依据：`docs/tflowbuddy-account-surface-decision.md` 的 TypeSafe 判断结论——先完成本清单，再决定下一步。

## 0. 前置：终端环境

本机 shell 导出了 `GIT_CONFIG_COUNT=1` 但没有配对的 `GIT_CONFIG_KEY_0`，任何 `git` 子进程都会以 `missing config key GIT_CONFIG_KEY_0` 失败。这会影响需要读 git 的构建步骤。先执行：

```sh
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=credential.helper
export GIT_CONFIG_VALUE_0="!'/Users/turingcat/Library/Application Support/app.codeg/git-credential-codeg.sh'"
```

首次启动会准备运行时（`apps/desktop/.desktop-build/`），可能耗时较长。

## 1. 启动

```sh
cd /Users/turingcat/Project/TFlowBuddy
pnpm run dev:desktop
```

**通过条件**：应用窗口打开，显示中文登录页（品牌位图 +「登录 TFlowBuddy」+ 邮箱/密码输入框）。

**若失败**，记下窗口内或 Electron 控制台的原文。可能的早期失败：

| 现象 | 最可能的原因 |
|---|---|
| 窗口空白或报 `preload` 错误 | `lib/preload-tflow.cjs` 未构建；先跑 `pnpm --filter @deepseek-ai/dsh-desktop build` |
| 登录页显示「正在连接 TFlow 服务…」且登录按钮灰 | `GET https://tflow.online/api/v1/settings/public` 未返回，按钮按设计被禁用 |
| 启动即进工作区 | 上一次运行留下了可用凭证，跳到第 3 步 |

## 2. 登录

输入 **邮箱 → 密码 →（如面板要求）验证码 →（如开启）TOTP 6 位码 → 确认分组**。

**通过条件**：出现「已登录 / 正在打开工作区…」，随后主窗口显示工作区。

**若失败**，把界面上的中文错误原文记下来。按失败分类对照：

| 界面文案 | 分类 | 含义 |
|---|---|---|
| 无法连接 TFlow 服务，请检查网络 | `network` | 面板不可达 |
| 请求超时，请稍后重试 | `timeout` | 15s 内未响应 |
| 邮箱或密码错误 / 验证码错误 | `unauthorized` / `service` | 凭据或验证码被拒，可重试 |
| 账号已停用 | `forbidden` | 账号级拒绝，不可重试（不会显示「重新登录」） |
| TFlow 服务响应格式异常 | `protocol` | 面板字段与契约不符——**这是最需要反馈的一类** |
| 当前账号没有可用的模型分组 | `service` | 账号无可用分组 |
| TFlow 网关未返回可用模型 | `protocol` | 密钥已签发但网关模型列表为空 |

## 3. 模型与默认模型

登录成功后确认：

1. 模型选择器里出现的是 **TFlow 网关返回的模型**，且没有 `deepseek-flash` 之类的 DeepSeek 模型。
2. 新建对话直接用上第一个模型，不需要手动选。

若第 1 条不成立，检查 `$DSH_HOME/profiles/desktop/cordis.patch.yml`（即 `~/.dsh/profiles/desktop/cordis.patch.yml`）是否含 `deepseek-account` 与 `llm-deepseek` 两条 `disabled: true`——这是本次新增的 edition overlay，从未被真实启动读过。

## 4. 对话

发一条消息。

**通过条件**：收到模型回复。

**若失败**：`MISSING_CREDENTIAL` 表示模型密钥没写进 Host 凭证 seam（`credentials/set` 这一跳）；`no adapter` 类错误表示 provider 路由没注册（`llm-pi-ai` 这一跳）。两者都指向 Host RPC 层，也就是本次判断认定的未验证环节。

## 5. 需要反馈的内容

请把以下信息带回来，不必自行排查：

1. 卡在第几步，以及界面/控制台里的**原文**（不要转述）。
2. 是否出现过上面表格里的 `protocol` 类错误。
3. `~/.dsh/profiles/desktop/cordis.patch.yml` 的内容（只有插件开关，没有密钥）。
4. `~/.dsh/profiles/desktop/` 下是否存在 `tflow-credentials.json`——**若有，不要贴内容**，只回答是否存在；它含有密封后的令牌。

## 6. 本次验证不覆盖

- 打包、签名、安装包与更新路径（阶段 6）。
- Windows 真机（本机为 macOS）。
- 工作区的账户/余额/订阅界面：按 TypeSafe 判断结论，该界面等本清单通过后再建，尚未实现。
