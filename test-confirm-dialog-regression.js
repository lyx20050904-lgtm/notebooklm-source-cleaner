#!/usr/bin/env node

/**
 * v1.2.0 严重问题诊断脚本
 * 测试：批量删除时确认弹窗处理
 * 
 * 运行: node test-confirm-dialog-regression.js
 */

const JSDOM = require('jsdom').JSDOM;
const fs = require('fs');
const path = require('path');

// 读取content.js
const contentJsPath = path.join(__dirname, 'content.js');
const contentJs = fs.readFileSync(contentJsPath, 'utf-8');

console.log('\n🔍 [诊断开始] 检查确认弹窗处理逻辑...\n');

// =========== 测试1: 确认弹窗选择器覆盖 ===========
console.log('📋 [测试1] 确认弹窗选择器分析');
console.log('─'.repeat(50));

const overlaySelectors = [
  '.cdk-overlay-container',
  '.cdk-global-overlay-wrapper',
  'dialog',
  '.mat-mdc-dialog-container'
];

console.log('✓ 当前支持的overlay选择器:');
overlaySelectors.forEach(sel => console.log(`  - ${sel}`));

const notebookLMCommonSelectors = [
  '[role="dialog"]',
  '.ng-modal',
  '.material-dialog',
  'mat-dialog-container',
  '[data-testid="confirm-dialog"]',
  '.confirmation-dialog',
];

console.log('\n? NotebookLM可能使用但未覆盖的选择器:');
notebookLMCommonSelectors.forEach(sel => console.log(`  - ${sel}`));

console.log('\n⚠️  风险: 如果NotebookLM使用了未覆盖的容器，confirmDeleteDialog会超时');

// =========== 测试2: 按钮文本识别 ===========
console.log('\n\n📋 [测试2] 确认按钮文本识别');
console.log('─'.repeat(50));

// 模拟LOCALES和token生成
const mockLocales = {
  en: { confirmDeleteTokens: ['delete'] },
  'zh-CN': { confirmDeleteTokens: ['删除', 'delete'] },
  'zh-TW': { confirmDeleteTokens: ['刪除', '删除', 'delete'] },
  ja: { confirmDeleteTokens: ['削除', 'delete'] },
  es: { confirmDeleteTokens: ['eliminar', 'delete'] },
};

const mockGetDeleteTokens = () => {
  const dict = mockLocales['zh-CN'] || mockLocales.en;
  const tokenList = Array.isArray(dict.confirmDeleteTokens) ? dict.confirmDeleteTokens : [];
  return new Set(
    [...tokenList, ...mockLocales.en.confirmDeleteTokens]
      .map((token) => token.replace(/\s+/g, '').toLowerCase())
  );
};

const tokens = mockGetDeleteTokens();
console.log('✓ CONFIRM_DELETE_TOKENS:', Array.from(tokens));

// 测试NotebookLM可能的按钮文本变体
const potentialButtonTexts = [
  '删除',
  '确认删除',
  '永久删除',
  '确定',
  '确认',
  'Delete',
  '刪除',
  '删  除',  // 有空格
  '  删除  ', // 前后有空格
  '是否删除',
];

console.log('\n测试NotebookLM可能使用的按钮文本:');
potentialButtonTexts.forEach(text => {
  const cleanText = text.replace(/\s+/g, '').toLowerCase();
  const matched = tokens.has(cleanText);
  const status = matched ? '✓ 匹配' : '✗ 不匹配';
  console.log(`  ${status} "${text}" → "${cleanText}"`);
});

// =========== 测试3: 事件链路拦截影响 ===========
console.log('\n\n📋 [测试3] 事件链路拦截对弹窗确认按钮的影响');
console.log('─'.repeat(50));

console.log('当前事件拦截配置:');
console.log('  • 类型: [pointerdown, mousedown, mouseup, click]');
console.log('  • 捕获阶段: true (capture phase)');
console.log('  • 作用范围: .nlm-source-checkbox 元素');
console.log('  • 阻止方法: stopPropagation + stopImmediatePropagation');

console.log('\n📌 关键风险分析:');
console.log('  1. interceptCheckboxEvent 检查 target.closest(".nlm-source-checkbox")');
console.log('  2. 如果确认按钮 DOM 树中包含 .nlm-source-checkbox，会被拦截');
console.log('  3. 更可能: 确认按钮不是checkbox，事件不应被拦截');
console.log('  4. 但是: 如果确认按钮click通过 dispatch 而非用户交互触发，');
console.log('     可能受到capture-phase listener的影响');

