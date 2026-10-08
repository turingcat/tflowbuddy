# 将 dsh 更新同步到 TFlowBuddy

[English](tflowbuddy-upstream-sync.md) | 中文

## 范围

通过产品同步分支导入代码差异，不导入上游提交祖先。上游保留在独立目录。根产品版本保持独立，许可证和来源署名保留。

## 导入

1. 从干净的产品 `main` 开始，在 `.upstream/dsh.json` 查看上次导入版本。
2. 在独立上游目录拉取所需分支，选择目标前审核上游变化范围。
3. 在产品目录运行准备命令：

```sh
pnpm run upstream:sync --upstream-dir ../deepseek-harness-source --target origin/master --branch sync/dsh-20261008
```

4. 审核暂存修改，包括品牌、账户集成、仓库指令、工作流设置、删除和包依赖。工具不通过静默跳过文件来保护定制。
5. 依赖变化时运行 `pnpm install --lockfile-only --ignore-scripts`，再运行 `pnpm run product:version:check` 及受影响测试，暂存生成的锁文件和记录。
6. 同时提交导入代码和 `.upstream/dsh.json`。只推送产品同步分支，开指向 `main` 的 PR，审核和检查后合并。不 merge 上游引用，不使用 `--allow-unrelated-histories`。

## 冲突

应用失败保留分支和索引，不改变上游记录。用 `git diff --name-only --diff-filter=U` 检查冲突，逐个解决并暂存文件，通过 `pnpm run product:version:set <product-version>` 保留根产品版本。全部冲突解决后，将记录更新为独立上游目录已验证的完整目标版本，重新生成受影响输出，检查版本、测试后再提交。基础文件缺失、上游历史改写和子模块变化须明确审核，不自动完成。

工具要求在干净 `main` 上使用新的 `sync/` 分支名。重复导入已记录版本不进行修改。放弃工作前，先明确保留或丢弃冲突修改；工具不会替你 reset 或清理工作目录。
