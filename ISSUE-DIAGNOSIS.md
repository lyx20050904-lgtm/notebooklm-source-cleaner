# v1.2.0 严重问题诊断报告

**问题描述**
- 批量删除后，NotebookLM原生的"删除二次确认弹窗"出现，而非被自动确认
- 期望：弹窗应该被脚本自动点击确认按钮
- 实际：用户看到了弹窗，需要手动确认

**根本原因排查路径**

## 1. 代码流程梳理

```
executeBulkDelete() 
  → for each checkbox
    → deleteSourceItem(item)
      → click menu button (more-menu)
      → wait for delete menu item
      → click delete menu item
      → confirmDeleteDialog() ← 问题可能在这里
```

## 2. confirmDeleteDialog() 的关键问题

位置：content.js 第188-230行

```javascript
async function confirmDeleteDialog() {
  const maxRetries = 30; // 3000ms轮询上限
  const pollInterval = 100;

  for (let i = 0; i < maxRetries; i++) {
    const overlayContainers = document.querySelectorAll(
      '.cdk-overlay-container, .cdk-global-overlay-wrapper, dialog, .mat-mdc-dialog-container'
    );

    for (const container of overlayContainers) {
      const buttons = container.querySelectorAll('button');
      for (const btn of buttons) {
        const cleanText = btn.textContent.replace(/\s+/g, '').toLowerCase();

        if (CONFIRM_DELETE_TOKENS.has(cleanText)) {
          // 执行点击
          btn.click();
          if (typeof simulateClick === 'function') {
            simulateClick(btn);
          }
          // 等待弹窗卸载...
          return true;
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // 超时 → recordFailure
  return false;
}
```

### 2.1 潜在问题1：选择器覆盖不完整
- 只查询了：`.cdk-overlay-container`, `.cdk-global-overlay-wrapper`, `dialog`, `.mat-mdc-dialog-container`
- NotebookLM可能使用其他容器结构（如自定义div或shadow DOM）

### 2.2 潜在问题2：按钮文本识别失败
- `CONFIRM_DELETE_TOKENS` 是基于LOCALES生成
- 当前用户的locale
可能与实际UI文本不匹配
- 例如：TOKENS含有'删除', 但实际按钮是'确定', '确认', '好'等

### 2.3 潜在问题3：click执行被事件链路拦截
- `btn.click()`可能被通过 document-level capture listeners阻止
- 虽然interceptCheckboxEvent中有`checkbox closest`检查，但如果确认按钮内部有checkbox元素，可能造成二级捕获

### 2.4 潜在问题4：弹窗加载延迟
- 最多轮询3秒，但如果弹窗加载延迟 > 3秒会失败
- NotebookLM的确认弹窗可能需要额外的API调用

## 3. 诊断步骤

需要进行以下测试来确认根本原因：

### Test 1: 确认弹窗是否出现在DOM中
```javascript
// 在浏览器控制台执行
const overlayContainers = document.querySelectorAll(
  '.cdk-overlay-container, .cdk-global-overlay-wrapper, dialog, .mat-mdc-dialog-container'
);
console.log('Overlay containers found:', overlayContainers.length);
overlayContainers.forEach((container, idx) => {
  console.log(`[${idx}]`, container);
  console.log('  Buttons:', container.querySelectorAll('button'));
  container.querySelectorAll('button').forEach(btn => {
    console.log('    -', btn.textContent, '|', btn.textContent.replace(/\s+/g, '').toLowerCase());
  });
});
```

### Test 2: 检查CONFIRM_DELETE_TOKENS是否覆盖
```javascript
window.nlmDebug(); // 查看当前locale
console.log('CONFIRM_DELETE_TOKENS:', CONFIRM_DELETE_TOKENS);
```

### Test 3: 手动触发删除并观察
```javascript
// 1. 全选所有source items
const checkboxes = document.querySelectorAll('.nlm-source-checkbox');
checkboxes.forEach(cb => cb.checked = true);

// 2. 监听所有确认弹窗按钮
const observer = new MutationObserver(() => {
  const btns = document.querySelectorAll('.cdk-overlay-container button, dialog button');
  btns.forEach(btn => {
    const text = btn.textContent.replace(/\s+/g, '').toLowerCase();
    console.log('[Dialog Button Found]', text, btn);
  });
});
observer.observe(document.body, { childList: true, subtree: true });

// 3. 启动批量删除
document.getElementById('nlm-bulk-delete-btn').click();

// 4. 观察confirmDeleteDialog的行为
window.nlmSetDebug(true);
```

### Test 4: 检查shadow DOM
NotebookLM可能在Shadow DOM中渲染确认弹窗：
```javascript
// 查询所有shadow root
document.querySelectorAll('*').forEach(el => {
  if (el.shadowRoot) {
    console.log('Shadow root found:', el);
    const dialogs = el.shadowRoot.querySelectorAll('.cdk-overlay-container, dialog, button');
    if (dialogs.length) console.log('  Dialogs in shadow:', dialogs);
  }
});
```

## 4. 预期的修复方案

基于诊断结果，可能需要：

1. **扩展选择器**: 添加更多overlay容器选择器
2. **改进按钮匹配**: 
   - 不仅匹配文本，还匹配aria-label, title属性
   - 添加按钮位置启发式（通常在dialog右下角）
3. **处理Shadow DOM**: 遍历shadow roots查找确认按钮
4. **增加轮询时间**: 从3秒延长到5-10秒
5. **增加诊断日志**: 记录弹窗搜索的每一步，便于后续调试
