#!/bin/bash
set -e

echo "=== 运行类型检查 ==="

# 运行类型检查
pnpm --filter @linkscope/shared build
pnpm --filter @linkscope/api typecheck
pnpm --filter @linkscope/web typecheck

echo "=== 类型检查完成 ==="
