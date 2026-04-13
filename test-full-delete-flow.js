#!/usr/bin/env node

/**
 * v1.2.0 完整删除流程模拟测试
 * 模拟：选择checkbox → 点击批量删除 → 观察确认弹窗处理
 * 
 * 运行: node test-full-delete-flow.js
 */

const JSDOM = require('jsdom').JSDOM;
const fs = require('fs');
const path = require('path');

console.log('\n🎬 [完整流程模拟] v1.2.0批量删除 + 确认弹窗处理\n');

// 创建一个模拟NotebookLM页面
const mockHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>NotebookLM</title>
  <style>
    .google-symbols { font-family: 'Google Sans Symbols'; }
  </style>
</head>
<body style="font-family: system-ui;">
  <!-- Sidebar with sources -->
  <section class="source-panel">
    <div class="single-source-container">
      <button class="source-item-more-button">⋮ More</button>
      <div class="source-content">Source 1</div>
    </div>
    <div class="single-source-container">
      <button class="source-item-more-button">⋮ More</button>
      <div class="source-content">Source 2</div>
    </div>
  </section>
  
  <!-- Toolbar injected by extension -->
  <div id="nlm-bulk-toolbar" style="position: fixed; top: 10px; right: 10px;">
    <button id="nlm-bulk-toggle-btn">Bulk Select</button>
    <button id="nlm-bulk-delete-btn" disabled>Delete Selected</button>
    <span id="nlm-selected-count"></span>
  </div>
  
  <!-- CDK Overlay (where dialogs appear) -->
  <div class="cdk-overlay-container" style="display: none;">
    <div class="cdk-overlay-pane" style="position: fixed; z-index: 1000; top: 50%; left: 50%; transform: translate(-50%, -50%);">
      <div style="background: white; border: 1px solid #ccc; padding: 20px; border-radius: 8px;">
        <div style="margin-bottom: 16px;">确认删除选中的来源吗？</div>
        <div style="text-align: right; gap: 8px;">
          <button class="cancel-btn" style="margin-right: 8px;">取消</button>
          <button class="confirm-btn" style="background: red; color: white; padding: 8px 16px;">删除</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Mock NotebookLM API behavior
    window.mockAPI = {
      targetContainers: [],
      confirmedCount: 0,
      
      setup: function() {
        const btn = document.querySelector('.source-item-more-button');
        if (btn) {
          btn.addEventListener('click', () => {
            console.log('[Mock API] More button clicked');
          });
        }
      }
    };
  </script>
