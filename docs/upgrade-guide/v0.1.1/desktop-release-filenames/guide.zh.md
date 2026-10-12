---
kind: upgrade-guide
description: "桌面工作流安装包文件名现在包含平台名称和共享的发布时戳。"
---

# 桌面发布安装包文件名

[English](guide.md) | 中文

## 变更

GitHub Releases 之前使用 `tflowbuddy-<version>-<os>-<arch>.<extension>`。桌面工作流现在发布 `TFlowBuddy-<platform>-v<version>-YYYYMMDDhhmm.<extension>`，平台名称为 `Win32`、`Win64` 和 `MacOS`，三个产物共用同一个北京时间戳。构造旧文件名的脚本必须修改。应用版本和本地打包输出保持不变。

## 迁移

1. 更新发布下载脚本以选择新产物名称；Windows ia32 对应 `Win32`，Windows x64 对应 `Win64`，macOS ARM64 对应 `MacOS`。
2. 对于 COS 下载，不使用缓存读取 `tflowbuddy/VERSION`。去掉首尾空白后的内容为 `<version>-YYYYMMDDhhmm`，没有前缀 `v`。将该值用于 `tflowbuddy/TFlowBuddy-<platform>-v<VERSION>.<extension>`。配置 CDN 排除 `/tflowbuddy/VERSION` 的缓存，并刷新已有响应。
3. 验证三个 GitHub 产物和 COS 对象共用 `VERSION` 记录的后缀。[桌面发布参考](../../../../apps/desktop/README.zh.md#release-versions)说明 GitHub Environment 配置和发布失败行为。