const checkInterceptionCode = `
function interceptCheckboxEvent(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const checkbox = target.closest('.nlm-source-checkbox');
  if (!checkbox) return; // ← 只有是checkbox才继续
  
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (event.type === 'pointerdown' || event.type === 'mousedown') {
    event.preventDefault();
  }
}
`;

console.log('\n当前拦截逻辑:');
console.log(checkInterceptionCode);

console.log('\n⚠️  问题: simulateClick() 在确认弹窗按钮上dispatch事件');
console.log('   如果此时恰好有其他listener在capture阶段也在阻止，可能冲突');

// =========== 测试4: 轮询超时分析 ===========
console.log('\n\n📋 [测试4] 轮询超时风险分析');
console.log('─'.repeat(50));

console.log('当前配置:');
console.log('  • maxRetries: 30');
console.log('  • pollInterval: 100ms');
console.log('  • 总超时时间: 3000ms (3秒)');

console.log('\n🎯 NotebookLM弹窗加载时间估计:');
console.log('  • 快速情况: 100-200ms (接近实时)');
console.log('  • 正常情况: 300-800ms (API调用+渲染)');
console.log('  • 慢速情况: 1000-2000ms (网络延迟)');
console.log('  • 极端情况: >3000ms (可能失败)');

console.log('\n⚠️  风险: 如果弹窗加载 > 3秒，则confirmDeleteDialog超时');
console.log('   后果: recordFailure(DIALOG_TIMEOUT), 删除中断');

// =========== 测试5: 实际模拟 ===========
console.log('\n\n📋 [测试5] DOM模拟场景测试');
console.log('─'.repeat(50));

const testHtml = `
<!DOCTYPE html>
<html>
<head><title>NotebookLM Mock</title></head>
<body>
  <section class="source-panel">
    <div class="single-source-container">
      <input type="checkbox" class="nlm-source-checkbox" />
      <button class="source-item-more-button">More</button>
    </div>
  </section>
  
  <div class="cdk-overlay-container">
    <div style="position: absolute;">
      <button>删除</button>
    </div>
  </div>
</body>
</html>
`;

try {
  const dom = new JSDOM(testHtml);
  const { document } = dom.window;

  // 查找弹窗容器
  const overlayContainers = document.querySelectorAll(
    '.cdk-overlay-container, .cdk-global-overlay-wrapper, dialog, .mat-mdc-dialog-container'
  );
  console.log(`✓ 发现 ${overlayContainers.length} 个overlay容器`);

  let foundButton = false;
  overlayContainers.forEach((container, idx) => {
    const buttons = container.querySelectorAll('button');
    console.log(`  [Container ${idx}] 包含 ${buttons.length} 个按钮`);
    buttons.forEach(btn => {
      const text = btn.textContent.replace(/\s+/g, '').toLowerCase();
      console.log(`    • "${text}"`);
      if (tokens.has(text)) {
        console.log(`      ✓ 匹配确认token`);
        foundButton = true;
      }
    });
  });

  if (foundButton) {
    console.log('\n✓ 在模拟DOM中找到确认按钮');
  } else {
    console.log('\n✗ 在模拟DOM中未找到确认按钮');
  }
} catch (err) {
  console.error('❌ 模拟失败:', err.message);
}

// =========== 总结 ===========
console.log('\n\n' + '='.repeat(50));
console.log('📊 诊断总结');
console.log('='.repeat(50));

console.log(`
🔴 [高风险] 确认弹窗处理可能有以下问题:

1. 【选择器不完整】
   原因: NotebookLM可能使用其他dialogue容器结构
   症状: confirmDeleteDialog轮询<3秒后超时，弹窗仍显示
   
2. 【按钮文本识别失败】
   原因: CONFIRM_DELETE_TOKENS可能未覆盖所有文本变体
   症状: 找到弹窗但找不到确认按钮
   
3. 【事件链路冲突】
   原因: simulateClick()的dispatch事件可能被其他listener阻止
   症状: 按钮被找到但click未生效
   
4. 【加载延迟超时】
   原因: 弹窗加载耗时 > 3秒
   症状: 轮询完成但弹窗还在加载

🟡 [建议立即修复]:
- 添加详细的诊断日志到confirmDeleteDialog
- 扩展overlay容器选择器
- 扩展确认按钮文本匹配范围
- 增加轮询超时时间至5-10秒
`);

process.exit(0);