</body>
</html>
`;

try {
  const dom = new JSDOM(mockHtml, {
    url: 'https://notebooklm.google.com/notebook/abc',
    resources: 'usable',
  });
  
  const { document, window } = dom.window;
  
  console.log('✓ Mock NotebookLM page loaded');
  
  // ===== 测试场景1: 基础DOM结构检查 =====
  console.log('\n📌 [场景1] DOM结构验证');
  console.log('─'.repeat(50));
  
  const sidebar = document.querySelector('.source-panel');
  const sources = sidebar.querySelectorAll('.single-source-container');
  console.log(`✓ Sidebar found: ${sidebar ? '是' : '否'}`);
  console.log(`✓ Source items: ${sources.length}个`);
  
  // ===== 测试场景2: 模拟checkbox注入 =====
  console.log('\n📌 [场景2] checkbox注入模拟');
  console.log('─'.repeat(50));
  
  sources.forEach((item, idx) => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'nlm-source-checkbox';
    checkbox.id = `checkbox-${idx}`;
    item.insertBefore(checkbox, item.firstChild);
  });
  
  const checkboxes = document.querySelectorAll('.nlm-source-checkbox');
  console.log(`✓ Injected ${checkboxes.length}个checkboxes`);
  
  // ===== 测试场景3: 模拟批量选择 =====
  console.log('\n📌 [场景3] 批量选择模拟');
  console.log('─'.repeat(50));
  
  checkboxes.forEach(cb => {
    cb.checked = true;
  });
  
  const checkedCount = document.querySelectorAll('.nlm-source-checkbox:checked').length;
  console.log(`✓ Selected ${checkedCount}个items`);
  
  // ===== 测试场景4: 模拟删除菜单点击 =====
  console.log('\n📌 [场景4] 删除菜单项点击模拟');
  console.log('─'.repeat(50));
  
  // 模拟点击menu button后弹出菜单
  const moreButtons = document.querySelectorAll('.source-item-more-button');
  console.log(`✓ 找到${moreButtons.length}个menu buttons`);
  
  // 模拟第一个menu button的场景
  const firstMoreBtn = moreButtons[0];
  console.log(`✓ 模拟点击第一个menu button`);
  
  // 注入menu项
  const menuContainer = document.createElement('div');
  menuContainer.className = 'more-menu-container';
  menuContainer.style.position = 'fixed';
  menuContainer.style.zIndex = '100';
  menuContainer.innerHTML = `
    <button class="more-menu-delete-source-button" style="display: block; padding: 8px 16px; width: 100%; text-align: left;">
      删除来源
    </button>
  `;
  document.body.appendChild(menuContainer);
  console.log(`✓ 菜单已弹出`);
  
  // ===== 测试场景5: 模拟删除菜单项点击 - 触发确认弹窗 =====
  console.log('\n📌 [场景5] 删除菜单项点击 → 确认弹窗出现');
  console.log('─'.repeat(50));
  
  const deleteMenuItem = document.querySelector('.more-menu-delete-source-button');
  console.log(`✓ Delete menu item found: ${deleteMenuItem ? '是' : '否'}`);
  
  // 模拟点击delete item后弹窗出现
  const overlay = document.querySelector('.cdk-overlay-container');
  overlay.style.display = 'block';
  console.log(`✓ 确认弹窗已显示`);
  
  // ===== 测试场景6: 确认按钮查找和点击 =====
  console.log('\n📌 [场景6] 确认按钮查找 (模拟confirmDeleteDialog逻辑)');
  console.log('─'.repeat(50));
  
  // 现在测试confirmDeleteDialog的选择器是否能找到按钮
  const overlayContainers = document.querySelectorAll(
    '.cdk-overlay-container, .cdk-global-overlay-wrapper, dialog, .mat-mdc-dialog-container, [role="dialog"], mat-dialog-container'
  );
  
  console.log(`✓ 找到${overlayContainers.length}个overlay容器`);
  
  let foundButton = false;
  let foundButtonInfo = null;
  
  overlayContainers.forEach((container, containerIdx) => {
    const buttons = container.querySelectorAll('button');
    console.log(`  [容器${containerIdx}] 包含${buttons.length}个按钮`);
    
    buttons.forEach(btn => {
      const rawText = btn.textContent;
      const cleanText = rawText.replace(/\s+/g, '').toLowerCase();
      
      console.log(`    • "${rawText}" → "${cleanText}"`);
      console.log(`      aria-label: ${btn.getAttribute('aria-label')}`);
      console.log(`      disabled: ${btn.disabled}`);
      
      // 检查是否匹配删除token
      const CONFIRM_DELETE_TOKENS = new Set(['删除', 'delete']);
      if (CONFIRM_DELETE_TOKENS.has(cleanText)) {
        console.log(`      ✓ [匹配] 这是确认按钮！`);
        foundButton = true;
        foundButtonInfo = { rawText, cleanText, btn };
      }
    });
  });
  
  if (!foundButton) {
    console.log('\n❌ [问题] 未找到匹配删除token的按钮！');
    console.log('   这可能是导致原生弹窗仍然显示的原因。');
  }
  
  // ===== 测试场景7: 实际点击测试 =====
  console.log('\n📌 [场景7] 确认按钮点击测试');
  console.log('─'.repeat(50));
  
  if (foundButton && foundButtonInfo) {
    const { btn } = foundButtonInfo;
    
    // 记录点击前的状态
    console.log(`✓ 点击前状态: ${overlay.style.display}`);
    
    // 执行click
    let clickExecuted = false;
    try {
      btn.click();
      clickExecuted = true;
      console.log(`✓ btn.click() 执行成功`);
    } catch (e) {
      console.log(`✗ btn.click() 失败: ${e.message}`);
    }
    
    // 模拟simulateClick
    const simulateClick = (el) => {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    };
    
    try {
      simulateClick(btn);
      console.log(`✓ simulateClick() 执行成功`);
    } catch (e) {
      console.log(`✗ simulateClick() 失败: ${e.message}`);
    }
    
    // 检查弹窗是否消失(模拟)
    setTimeout(() => {
      overlay.style.display = 'none';
      console.log(`✓ 弹窗已隐藏 (模拟)`);
    }, 100);
  }
  
  // ===== 测试场景8: 问题诊断 =====
  console.log('\n📌 [场景8] 问题诊断总结');
  console.log('─'.repeat(50));
  
  const allButtons = Array.from(document.querySelectorAll('button'));
  console.log(`\n当前DOM中的所有按钮:`);
  allButtons.forEach((btn, idx) => {
    console.log(`  [${idx}] ${btn.className} | "${btn.textContent}" | disabled=${btn.disabled}`);
  });
  
  console.log(`\n🔍 问题检查清单:`);
  console.log(`  ☐ 确认弹窗是否出现在正确的容器中`);
  console.log(`  ☐ 确认按钮的文本是否与CONFIRM_DELETE_TOKENS匹配`);
  console.log(`  ☐ 确认按钮是否被disabled`);
  console.log(`  ☐ 确认按钮的click事件是否被正确捕获`);
  console.log(`  ☐ 原生弹窗vs扩展弹窗的区别`);
  
} catch (err) {
  console.error('❌ 测试失败:', err.message);
  console.error(err.stack);
}

console.log('\n' + '='.repeat(50));
console.log('🎯 下一步: 在实际NotebookLM环境中验证');
console.log('='.repeat(50));

console.log(`
1. 打开 https://notebooklm.google.com
2. 启用扩展 + 启用debug: window.nlmSetDebug(true)
3. 进行批量选择
4. 点击批量删除
5. 查看控制台输出，确认:
   - confirmDeleteDialog 是否找到按钮？
   - 按钮文本是什么？
   - 是否匹配CONFIRM_DELETE_TOKENS？
   
6. 复制 window.nlmGetFailures() 的输出到这里分析
`);

process.exit(0);
