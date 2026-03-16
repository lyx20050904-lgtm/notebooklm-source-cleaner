/**
 * NotebookLM Source Cleaner — Content Script (v4 · Lean & Robust)
 * Manifest V3 | target: https://notebooklm.google.com/*
 *
 * Security: Trusted Types compliant — zero .innerHTML usage.
 * Design:   First-principles — exact selectors only, no heuristics.
 */

'use strict';

/* ── Selectors ─────────────────────────────────────────────────────────── */

const SELECTORS = {
  SIDEBAR:          'section.source-panel',
  SOURCE_ITEM:      '.single-source-container',
  MENU_BTN:         'button.source-item-more-button',
  DELETE_MENU_ITEM: 'button.more-menu-delete-source-button',
  ADD_SOURCE_AREA:  'button.add-source-button',
};

/* ── Utilities ─────────────────────────────────────────────────────────── */

function getSidebar() {
  return document.querySelector(SELECTORS.SIDEBAR);
}

function showToast(msg, duration = 2500) {
  const existing = document.querySelector('.nlm-processing-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'nlm-processing-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

/** Polls queryFn every 100 ms until it returns a truthy value or timeout. */
function waitForElement(queryFn, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      const el = queryFn();
      if (el) return resolve(el);
      if (Date.now() >= deadline) return reject(new Error('waitForElement timeout'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** Dispatch mousedown + mouseup + click on an element. */
function simulateClick(el) {
  ['mousedown', 'mouseup', 'click'].forEach(type =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
  );
}

/**
 * Non-blocking async search for the Angular confirm-dialog "delete" button.
 * Scoped strictly to CDK / dialog overlay containers — never matches our own
 * toolbar buttons (which also contain "\u5220\u9664").
 * Each iteration yields the main thread via await — no busy-wait, no deadlock.
 */
async function confirmDeleteDialog() {
  const maxRetries = 30; // 3000ms 轮询上限
  const pollInterval = 100;

  for (let i = 0; i < maxRetries; i++) {
    // 定位 Angular 弹窗的各种潜在父级容器
    const overlayContainers = document.querySelectorAll(
      '.cdk-overlay-container, .cdk-global-overlay-wrapper, dialog, .mat-mdc-dialog-container'
    );

    for (const container of overlayContainers) {
      const buttons = container.querySelectorAll('button');
      for (const btn of buttons) {
        // 清洗文本：去除所有空白字符（换行、制表符、空格）
        const cleanText = btn.textContent.replace(/\s+/g, '').toLowerCase();

        if (cleanText === '删除' || cleanText === 'delete') {
          // 执行点击
          btn.click();
          if (typeof simulateClick === 'function') {
            simulateClick(btn);
          }

          // 状态断言：阻塞等待直到弹窗按钮从 DOM 树中彻底销毁
          let waitUnmountCount = 0;
          while (document.body.contains(btn) && waitUnmountCount < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            waitUnmountCount++;
          }
          return true;
        }
      }
    }
    // 释放主线程
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.warn('[NLM Cleaner] 确认按钮查找超时。');
  return false;
}

/* ── Loading Overlay (full-screen, mounted on body) ───────────────────── */

let loadingOverlay = null;
let overlayProgressEl = null;

function mountLoadingOverlay(total) {
  dismissLoadingOverlay();

  const overlay = document.createElement('div');
  overlay.className = 'nlm-loading-overlay';

  const spinner = document.createElement('div');
  spinner.className = 'nlm-loading-spinner';
  overlay.appendChild(spinner);

  const progress = document.createElement('div');
  progress.className = 'nlm-loading-progress';
  progress.textContent = '\u51c6\u5907\u4e2d...';
  overlay.appendChild(progress);

  overlayProgressEl = progress;
  loadingOverlay = overlay;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => updateOverlayProgress(0, total));
}

function updateOverlayProgress(current, total) {
  if (overlayProgressEl) {
    overlayProgressEl.textContent =
      '\u6b63\u5728\u6e05\u7406... (' + current + '/' + total + ')';
  }
}

function dismissLoadingOverlay() {
  if (loadingOverlay) {
    loadingOverlay.remove();
    loadingOverlay = null;
    overlayProgressEl = null;
  }
}

/* ── Core Delete Flow ──────────────────────────────────────────────────── */

async function deleteSourceItem(sourceItem) {
  // Step 1: exact selector only — no heuristic fallbacks
  const menuBtn = sourceItem.querySelector(SELECTORS.MENU_BTN);
  if (!menuBtn) {
    console.warn('[NLM Cleaner] Menu button not found:', SELECTORS.MENU_BTN);
    return false;
  }

  // Step 2: open popup menu
  simulateClick(menuBtn);

  // Step 3: wait for delete menu item
  let deleteMenuItem;
  try {
    deleteMenuItem = await waitForElement(
      () => document.querySelector(SELECTORS.DELETE_MENU_ITEM),
      3000
    );
  } catch (e) {
    console.warn('[NLM Cleaner] Delete menu item not found — pressing Escape');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
    );
    return false;
  }

  // Step 4: click delete menu item
  simulateClick(deleteMenuItem);

  // Step 5: non-blocking confirm dialog (scoped to overlay containers)
  await confirmDeleteDialog();

  return true;
}

/* ── Bulk Delete ───────────────────────────────────────────────────────── */

let isBulkMode = false;
let bulkToolbar = null;
let selectedCount = 0;

function getAllSourceItems() {
  const sidebar = getSidebar();
  if (!sidebar) {
    console.warn('[NLM Cleaner] Sidebar not found — source items unavailable');
    return [];
  }
  return [...sidebar.querySelectorAll(SELECTORS.SOURCE_ITEM)];
}

function updateBulkUI() {
  const deleteBtn = document.getElementById('nlm-bulk-delete-btn');
  const countLabel = document.getElementById('nlm-selected-count');
  if (!deleteBtn || !countLabel) return;
  const checked = document.querySelectorAll('.nlm-source-checkbox:checked');
  selectedCount = checked.length;
  countLabel.textContent =
    selectedCount > 0 ? '\u5df2\u9009 ' + selectedCount + ' \u9879' : '';
  deleteBtn.disabled = selectedCount === 0;
}

function injectCheckbox(sourceItem) {
  if (sourceItem.querySelector('.nlm-source-checkbox')) return;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'nlm-source-checkbox';

  // 阻止click事件冒泡，防止触发NotebookLM原生行为
  cb.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
  });

  // 保持原有的change事件监听器
  cb.addEventListener('change', updateBulkUI);

  sourceItem.insertBefore(cb, sourceItem.firstChild);
}

function removeAllCheckboxes() {
  document.querySelectorAll('.nlm-source-checkbox').forEach(cb => cb.remove());
}

function toggleBulkMode() {
  isBulkMode = !isBulkMode;
  const toggleBtn = document.getElementById('nlm-bulk-toggle-btn');
  const deleteBtn  = document.getElementById('nlm-bulk-delete-btn');
  const countLabel = document.getElementById('nlm-selected-count');

  if (isBulkMode) {
    getAllSourceItems().forEach(injectCheckbox);
    toggleBtn?.classList.add('active');
    if (toggleBtn) {
      toggleBtn.textContent = '';
      toggleBtn.appendChild(createMaterialIcon('close'));
      toggleBtn.appendChild(document.createTextNode('\u9000\u51fa\u6279\u91cf'));
    }
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    if (countLabel) countLabel.style.display = 'inline';
    updateBulkUI();
  } else {
    removeAllCheckboxes();
    toggleBtn?.classList.remove('active');
    if (toggleBtn) {
      toggleBtn.textContent = '';
      toggleBtn.appendChild(createMaterialIcon('checklist'));
      toggleBtn.appendChild(document.createTextNode('\u6279\u91cf\u9009\u62e9'));
    }
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (countLabel) countLabel.style.display = 'none';
    selectedCount = 0;
  }
}

async function executeBulkDelete() {
  const checkedBoxes = [...document.querySelectorAll('.nlm-source-checkbox:checked')];
  if (checkedBoxes.length === 0) return;

  const deleteBtn = document.getElementById('nlm-bulk-delete-btn');
  const toggleBtn = document.getElementById('nlm-bulk-toggle-btn');
  if (deleteBtn) deleteBtn.disabled = true;
  if (toggleBtn) toggleBtn.disabled = true;

  document.body.classList.add('nlm-is-deleting');
  mountLoadingOverlay(checkedBoxes.length);

  let successCount = 0;
  try {
    let i = 0;
    for (const checkbox of checkedBoxes) {
      updateOverlayProgress(++i, checkedBoxes.length);
      const sourceItem = checkbox.closest(SELECTORS.SOURCE_ITEM) || checkbox.parentElement;
      if (!sourceItem) continue;
      try {
        const ok = await deleteSourceItem(sourceItem);
        if (ok) successCount++;
      } catch (err) {
        console.warn('[NLM Cleaner] Item failed, skipping:', err);
      }
    }
  } finally {
    // Guaranteed cleanup — page will never stay permanently blocked
    document.body.classList.remove('nlm-is-deleting');
    dismissLoadingOverlay();
    showToast('\u2705 \u6210\u529f\u5220\u9664 ' + successCount + ' \u6761', 2500);
    if (isBulkMode) toggleBulkMode();
    if (toggleBtn) toggleBtn.disabled = false;
  }
}

/* ── Material Icon Helper ──────────────────────────────────────────────── */

/** Safely create a Material Symbols icon span (no innerHTML). */
function createMaterialIcon(iconName) {
  const icon = document.createElement('span');
  icon.className = 'google-symbols';
  icon.textContent = iconName;
  icon.style.fontSize = '18px';
  icon.style.marginRight = '6px';
  icon.style.verticalAlign = 'middle';
  return icon;
}

/* ── Bulk Toolbar ──────────────────────────────────────────────────────── */

function createToolbarDOM() {
  const toolbar = document.createElement('div');
  toolbar.id = 'nlm-bulk-toolbar';

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'nlm-bulk-toggle-btn';
  toggleBtn.style.display = 'inline-flex';
  toggleBtn.style.alignItems = 'center';
  toggleBtn.appendChild(createMaterialIcon('checklist'));
  toggleBtn.appendChild(document.createTextNode('\u6279\u91cf\u9009\u62e9'));
  toggleBtn.addEventListener('click', toggleBulkMode);

  const countLabel = document.createElement('span');
  countLabel.id = 'nlm-selected-count';
  countLabel.style.display = 'none';

  const deleteBtn = document.createElement('button');
  deleteBtn.id = 'nlm-bulk-delete-btn';
  deleteBtn.style.display = 'none';
  deleteBtn.style.alignItems = 'center';
  deleteBtn.disabled = true;
  deleteBtn.appendChild(createMaterialIcon('delete'));
  deleteBtn.appendChild(document.createTextNode('\u5220\u9664\u9009\u4e2d'));
  deleteBtn.addEventListener('click', executeBulkDelete);

  toolbar.appendChild(toggleBtn);
  toolbar.appendChild(countLabel);
  toolbar.appendChild(deleteBtn);

  bulkToolbar = toolbar;
  return toolbar;
}

function injectBulkToolbar() {
  if (document.getElementById('nlm-bulk-toolbar')) return;
  const sidebar = getSidebar();
  if (!sidebar) {
    console.warn('[NLM Cleaner] Toolbar injection failed: sidebar not found');
    return;
  }
  const addSourceBtn = sidebar.querySelector(SELECTORS.ADD_SOURCE_AREA);
  if (addSourceBtn) {
    // 优先定位原生 .button-row 包裹层，确保工具栏继承相同的水平内边距和对齐上下文
    const buttonRow = addSourceBtn.closest('.button-row') || addSourceBtn.parentElement || addSourceBtn;
    buttonRow.insertAdjacentElement('afterend', createToolbarDOM());
    return;
  }
  // 备用：找不到按鈕时，插入至侧边栏首子节点之前
  sidebar.insertBefore(createToolbarDOM(), sidebar.firstChild);
}

/* ── Scan & Inject ─────────────────────────────────────────────────────── */

function scanAndInject() {
  getAllSourceItems().forEach(item => {
    if (isBulkMode) injectCheckbox(item);
  });
  injectBulkToolbar();
}

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

let currentUrl = location.href;
let isPluginMounted = false;
let innerObserver = null;
let mountDebounceTimer = null;
let scanDebounceTimer = null;

function isNotebookUrl(url) {
  return url.includes('/notebook/');
}

function debouncedScan(delay = 250) {
  clearTimeout(scanDebounceTimer);
  scanDebounceTimer = setTimeout(scanAndInject, delay);
}

function startInnerObserver(listContainer) {
  if (innerObserver) { innerObserver.disconnect(); innerObserver = null; }

  innerObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.(SELECTORS.SOURCE_ITEM)) {
          if (isBulkMode) injectCheckbox(node);
        } else if (node.querySelectorAll?.(SELECTORS.SOURCE_ITEM).length > 0) {
          debouncedScan(100);
          break;
        }
      }
    }
  });

  innerObserver.observe(listContainer, { childList: true, subtree: true });
  console.log('[NLM Cleaner] Inner Observer started');
}

