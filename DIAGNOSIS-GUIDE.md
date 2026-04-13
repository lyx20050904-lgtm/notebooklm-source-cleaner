# v1.2.0 问题诊断指南

**问题现象**: 批量删除后，NotebookLM原生的"删除二次确认弹窗"出现，未被自动确认

## 快速诊断步骤

### Step 1: 启用Debug模式
```javascript
// 在浏览器控制台执行:
window.nlmSetDebug(true);
```

### Step 2: 进行批量删除操作
1. 打开 https://notebooklm.google.com
2. 点击"Bulk Select"（批量选择）
3. 勾选1-2个来源
4. 点击"Delete Selected"（删除选中）
5. **此时观察**: 是否出现确认弹窗？

### Step 3: 收集诊断数据

#### 如果确认弹窗出现，复制以下命令的输出:

```javascript
// 1. 检查弹窗容器
console.log('=== 弹窗检查 ===');
console.log('1. CDK容器:', document.querySelectorAll('.cdk-overlay-container').length);
console.log('2. Dialog容器:', document.querySelectorAll('[role="dialog"]').length);
console.log('3. 所有按钮:', Array.from(document.querySelectorAll('button')).map(b => ({
  text: b.textContent.trim(),
  class: b.className,
  id: b.id,
  ariaLabel: b.getAttribute('aria-label'),
  parent: b.parentElement?.className
})));

// 2. 检查确认tokens
console.log('=== Token检查 ===');
console.log('CONFIRM_DELETE_TOKENS:', CONFIRM_DELETE_TOKENS);

// 3. 检查扩展故障记录
console.log('=== 扩展故障记录 ===');
window.nlmGetFailures().forEach((f, i) => {
  console.log(`  [${i}] ${f.type}: ${f.msg}`);
  console.log('     ', f.extra);
});
```

#### 视觉检查: 弹窗的样式
```javascript
// 查看弹窗是否被正确识别
const overlays = document.querySelectorAll('.cdk-overlay-container, [role="dialog"]');
overlays.forEach((o, idx) => {
  console.log(`[弹窗${idx}]`, {
    visible: o.offsetHeight > 0,
    className: o.className,
    innerHTML_preview: o.innerHTML.substring(0, 200)
  });
});
```

### Step 4: 查看浏览器console中的关键信息

**寻找以下关键日志:**

```
[NLM Cleaner] 确认按钮查找超时... （表示未找到按钮）

或

[NLM Cleaner] 确认按钮详情: {...} （表示找到了按钮）
```

---

## 问题场景分析

### 场景A: 未找到确认按钮 ❌
**日志特征**: `"确认按钮查找超时"`

**可能原因**:
1. 弹窗使用了未覆盖的容器选择器
2. 确认按钮文本与token不匹配
3. 弹窗在shadow DOM中

**解决方法**:
```javascript
// 检查所有容器和按钮
const allButtons = document.querySelectorAll('button');
allButtons.forEach(b => {
  const text = b.textContent.replace(/\s+/g, '').toLowerCase();
  console.log(text, b.textContent, b);
});

// 检查shadow roots
document.querySelectorAll('*').forEach(el => {
  if (el.shadowRoot) {
    const btns = el.shadowRoot.querySelectorAll('button');
    if (btns.length) console.log('Shadow buttons:', btns);
  }
});
```

### 场景B: 找到按钮但未点击成功 ⚠️
**日志特征**: `"确认按钮详情"` 出现，但弹窗仍存在

**可能原因**:
1. `btn.click()` 被事件拦截阻止
2. NotebookLM的按钮使用自定义事件监听
3. 按钮disabled状态变化

**解决方法**:
```javascript
// 检查按钮状态
const btn = document.querySelector('[role="dialog"] button');
console.log({
  disabled: btn.disabled,
  readonly: btn.readonly,
  ariaDisabled: btn.getAttribute('aria-disabled'),
  listeners: btn._getEventListeners?.('click') // Chrome dev tools
});

// 尝试强制点击
btn.addEventListener('click', () => console.log('Click fired!'), false);
btn.click();
```

### 场景C: 原生弹窗样式不同 👀
**表现**: 弹窗样式和预期不同，可能是Material Design风格

**收集信息**:
```javascript
// 截图确认弹窗的HTML结构
const dialog = document.querySelector('[role="dialog"], .cdk-overlay-container');
console.log(dialog?.outerHTML.substring(0, 500));

// 检查是否是Material Dialog
const matDialog = document.querySelector('mat-dialog-container');
if (matDialog) console.log('Found Material Dialog');

// 检查是否有特殊属性
console.log(Array.from(dialog?.attributes || []).map(a => `${a.name}="${a.value}"`));
```

---

## 数据收集表单

请在遇到问题时填写以下信息:

```
【问题现象】
- [ ] 弹窗出现
- [ ] 弹窗文本: _______________
- [ ] 是否自动关闭: 是/否

【环境信息】
- NotebookLM URL: _______________
- Chrome版本: _______________
- 扩展版本: v1.2.0

【诊断信息】
- CONFIRM_DELETE_TOKENS: _______________
- 弹窗容器类名: _______________
- 确认按钮文本: _______________
- 是否找到按钮: 是/否

【Debug日志】
（复制 window.nlmGetFailures() 的输出）
_______________

【屏幕截图】
（粘贴弹窗的截图）
```

---

## 预期修复（已在content.js中实施）

✅ **v1.2.0-patch1 改进**:

1. **扩展选择器** - 添加了 `[role="dialog"]` 和 `mat-dialog-container`
2. **增加轮询时间** - 从3秒延长到5秒
3. **详细诊断日志** - 记录每一步搜索过程
4. **timeout时的完整信息** - 显示所有未匹配的按钮及其文本

---

## 联系与反馈

如果问题仍未解决:
1. 在console执行收集诊断数据中的代码
2. 将输出粘贴到GitHub issue或邮件
3. 包含弹窗的屏幕截图
