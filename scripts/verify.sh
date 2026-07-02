#!/bin/bash
set -e

echo "=== LinkScope 验证脚本 ==="

# 1. 类型检查
echo "1. 运行类型检查..."
pnpm --filter @linkscope/shared build
pnpm --filter @linkscope/api typecheck
pnpm --filter @linkscope/web typecheck

# 2. Lint 检查
echo "2. 运行 Lint 检查..."
pnpm lint

# 3. 单元测试
echo "3. 运行单元测试..."
pnpm test

# 4. 检查死代码
echo "4. 检查死代码..."
# 可以使用 knip 或其他工具

echo "=== 验证完成 ==="
