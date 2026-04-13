# NotebookLM Source Cleaner

为 Google NotebookLM 来源列表提供批量选择与一键删除能力的 Chrome 扩展。

Global-ready source cleanup extension for NotebookLM.

## 这是什么
当你的来源很多时，NotebookLM 原生逐条删除会很慢。这个扩展提供：
- 批量选择来源
- 一键删除选中项
- 删除进度提示
- 路由切换后自动恢复工具栏

What it does:
- Bulk select sources
- Delete selected sources in one run
- Show cleaning progress
- Auto remount toolbar after route changes

## 适合谁
- 高频使用 NotebookLM 的内容/研究/产品用户
- 经常需要清理 10 条以上来源的用户

## 安装方法
1. 打开 `chrome://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本项目目录
5. 打开 `https://notebooklm.google.com`

## 如何使用
1. 在来源列表点击“批量选择”
2. 勾选要删除的来源
3. 点击“删除选中”
4. 等待进度提示结束

## 当前版本状态
- 稳定性验收：通过
- 线上账号签收：通过
- 当前发布版本：`v1.2.0`
- 已修复关键问题：
  - 浅色模式可读性问题
  - 批量勾选误跳转问题（mousedown/pointerdown 链路）

Global adaptation in this release:
- Locale-aware UI text with fallback chain
- First-wave locales: `en`, `zh-CN`, `zh-TW`, `ja`, `es`

## 已知边界
- NotebookLM 是动态 SPA，若官方更新 DOM 结构，选择器可能需要同步更新。
- 如遇工具栏不显示，刷新页面后重试。

Known limits:
- NotebookLM is a dynamic SPA. If host DOM changes, selectors may need updates.
- If the toolbar does not appear, refresh and retry.

## 用户版 README 更新策略
此文件是“用户版 README”，只在以下情况更新：
1. 功能新增（用户可感知）
2. 行为变更（使用方式变化）
3. 关键 Bug 修复（影响使用）
4. 兼容性变化（浏览器/平台）

日常技术细节、压测记录、内部排障流程不在本文件维护。

## 研发文档
完整技术说明、测试与复盘记录请见：
- `README.dev.md`
- `luwei 反馈/`
