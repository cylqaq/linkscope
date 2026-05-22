# 当前迭代窗口

> 单窗口约定（D-008 / D-012）：合并后只保留「上轮摘要」一段；下一轮开始前清空摘要正文，把要点同步追加到 `docs/DECISIONS.md`。
>
> 模板见文末「下轮占位」。

## 上轮摘要（2026-05-15 · Round 10 · 默认同源 /api 与开发 CORS 闭环）

- **问题**：浏览器用 `http://172.*` 等打开 Next 时，默认直连 `localhost:3001` 触发 **CORS**；API 未启动时 `Failed to fetch` 提示笼统。
- **措施**：未配 `NEXT_PUBLIC_API_URL` 时 `fetch` 走 **`当前站点 + /api`**，由 `next.config.js` rewrite 到 Nest（`API_URL`，默认 `127.0.0.1:3001`）；截图 `<img>` 用 `getWebVisibleApiRoot()` 同源；`humanizeNetworkError` 明确「先起 API」；Nest **非 production** 对 RFC1918 Origin 放行 + `CORS_EXTRA_ORIGINS`；`.env.example` 与 `ARCHITECTURE` 说明。
- **决策**：`DECISIONS.md` **D-020**。

---

## 下轮占位（开始下一轮迭代前清空本节，写入新计划；合并后再次精简为「上轮摘要」并把要点追加进 DECISIONS.md）

```
### 计划题目（YYYY-MM-DD · Round N · 简短主题）

- 问题：
- 目标：
- 拟措施：
- 风险/不做的事：
```

**建议下一轮（未排期）**：截图 **OCR 或 VLM**、D-019 回归样本与单测、`PLATFORM_NETWORK_DEAD_HINT_RULES` 补全、可选鉴权与多租户绑定 `screen_hints`。
