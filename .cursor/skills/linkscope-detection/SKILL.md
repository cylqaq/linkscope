# LinkScope 检测技能

## 概述
链接有效性检测和内容下架判断的领域知识。

## 核心概念
1. **三层检测**：L1 HTTP → L2 浏览器 → L3 AI
2. **状态模型**：accessible / dead_link / review_required
3. **平台适配**：20+ 国内平台的特定模式

## 检测流程
1. URL 规范化和去重
2. HTTP 探测（HEAD → GET 回退）
3. 浏览器探测（按需）
4. AI 复核（按需）
5. 结果融合

## 常见问题
- **反爬虫 404**：使用浏览器二次验证
- **SPA 页面**：增加等待时间，监听网络请求
- **登录墙**：标记为 review_required

## 代码位置
- HTTP 探测：`apps/api/src/probe/http-probe.service.ts`
- 浏览器探测：`apps/api/src/probe/browser-probe.service.ts`
- 分类服务：`apps/api/src/classify/classify.service.ts`

## 智能等待策略
### 问题
当前截图等待固定 3 秒，对 SPA/重JS页面加载不足。

### 解决方案
1. **SPA 框架检测**：识别 React/Vue/Angular 并应用特定等待策略
2. **网络空闲检测**：监听网络请求数量和状态
3. **DOM 稳定检测**：检测 DOM 变化频率
4. **可配置参数**：通过环境变量 `BROWSER_WAIT_*` 配置等待时间范围

### 等待时间范围
- 最小等待时间：3 秒
- 最大等待时间：15 秒
- 默认等待时间：5 秒

### 实现锚点
- `BrowserProbeService.probe()`
- `BROWSER_WAIT_*` 环境变量

## 参考文档
- `docs/ARCHITECTURE.md`：系统架构
- `docs/DECISIONS.md`：决策记录（D-021）
- `docs/AI_DEVELOPMENT.md`：AI 开发指南
