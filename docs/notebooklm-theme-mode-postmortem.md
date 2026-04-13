# NotebookLM 主题模式失效复盘报告

## 背景

当前插件曾做过“深浅模式修复”，但用户反馈在 NotebookLM 内切换主题后，插件样式不会同步切换，仍然按系统主题显示。

## 结论先行

本次问题的根因不是样式变量本身，而是“主题信号源”选错了。

- 现有实现把主题判断绑定在系统级媒体查询 `@media (prefers-color-scheme: light)`。
- NotebookLM 已内置站内主题设置（与系统主题可解耦）。
- 当用户仅切换 NotebookLM 站内主题、系统主题不变时，插件样式不会更新。

因此，现有修复在“系统主题驱动”场景有效，但在“站内主题驱动”场景天然失效。

## 代码证据

### 1) 主题变量来源仅依赖系统媒体查询

在 [style.css](style.css) 中：

- 默认 `:root` 定义为深色变量。
- 仅通过 `@media (prefers-color-scheme: light)` 做浅色覆盖。

这意味着主题切换完全由 OS 层信号控制。

### 2) 运行时无站内主题监听逻辑

在 [content.js](content.js) 中：

- 只有工具栏注入、删除流程、故障诊断等逻辑。
- 未发现用于读取 NotebookLM 站内主题状态的 DOM 监听、属性同步或 class 同步逻辑。
- `window.nlmDebug()` 打印的 Theme tokens 仅是 CSS 变量读取结果，并非主题来源判定机制。

## 为什么之前修复没彻底

之前修复改善的是“颜色值设计”和“浅色变量覆盖”，本质仍属于“静态样式层修补”。

但当前问题属于“主题来源路由错误”：

- 应该优先响应 NotebookLM 的站内主题状态。
- 仅在站内主题不可判定时，才回退系统主题。

所以此前修复并非无效，而是只覆盖了部分场景（系统主题联动场景）。

## 影响范围

1. 工具栏按钮（批量选择、删除选中）的文本对比度与背景在某些场景下不匹配。
2. 复选框边框、hover、危险按钮颜色语义可能与主站视觉冲突。
3. 用户体感表现为“主页面是浅色，但插件像深色（或反之）”。

## 推荐修复方案（最小侵入）

### 方案目标

建立“双信号主题架构”：

1. **主信号**：NotebookLM 站内主题（优先）
2. **备信号**：系统主题 `prefers-color-scheme`（回退）

### 实施建议

1. 在 [content.js](content.js) 中新增主题同步器：
   - 读取 NotebookLM 根节点的主题标记（class/data-attribute/aria 之一）。
   - 将判定结果写入 `document.documentElement` 或 `body`，例如：`data-nlm-ext-theme="dark|light"`。
   - 使用 `MutationObserver` 监听根节点属性变化，实时更新。

2. 在 [style.css](style.css) 中调整变量优先级：
   - 新增
     - `:root[data-nlm-ext-theme="dark"] { ... }`
     - `:root[data-nlm-ext-theme="light"] { ... }`
   - 保留 `@media (prefers-color-scheme)` 作为兜底，仅在无站内主题标记时生效。

3. 优化可观测性：
   - 在 `window.nlmDebug()` 中增加：
     - 当前主题来源（site/system/fallback）
     - 站内主题原始标记值
     - 当前 `data-nlm-ext-theme`

## 验收标准

1. 系统深色 + NotebookLM 浅色：插件应显示浅色。
2. 系统浅色 + NotebookLM 深色：插件应显示深色。
3. NotebookLM 主题切换后（不刷新页面），插件在 300ms 内完成样式同步。
4. 回退路径可用：若 NotebookLM 无主题标记，插件跟随系统主题。

## 风险与注意事项

1. NotebookLM 主题标记可能随版本更新而变化，建议多候选选择器并做容错。
2. 应避免在每次 DOM 变更都重算主题，建议只监听根节点属性与 class 变化。
3. 主题同步器需在插件挂载与路由切换后都能复用。

## 建议优先级

- P0：主题来源改造（站内优先，系统回退）
- P1：debug 信息增强（主题来源可视化）
- P2：颜色 token 精调（提升在极端背景下可读性）

## 复盘摘要（给产品/运营）

这不是“颜色调错了”，而是“跟谁同步主题”这条策略错误：

- 旧策略：跟系统主题。
- 正确策略：优先跟 NotebookLM 站内主题，再回退系统主题。

一旦改成双信号架构，站内深浅模式切换就会稳定生效。