function teardown() {
  innerObserver?.disconnect();
  innerObserver = null;
  clearTimeout(mountDebounceTimer);
  clearTimeout(scanDebounceTimer);
  document.getElementById('nlm-bulk-toolbar')?.remove();
  dismissLoadingOverlay();
  document.body.classList.remove('nlm-is-deleting');
  isBulkMode = false;
  selectedCount = 0;
  bulkToolbar = null;
  isPluginMounted = false;
  console.log('[NLM Cleaner] Teardown complete');
}

async function attemptMount() {
  if (isPluginMounted || !isNotebookUrl(location.href)) return;
  console.log('[NLM Cleaner] Waiting for sidebar...');

  let listContainer;
  try {
    listContainer = await waitForElement(
      () => document.querySelector(SELECTORS.SIDEBAR),
      15000
    );
  } catch (e) {
    console.warn('[NLM Cleaner] Sidebar not found within 15s — run nlmDebug()');
    window.nlmDebug?.();
    return;
  }

  isPluginMounted = true;
  scanAndInject();
  startInnerObserver(listContainer);
  console.log('[NLM Cleaner] Mounted');
}

function debouncedMount(delay = 350) {
  clearTimeout(mountDebounceTimer);
  mountDebounceTimer = setTimeout(attemptMount, delay);
}

