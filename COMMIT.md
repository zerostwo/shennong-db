# Commit Message Standard (CCC)

本项目采用 **CCC（Conventional Commit 约定）**，用于保持提交信息一致、可追踪和可自动化解析。

## 格式

`<type>(<scope>): <简短说明>`

- `type`：提交类型，必须小写，常用如下
  - `feat`：新功能
  - `fix`：缺陷修复
  - `docs`：文档变更
  - `refactor`：重构（不改变外部行为）
  - `perf`：性能优化
  - `test`：测试相关
  - `chore`：杂项、依赖、脚本、构建配置
  - `build`：构建/发布流程
  - `ci`：CI/CD
  - `revert`：回滚提交
- `scope`：可选，标注影响模块，例如 `api`、`ingest`、`catalog`、`client`
- `简短说明`：使用祈使语气、中文或英文均可，长度建议不超过 72 个字符

## 示例

- `feat(api): add v2 semantic query route`
- `fix(ingest): reject non-existent source file before registration`
- `docs(changelog): add Keep a Changelog format`
- `chore(repo): add CCC commit guideline`

## 说明

- 可以添加正文说明（可选）与脚注。
- 破坏性变更使用 `BREAKING CHANGE:` 前缀写在正文末尾。

## 终止线（可选）

推荐将该文件设为提交模板（本地示例）：

```bash
git config commit.template COMMIT.md
```
