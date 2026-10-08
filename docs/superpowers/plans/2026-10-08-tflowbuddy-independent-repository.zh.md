# TFlowBuddy 独立仓库实施计划

[English](2026-10-08-tflowbuddy-independent-repository.md) | 中文

> **执行者要求：** 当前会话自行执行时使用 `executing-plans`；用户选择委派执行时使用 `subagent-driven-development`。按顺序完成任务，任务 4 通过前不得改名仓库。

**目标：** 创建独立的公开 TFlowBuddy 仓库，产品版本为 `0.1.1`，通过审核导入上游代码但不导入上游提交祖先。

**架构：** 外部操作前准备迁移工具并验证导出的快照。上游 Git 历史保留在独立目录，使用支持二进制的补丁导入产品同步分支。原工作目录和原仓库保留为历史记录。

**技术栈：** Node.js ESM、使用现有 tsx 入口的 TypeScript、Git、pnpm、Vitest、GitHub CLI、GitHub REST API。

**设计：** [已批准的独立仓库设计](../specs/2026-10-08-tflowbuddy-independent-repository-design.zh.md)。

## 全局约束

- 新仓库：公开的 `turingcat/tflowbuddy`；默认分支：`main`；旧仓库：`turingcat/tflowbuddy-legacy`。
- 初始产品版本：`0.1.1`；第一方根、应用和包清单统一版本；vendor、依赖、解释器、Electron、Session 和 schema 版本保持独立。
- 导出已提交的 `v0.1.1` 代码快照及明确获批的迁移修改，不复制本地改动、忽略文件、凭据、旧引用或 Git 历史。
- 保留许可证、版权、执行权限、符号链接和原工作目录。不强推、不删除仓库、不移动标签。
- 初次迁移不发布标签；现有 Electron 40 和 Windows ia32 打包失败另行处理。
- 上传和配置审核期间禁用 Actions；不启用不可用 runner、需凭据的定时测试或上游部署。
- 代码导入同时提交代码和新的上游版本记录；冲突不得推进基础记录。

## 审核重点

- 改名可能碰到重名或非预期仓库身份；每次外部变更前校验名称和 ID，不匹配即停止。
- 纯文本复制可能丢失二进制、删除、执行权限或符号链接；对比 Git 树条目并测试二进制导入。
- 并发修改或未解决冲突可能使导入准备无效；要求干净工作区，拒绝已有同步状态，保留冲突证据且不推进基础版本。
- 新私有包和依赖更新可能携带上游版本；只归一化第一方版本字段，同时保留导入的依赖更新。
- 继承工作流可能因 runner 或密钥缺失排队或失败；启用 Actions 前测试 runner 标签、分支触发及停用配置。

## 文件职责

- `scripts/product-version.ts` 负责第一方版本发现、检查和归一化；`scripts/product-version.spec.ts` 负责回归测试。
- `scripts/upstream-sync.ts` 负责显式上游导入命令；`scripts/upstream-sync.spec.ts` 负责临时 Git 仓库集成测试。
- `.upstream/dsh.json` 记录上次导入的上游版本和仓库，不保存凭据或发布版本。
- `scripts/tests/tflowbuddy-workflows.spec.ts` 验证新仓库工作流策略；现有桌面发布测试继续负责安装包行为。
- `docs/cookbook/tflowbuddy-upstream-sync.md` 及其中英文配对负责维护者操作，根指令链接此处而非重复规则。
- `docs/cookbook/tflowbuddy-repository-migration.md` 及其中英文配对负责迁移操作和恢复流程。

## 任务 1：产品版本归属

**文件：** 创建 `scripts/product-version.ts` 和 `scripts/product-version.spec.ts`；修改 `package.json`、`scripts/release/bump.ts`、`.github/workflows/release.yml`、`scripts/tests/desktop-release.spec.ts`；对应维护文档在任务 3 添加。

**接口：** 导出 `checkProductVersions(root: string, tag?: string): string` 和 `normalizeProductVersions(root: string, version: string): string[]`。检查器返回根产品版本或列出不一致路径并抛错。归一化器验证明确的完整版本，仅改写变化的第一方清单版本字段并返回修改路径。

