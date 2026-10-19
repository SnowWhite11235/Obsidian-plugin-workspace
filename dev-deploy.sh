#!/bin/bash
# 热重载部署脚本 - 监听 src/ 变化，自动构建并复制到 vault
# 用法：./dev-deploy.sh

set -e

PROJECT_DIR="/Users/xbai/Documents/工作区/obsidian插件"
VAULT_DIR="$HOME/Documents/Obsidian-知识库"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/obsidian-life-panel"

echo "=== Life Panel 热重载部署 ==="
echo "项目: $PROJECT_DIR"
echo "Vault: $VAULT_DIR"
echo "插件目录: $PLUGIN_DIR"
echo ""

# 确保插件目录存在
mkdir -p "$PLUGIN_DIR"

# 初次构建
echo "[1/3] 构建中..."
cd "$PROJECT_DIR"
node esbuild.config.mjs production

# 复制文件
echo "[2/3] 部署到 vault..."
cp main.js "$PLUGIN_DIR/"
cp manifest.json "$PLUGIN_DIR/"
cp styles.css "$PLUGIN_DIR/"

echo "[3/3] 部署完成！"
echo ""
echo "请在 Obsidian 中："
echo "  1. 设置 → 第三方插件 → 关闭再开启 '生活管理面板'"
echo "  2. 或使用 Cmd+P → 'Reload app without saving'"
echo ""
echo "按 Ctrl+C 退出监听..."
echo "========================================="

# 监听 src/ 目录变化
fswatch -o --recursive --exclude 'node_modules' "$PROJECT_DIR/src" "$PROJECT_DIR/styles.css" "$PROJECT_DIR/manifest.json" | while read event; do
  echo ""
  echo "[$(date '+%H:%M:%S')] 检测到变化，重新构建..."
  if node esbuild.config.mjs production 2>&1; then
    cp main.js "$PLUGIN_DIR/"
    cp manifest.json "$PLUGIN_DIR/"
    cp styles.css "$PLUGIN_DIR/"
    echo "[$(date '+%H:%M:%S')] ✅ 部署完成，请在 Obsidian 中重新加载插件"
  else
    echo "[$(date '+%H:%M:%S')] ❌ 构建失败，请检查错误"
  fi
done
