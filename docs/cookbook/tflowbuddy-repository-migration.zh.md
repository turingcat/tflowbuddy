# TFlowBuddy 仓库迁移

[English](tflowbuddy-repository-migration.md) | 中文

## 仓库归属

迁移将旧仓库保留为 `tflowbuddy-legacy`，向新的公开 `turingcat/tflowbuddy` 仓库的 `main` 上传无父提交的产品快照。备份和旧工作目录分别保留，不上传本地修改、凭据、旧标签或旧提交对象。产品版本为 `0.1.1`，迁移不发布标签。

## 工作流前置条件

配置审核后仅 CI、Sandbox、Node Addon System、Release TFlowBuddy Desktop 可启用。CI 使用 GitHub 托管 runner，现有测试失败仍如实失败。Desktop 发布仍受单独跟踪的 Electron 40 原生运行时和 Windows ia32 构建失败阻塞。

继承的备用工作流需要匹配的自托管基础设施。真实 API E2E 需要各自注明的密钥。预览及部署需要产品拥有的托管和凭据。议题及 weighted-approval 工作流需要审核项目策略及其引用的应用或凭据。这些工作流迁移期间保持停用；列出密钥名称不代表迁移密钥值。

## 验证和恢复

改名前验证备份、导出字节、权限、符号链接、凭据扫描及文件大小。新仓库首次推送前禁用 Actions。只推送 `main`，验证不同仓库身份、无父初始提交、远程一致和原本地修改未变。贡献者界面刷新可能晚于 Git 祖先验证。

外部步骤失败时保留两个仓库并记录最后完成步骤。不删除仓库、不强推、不移动发布标签、不覆盖原工作目录。只有原名称空闲时才考虑改回。后续上游导入使用[同步流程](tflowbuddy-upstream-sync.zh.md)。
