---
kind: upgrade-guide
description: "TFlowBuddy 登录会替换 TFlow 提供商配置，并移除旧的 9router 提供商。"
---

# TFlowBuddy 登录时刷新模型提供商

[English](guide.md) | 中文

## 变更

TFlowBuddy 以前会将网关路由合并到已保存的提供商设置。现在登录会用当前网关配置和模型列表替换 `llm-pi-ai.providers.tflow`，并移除 `llm-pi-ai.providers.9router`。TFlow 路由上的自定义字段不再在登录后保留。其他提供商配置和历史会话保持不变。

## 迁移

1. 如需保留独立配置的网关，在登录前通过模型设置将其保存为 `tflow`、`9router` 以外的提供商名称。这两个名称分别保留给桌面账号流程和旧路由清理。
2. 登录 TFlowBuddy，或重启应用以恢复登录。确认模型选择器显示 TFlow 当前模型，且不再包含 9router 分组。
3. 新建会话以使用更新后的默认模型。已有会话保留日志中的模型选择；若旧路由不可用，请手动更换模型。
