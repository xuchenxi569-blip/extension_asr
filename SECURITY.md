# 安全策略

## 报告漏洞

如发现安全问题，请通过 GitHub Security Advisories 或私信维护者报告，**勿在公开 Issue 中披露可利用细节**。

## 范围

- Chrome 扩展音频捕获与字幕处理逻辑
- 后端网关鉴权与 WebSocket 服务
- API Key 与用户音频数据的存储传输

## 已知设计约束

- 扩展不应在客户端代码中硬编码 ASR API 密钥
- DRM 内容不应尝试绕过捕获限制

## 密钥存放

- 真密钥只写在本机 `backend/.env`，该文件已被 `.gitignore` 排除
- 仓库里只保留 `backend/.env.example` 空模板，不要把真实 `ASR_API_KEY` 填进去
- 发现密钥曾进入 Git 历史时，应立刻作废旧密钥并换新，而不是只删文件
