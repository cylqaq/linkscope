#!/bin/bash
set -e

echo "=== 读取项目文档 ==="

# 检查关键文档是否存在
if [ ! -f "AGENTS.md" ]; then
    echo "错误：AGENTS.md 不存在"
    exit 1
fi

if [ ! -f "docs/ARCHITECTURE.md" ]; then
    echo "错误：docs/ARCHITECTURE.md 不存在"
    exit 1
fi

if [ ! -f "docs/DECISIONS.md" ]; then
    echo "错误：docs/DECISIONS.md 不存在"
    exit 1
fi

if [ ! -f "docs/upgrade-plans/CURRENT.md" ]; then
    echo "错误：docs/upgrade-plans/CURRENT.md 不存在"
    exit 1
fi

echo "所有关键文档存在"
echo "=== 文档读取完成 ==="