- [ ] 编写失败测试：根和 Desktop 版本为 `0.1.1`，第一方私有包为 `0.2.1-alpha.1`，vendor 为 `2.10.6`。断言检查失败，归一化将私有包改为 `0.1.1` 且不改 vendor 或依赖版本。再添加新的可发布包并断言也被归一化。
- [ ] 运行 `pnpm exec vitest run scripts/product-version.spec.ts`，确认失败来自实现缺失。
- [ ] 仅发现 `package.json`、`apps/*/package.json`、`packages/*/*/package.json`；沿用发布家族清单归属，不包含 fixture、native 包或 `python/sdk-runtime`。保留格式及单个结尾换行。验证预发布版本，非法输入在写入前拒绝。
- [ ] 添加测试：`checkProductVersions(root, 'v0.1.1')` 成功，`checkProductVersions(root, 'v0.1.2')` 抛错。断言归一化保留导入的依赖新增，不改写 Session 或 schema 文件。
- [ ] 添加 `product:version:check` 和 `product:version:set`，分别使用 `tsx scripts/product-version.ts check`、`tsx scripts/product-version.ts set`。CLI 的 `set` 必须有版本参数，不从上游推断版本。取消 dsh bump 路径归一化前的版本不一致拒绝，保留 vendor 家族检查和已有 bump 测试。
- [ ] 发布构建及打包前添加 `pnpm run product:version:check`。现有发布工作流保留精确标签及完整版本验证。测试执行顺序和私有包版本不一致时的拒绝。
- [ ] 运行 `pnpm exec vitest run scripts/product-version.spec.ts scripts/release/families.spec.ts scripts/tests/desktop-release.spec.ts` 及 `pnpm run product:version:check`。审核钩子生成文件后仅提交本任务修改。

在拥有清理责任的临时清单 fixture 内使用以下断言；`root` 包含首步描述的清单：

```typescript
expect(() => checkProductVersions(root)).toThrow('packages/example/private/package.json')
expect(normalizeProductVersions(root, '0.1.1')).toContain('packages/example/private/package.json')
expect(checkProductVersions(root, 'v0.1.1')).toBe('0.1.1')
expect(() => checkProductVersions(root, 'v0.1.2')).toThrow()
expect(JSON.parse(readFileSync(join(root, 'vendor/example/package.json'), 'utf8')).version).toBe('2.10.6')
```

## 任务 2：不带历史的上游导入

**文件：** 创建 `scripts/upstream-sync.ts`、`scripts/upstream-sync.spec.ts`、`.upstream/dsh.json`；修改 `package.json`；为机器拥有的版本记录局部调整 `scripts/verify-repository-references.ts` 及其测试。

**接口：** 导出 `prepareUpstreamImport(productRoot: string, upstreamRoot: string, target: string, branch: string): Promise<{ changed: boolean; base: string; target: string; branch: string }>`；只准备修改，不提交、推送、开 PR 或合并。CLI：`pnpm run upstream:sync --upstream-dir <directory> --target <revision> --branch sync/dsh-<date>`。读取 `.upstream/dsh.json` 中的 `repository`、`revision`；版本是完整提交 ID，必须在独立上游目录验证。

- [ ] Vitest fixture 使用明确作者身份创建隔离的临时 Git 仓库。基础版本有共享文件；上游新增一行，产品修改另一文件。断言导入更新上游内容、保留产品修改，且上游提交不成为产品分支祖先。立即登记临时目录递归清理，等待每条子进程命令结束。
- [ ] 运行 `pnpm exec vitest run scripts/upstream-sync.spec.ts`，确认缺失实现导致失败。
- [ ] 只在上游目录用 `git rev-parse --verify <revision>^{commit}` 解析基础和目标。用 `git merge-base --is-ancestor` 验证祖先关系。要求产品索引及工作区干净、当前分支为 `main`、无进行中的 merge/rebase；拒绝已存在的目标分支。拉取上游是操作指南明确的前置步骤，不在产品目录隐式 fetch。
- [ ] 独立目录生成 `git diff --binary --full-index <base> <target>`。只用 `git cat-file blob <id>`、`git hash-object -w --stdin` 将需要的基础 blob 放入产品对象库，不 fetch 或复制提交对象。通过 `git apply --3way --index` 应用补丁，命令参数不用 shell 拼接且 I/O 支持二进制。验证本地基础内容不同、新增/删除文件、二进制修改、符号链接及执行权限变化。
- [ ] 冲突时停止，保留分支和未解决索引，报告路径，同步记录不变。应用失败后不归一化版本或写完成记录。记录人工完成冲突的流程，仅在全部冲突解决并审核后更新版本记录。
- [ ] 成功后调用 `normalizeProductVersions(productRoot, originalProductVersion)`，暂存归一化清单，在同一待提交修改中更新 `.upstream/dsh.json`。不跳过包清单，不自动覆盖品牌或指令；维护者提交前审核。
- [ ] 同一目标重复同步应干净无操作，不创建分支；测试上游历史分叉、脏工作区、非法版本、已有分支、本地定制文件被删除及应用冲突。断言所有拒绝保留基础记录。测试上游版本升级、新私有包及依赖新增。
- [ ] 初始版本通过 `git merge-base v0.1.1 upstream/master` 确定，并验证它是获批快照祖先；不得仅因为某版本最新就选用。记录验证值，不在本计划嵌入历史提交字面量。
- [ ] 为 `.upstream/dsh.json` 中经验证的版本字段添加精确路径例外，保留其他检查。测试非法记录、任意额外 SHA 字段，以及其他维护文件中可解析的提交引用仍被拒绝。
- [ ] 运行 `pnpm exec vitest run scripts/upstream-sync.spec.ts scripts/product-version.spec.ts scripts/verify-repository-references.spec.ts`。fixture 祖先断言通过后才提交同步工具及初始记录。