/* ── Global Guardian (SPA route detection) ────────────────────────────── */

const globalGuardian = new MutationObserver(() => {
  const newUrl = location.href;
  if (newUrl === currentUrl) return;
  currentUrl = newUrl;
  teardown();
  if (isNotebookUrl(newUrl)) debouncedMount();
});

window.addEventListener('popstate', () => {
  const newUrl = location.href;
  if (newUrl === currentUrl) return;
  currentUrl = newUrl;
  teardown();
  if (isNotebookUrl(newUrl)) debouncedMount();
});

/* ── Diagnostics (window.nlmDebug) ────────────────────────────────────── */

window.nlmDebug = function () {
  console.group('[NLM Cleaner] v4 Diagnostic');
  console.log('URL:', location.href, '| notebook:', isNotebookUrl(location.href), '| mounted:', isPluginMounted);
  const sidebar = getSidebar();
  if (sidebar) {
    const items = sidebar.querySelectorAll(SELECTORS.SOURCE_ITEM);
    console.log('Sidebar:', sidebar);
    console.log('Source items:', items.length, '(' + SELECTORS.SOURCE_ITEM + ')');
    console.log('MENU_BTN:', sidebar.querySelector(SELECTORS.MENU_BTN) || 'not found \u2014 ' + SELECTORS.MENU_BTN);
    console.log('ADD_SOURCE_AREA:', sidebar.querySelector(SELECTORS.ADD_SOURCE_AREA) || 'not found \u2014 ' + SELECTORS.ADD_SOURCE_AREA);
  } else {
    console.warn('Sidebar NOT found (' + SELECTORS.SIDEBAR + ')');
    document.querySelectorAll('section').forEach((el, i) =>
      console.log('  section[' + i + ']', el.className)
    );
  }
  console.log('CDK overlay:', document.querySelector('.cdk-overlay-container') || 'not found');
  console.log('DELETE_MENU_ITEM (if open):', document.querySelector(SELECTORS.DELETE_MENU_ITEM) || 'not visible');
  console.groupEnd();
  return 'Done';
};

/* ── Init ──────────────────────────────────────────────────────────────── */

function init() {
  console.log('[NLM Cleaner] v4 \u2014 started');
  globalGuardian.observe(document.body, { childList: true, subtree: true });
  if (isNotebookUrl(location.href)) debouncedMount(500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
