# 贡献指南

感谢你对 Extension ASR 的关注！

## 开发环境

1. Fork 并克隆仓库
2. 安装 Node.js 20+
3. 按 [README.md](README.md) 加载 `extension/` 到 Chrome
4. 后端开发时复制 `backend/.env.example` 为 `backend/.env`

## 分支与提交

- 从 `main` 拉取功能分支：`feat/xxx`、`fix/xxx`、`docs/xxx`
- 提交信息建议：[Conventional Commits](https://www.conventionalcommits.org/)
  - `feat:` 新功能
  - `fix:` 修复
  - `docs:` 文档
  - `refactor:` 重构

## 站点字幕适配器

新增站点适配请放在 `extension/adapters/`，实现 `SubtitleAdapter` 接口（见 `extension/adapters/base.js`），并在 `extension/adapters/registry.js` 注册。

适配器应：

- 仅读取页面已有字幕，不绕过付费或 DRM 限制
- 失败时静默降级到 ASR 路径，不阻塞主流程
- 附带 `match(url)` 与简短说明，便于维护

## Pull Request

1. 确保改动范围聚焦，附带必要说明
2. 更新相关文档（README / ARCHITECTURE）
3. 在 PR 中说明测试过的网站与 Chrome 版本

## 行为准则

请尊重版权与隐私：本工具面向个人学习笔记场景，请勿用于批量爬取或再分发受版权保护的内容。