## 任务 3：工作流策略和维护指令

**文件：** 修改 `.github/workflows/ci.yml`、`.github/workflows/ci-master.yml`、`.github/workflows/sandbox.yml`、`.github/workflows/node-addon-system.yml`、`scripts/ci-workflow.spec.ts`、`scripts/tests/ci-master-platforms.spec.ts`、`AGENTS.md` 及受影响的 Desktop 版本文档；创建 `scripts/tests/tflowbuddy-workflows.spec.ts` 及文件职责中列出的两个 cookbook 中英文配对。

**接口：** 新仓库配置审核后仅启用 `CI`、`Sandbox`、`Node Addon System` 及桌面发布工作流。其他工作流通过 GitHub API 停用，迁移指南列出启用条件。旧 `ci-master.yml` 备用工作流在基础设施就绪前保持停用。

- [ ] 编写失败的 YAML 策略测试：受支持的 push 过滤使用 `main`，活动 PR 任务使用可用 GitHub 托管标签，`release.yml` 在打包前检查产品版本。安装包行为断言留在已有桌面发布测试中。
- [ ] 运行 `pnpm exec vitest run scripts/tests/tflowbuddy-workflows.spec.ts`，确认旧标签和分支过滤失败。
- [ ] 将活动 `ci.yml` 任务继承的企业或自托管 runner 选择替换为对应平台的托管 runner：`ubuntu-24.04`、`windows-2025`、`macos-15`。保留任务步骤、超时和测试；若内存不足，使用已有配置降低并发。Sandbox 和 native-addon 工作流受支持的 master push 过滤改为 `main`，不批量改写历史文档。
- [ ] 仅在获批 runner 和分支策略改变行为之处更新已有工作流测试预期，保留测试任务、隔离和失败报告断言。一起运行 `pnpm exec vitest run scripts/ci-workflow.spec.ts scripts/tests/ci-master-platforms.spec.ts scripts/tests/tflowbuddy-workflows.spec.ts`。
- [ ] 迁移时停用 E2E、pi-ai E2E、部署、预览、weighted-approval、议题自动化及备用工作流。列出各自所需凭据、应用、runner 或策略审核。不得弱化密钥预检或让活动必需检查自跳过来声称成功。
- [ ] 根指令明确产品版本归属并要求不带历史同步。修改受影响 README/JSDoc 中强制 Desktop 使用上游发布版本的陈述。历史版本引用、包名及冻结 Agent Note 不变。
- [ ] 同步指南明确步骤：干净 `main`，独立上游目录 fetch，运行 `upstream:sync`，审核产品文件，重新生成锁文件，运行聚焦测试，同时提交代码和版本记录，推送同步分支，开指向 `main` 的 PR，审核及检查后合并。明确直接 merge 上游或使用 `--allow-unrelated-histories` 违反本流程。
- [ ] 冲突恢复：检查 `git diff --name-only --diff-filter=U`，人工解决并暂存文件，保留产品版本，将记录更新为已验证目标，检查后提交。不自动破坏性清理。放弃分支前，维护者明确保留或丢弃冲突工作，然后才切换回干净 `main`。
- [ ] 用 `pnpm run verify-translation-pairing --write` 后接各源路径记录配对。运行聚焦工作流测试、`pnpm run test:docs`、`pnpm run doc-sync`、`pnpm run lint`、`git diff --check`，区分新增和既有失败，仅提交获批修改。

## 任务 4：备份和导出验证

**文件：** 仓库外备份目录为 `/Users/turingcat/Project/TFlowBuddy-migration-backup-20261008`，新工作目录为 `/Users/turingcat/Project/TFlowBuddy-independent`。任一路径已有目录时不得覆盖。

**接口：** 迁移清单记录原仓库 ID、引用、产品快照、获批迁移提交、导出树条目、原工作状态和完成步骤。清单和备份不上传，可能包含敏感设置，仅允许所有者访问。

