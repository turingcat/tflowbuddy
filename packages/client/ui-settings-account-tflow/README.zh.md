---
description: "在桌面端设置面板与侧栏展示已登录的 TFlow 账号、余额与订阅。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-account-tflow

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-client-ui-settings-account-tflow` 是 TFlow 发行版的账号界面。它展示已登录账号的显示名、美元余额，以及覆盖所选模型分组的订阅剩余额度，并链接到 TFlow 网站处理桌面端不负责的部分：充值、购买套餐与更换分组。

该包只在 Electron 外壳加载的渲染进程中激活，通过外壳的账号桥识别。普通浏览器渲染进程，以及存在 Host 账号服务、使用自身账号界面的 DeepSeek 发行版，都不会在此注册任何内容。

## Table of Contents

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在桌面应用加载的浏览器 roster 中挂载本插件。它贡献两个设置席位：通过 `settings.section` 提供账号页面，通过 `settings.launcher` 提供侧栏启动器。

启动器以优先级 1 注册。`settings.launcher` 是单格槽位，同一优先级的两次注册会被拒绝，因此更高的优先级让 DeepSeek 发行版组合它时其启动器保持有效，而在没有它的发行版中由本启动器渲染。

未登录、加载中与读取失败是三种不同状态：未登录会引导登录，加载中不会显示为空，读取失败提供重试且不影响已建立的模型会话。面板未上报的周期不渲染为零，本构建无法渲染的载荷报为失败而不是渲染半张卡片。

<a id="understand-the-implementation"></a>
## 理解实现

`src/client/AccountSection.tsx` 渲染页面与启动器菜单；两者都通过 `useAccount` hook 席位消费同一份快照，并通过 inject face 调用 `refresh` 与 `manage`。`src/client/index.ts` 在 apply 时读取外壳的 `dshDesktopAccount` 桥一次，向订阅者发布快照，把并发刷新合并为一次请求，并在载荷到达组件之前完成校验。

本包不持有会话状态，也不持有凭证。面板会话、模型密钥与令牌生命周期属于 `apps/desktop`，由它拥有登录流程；本包只渲染该流程上报的结果。

<a id="further-exploration"></a>
## 延伸阅读

- [账号区块](src/client/AccountSection.tsx) —— 页面、启动器菜单与快照契约。
- [注册](src/client/index.ts) —— 桥接校验与两处席位注册。
- [文案](src/client/locales.ts) —— 英文与中文字典。
- [Electron 外壳账号流程](../../../apps/desktop/src/tflow/login-backend.ts) —— 本界面读取的会话。
- [桌面发行版决策记录](../../../.agents/notes/implemented/architecture/2026-09-22-tflowbuddy-desktop-edition.zh.md) —— 为什么 TFlow 发行版拥有自己的账号界面。

<a id="model-experience"></a>
## 模型体验

无。账号凭证只影响 HTTP 鉴权，从不进入模型提示词、会话日志或工具结果。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 界面在挂载时读取一次账号，之后按需读取。它不做轮询：外壳的账号读取会打到 TFlow 面板，而后台轮询会为用户并未查看的数值持续消耗面板请求。
- 余额与订阅只在外壳上报时才渲染。面板自身对「该分组没有订阅」的表达会显示为「当前分组没有订阅」，而不是零余额。
- 订阅展示覆盖面板上报的日、周、月三个周期。面板未上报的周期不显示，且不在本地推算任何额度。
- 此处不提供退出登录。会话属于 Electron 外壳，而本产品没有可返回的未登录工作区；需要更换账号的用户通过重新登录完成。
- 本包在普通浏览器渲染进程的 roster 中渲染但贡献为空，注册测试覆盖了这一点。要在此桌面外壳之外复用它，需要一个形状相同的桥。

<a id="dev-note"></a>
### Dev Note

[桌面发行版决策记录](../../../.agents/notes/implemented/architecture/2026-09-22-tflowbuddy-desktop-edition.zh.md) 记录了为什么账号界面读取外壳桥而不是 Host 账号 Remote，以及 DeepSeek 发行版保留了什么。