- [ ] 任一目标目录已存在、GitHub 账户无管理权限或 `tflowbuddy-legacy` 已存在时停止。后续改名前重新查询原仓库身份，不使用会话缓存值。
- [ ] 创建权限受限的备份目录。运行 `git bundle create <backup>/legacy.bundle --all`、`git bundle verify <backup>/legacy.bundle`。确认部分克隆配置下提交、树、blob 对象完整；缺失时补齐源对象或保留经验证镜像后才继续。
- [ ] 保存 `git status --porcelain=v1 -z`、`git diff --binary`、`git diff --cached --binary` 及现有未跟踪路径的本地副本，不上传。用 `gh api` 保存仓库设置、Actions 权限、变量、密钥名称、分支规则、工作流状态、发布和附件清单；不记录请求头或密钥值。不支持的 API 明确记录，不伪造空结果。
- [ ] 用 `git archive --format=tar <approved-head>` 导出到新的空目录。确认相对 `v0.1.1` 的每处差异都属于任务 1-3 或迁移文档获批变更，不整体复制原工作区。
- [ ] 检查导出内容中的跟踪凭据和超大文件，使用已安装密钥扫描器并脱敏输出，审核配置名称。检查 Git LFS 指针及属性，补齐验证 LFS 内容或停止等待处理决定。上传前检查达到 GitHub 100 MiB 限制的文件。
- [ ] 将导出的文件字节、符号链接目标和执行权限与 `git ls-tree -rz <approved-head>` 对比。在临时导出中测试文件被改、二进制缺失、链接变化及执行位变化，四者均须拒绝。
- [ ] 用 `git init -b main` 初始化，从原工作目录读取维护者身份，暂存导出并创建单个初始提交。`git rev-list --count main` 应为 `1`，`git rev-list --parents -n 1 main` 无父提交，`git show-ref --tags` 无标签。确认未导入原始或上游提交对象。
- [ ] 新目录运行 `pnpm install --frozen-lockfile`，聚焦版本/同步/工作流/桌面测试，`pnpm run product:version:check`、`pnpm run build:official`、`pnpm run release:pack --family dsh --out <backup>/packed-dsh`，不执行完整安装包构建。新增失败在仓库操作前调查，不变的既有失败单独报告。

## 任务 5：改名、上传及 GitHub 验证

**文件：** 仅更新本地远程配置和外部迁移清单，保留原工作目录及其全部本地修改。

**接口：** 验证过的导出成为新仓库唯一 `main` 历史。原仓库 ID 仍属于 `tflowbuddy-legacy`，新仓库获得不同 ID。

- [ ] 再次验证 GitHub 名称和 ID。通过 `gh api --method PATCH repos/turingcat/tflowbuddy -f name=tflowbuddy-legacy` 改名，验证返回 ID 与备份一致。不自动归档旧仓库，不无故中断运行任务。
- [ ] 用 `gh repo create turingcat/tflowbuddy --public --description 'TFlowBuddy desktop AI assistant'` 创建空仓库。不 import、fork、初始化 README 或使用立即推送命令。
- [ ] 首次推送前用 `gh api --method PUT repos/turingcat/tflowbuddy/actions/permissions -F enabled=false` 禁用 Actions。API 失败即停止，不上传。确认新 ID 不同且 `fork` 为 false。
- [ ] 为新目录添加 `origin`，仅用 `git push -u origin main` 推送 `main`，不使用 `--mirror`、`--all`、`--tags`。用 `gh repo edit turingcat/tflowbuddy --default-branch main` 设置默认分支。
- [ ] 清点新注册的工作流 ID，先全部停用，再仅启用任务 3 允许列表。以只读默认 token 权限及审核后的 action 策略恢复仓库级 Actions。启用定时任务前确认其他工作流仍停用，不复制旧密钥值或不支持的自定义 runner 变量。
- [ ] 原目录 `origin` 明确指向 `https://github.com/turingcat/tflowbuddy-legacy.git`，新目录 `origin` 保持 `https://github.com/turingcat/tflowbuddy.git`；用于同步的 upstream 仅保留在独立源目录。不移动或覆盖任一本地目录。
- [ ] 验证远程 main 等于新目录 main、ID 和默认分支正确、未推送旧标签或分支、初始提交无父提交。将原工作区状态和本地修改与备份对比。查询贡献者，但将展示刷新延迟与祖先验证分开报告。
- [ ] 查询 Actions 并报告实际待完成/失败/成功。不推送 `v0.1.1`，不声称已有安装包。报告新旧 URL、新工作目录、备份路径、停用工作流、不可用密钥、已知 CI 失败及下一次同步命令。
- [ ] 失败时保存最后成功步骤并保留两个仓库。改名成功但创建失败时，只有确认原名称空闲才考虑改回。不自动删除新仓库、强推或覆盖本地文件恢复。

## 执行交接

获批设计确定行为，本计划确定执行顺序。实施前需审核本计划。推荐当前会话自行执行，因为改名、源快照、备份清单及远程验证共享顺序性的外部状态。明确选择后也可逐任务委派执行。
