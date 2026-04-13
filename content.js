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

const LOCALES = {
  en: {
    preparing: 'Preparing...',
    cleaningProgress: 'Cleaning... ({current}/{total})',
    selectedCount: 'Selected {count}',
    exitBulk: 'Exit Bulk',
    bulkSelect: 'Bulk Select',
    deleteSelected: 'Delete Selected',
    successDeleted: 'Success: deleted {count} items',
    confirmDeleteTokens: ['delete', 'remove', 'removesource', 'confirm', 'yes'],
  },
  'zh-CN': {
    preparing: '准备中...',
    cleaningProgress: '正在清理... ({current}/{total})',
    selectedCount: '已选 {count}项',
    exitBulk: '退出批量',
    bulkSelect: '批量选择',
    deleteSelected: '删除选中',
    successDeleted: '成功删除 {count} 条',
    confirmDeleteTokens: ['删除', '移除', '移除来源', 'delete', 'remove', '确认', '确定', '是'],
  },
  'zh-TW': {
    preparing: '準備中...',
    cleaningProgress: '正在清理... ({current}/{total})',
    selectedCount: '已選 {count} 項',
    exitBulk: '退出批次',
    bulkSelect: '批次選擇',
    deleteSelected: '刪除選中',
    successDeleted: '成功刪除 {count} 筆',
    confirmDeleteTokens: ['刪除', '删除', '移除', '移除來源', 'delete', 'remove', '確認', '確定', '是'],
  },
  ja: {
    preparing: '準備中...',
    cleaningProgress: '削除中... ({current}/{total})',
    selectedCount: '{count} 件を選択',
    exitBulk: '一括選択を終了',
    bulkSelect: '一括選択',
    deleteSelected: '選択を削除',
    successDeleted: '{count} 件を削除しました',
    confirmDeleteTokens: ['削除', 'delete'],
  },
  es: {
    preparing: 'Preparando...',
    cleaningProgress: 'Limpiando... ({current}/{total})',
    selectedCount: '{count} seleccionados',
    exitBulk: 'Salir del modo masivo',
    bulkSelect: 'Seleccion masiva',
    deleteSelected: 'Eliminar seleccionados',
    successDeleted: 'Eliminados {count} elementos',
    confirmDeleteTokens: ['eliminar', 'delete'],
  },
};

function detectLocale() {
  const preferred = [...(navigator.languages || []), navigator.language, 'en'].filter(Boolean);
  for (const raw of preferred) {
    const normalized = String(raw).trim();
    if (LOCALES[normalized]) return normalized;
    const base = normalized.split('-')[0];
    if (LOCALES[base]) return base;
    if (base === 'zh') return 'zh-CN';
  }
  return 'en';
}

const ACTIVE_LOCALE = detectLocale();

function t(key, params) {
  const dict = LOCALES[ACTIVE_LOCALE] || LOCALES.en;
  const fallback = LOCALES.en;
  let template = dict[key] ?? fallback[key] ?? key;
  if (params && typeof template === 'string') {
    Object.entries(params).forEach(([k, v]) => {
      template = template.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
    });
  }
  return template;
}

function getDeleteTokens() {
  const tokenList = [];
  Object.values(LOCALES).forEach((dict) => {
    if (Array.isArray(dict.confirmDeleteTokens)) {
      tokenList.push(...dict.confirmDeleteTokens);
    }
  });
  return new Set(
    tokenList
      .map((token) => String(token).replace(/\s+/g, '').toLowerCase())
  );
}

const CONFIRM_DELETE_TOKENS = getDeleteTokens();

const FAILURE_TYPES = {
  EVENT_CONFLICT: 'EVENT_CONFLICT',
  SELECTOR_MISS: 'SELECTOR_MISS',
  DIALOG_TIMEOUT: 'DIALOG_TIMEOUT',
  ROUTE_REMOUNT_FAIL: 'ROUTE_REMOUNT_FAIL',
};

const DIAG = {
  debugEnabled: false,
  failures: [],
  eventInterceptions: {
    pointerdown: 0,
    mousedown: 0,
    mouseup: 0,
    click: 0,
  },
};

function recordFailure(type, message, extra) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    message,
    extra: extra || null,
  };
  DIAG.failures.push(entry);
  if (DIAG.failures.length > 50) {
    DIAG.failures.shift();
  }
  if (DIAG.debugEnabled) {
    console.warn('[NLM Cleaner][Failure]', entry);
  }
}

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

function isElementVisible(el) {
  if (!(el instanceof Element)) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function isButtonActionable(btn) {
  if (!(btn instanceof Element)) return false;
  if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
  const style = getComputedStyle(btn);
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
    return false;
  }
  return true;
}

function getButtonRejectReason(btn) {
  if (!(btn instanceof Element)) return 'not-element';
  if (btn.disabled) return 'disabled';
  if (btn.getAttribute('aria-disabled') === 'true') return 'aria-disabled';
  const style = getComputedStyle(btn);
  if (style.display === 'none') return 'display-none';
  if (style.visibility === 'hidden') return 'visibility-hidden';
  if (style.pointerEvents === 'none') return 'pointer-events-none';
  return '';
}

function normalizeDialogText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

function isCancelLikeText(text) {
  const normalized = normalizeDialogText(text);
  return (
    normalized.includes('取消') ||
    normalized.includes('cancel') ||
    normalized.includes('no') ||
    normalized.includes('否')
  );
}

function findNativeConfirmByXPath() {
  const xpaths = [
    '/html/body/div[7]/div/div[2]/mat-dialog-container/div/div/delete-source/base-dialog/div/div[3]/button[2]/span[4]',
    '//delete-source//base-dialog//div[contains(@class,"actions") or contains(@class,"footer") or contains(@class,"buttons")]//button[2]',
    '//mat-dialog-container//delete-source//button[2]'
  ];

  for (const xpath of xpaths) {
    try {
      const node = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (!node) continue;
      const btn = node.closest && node.closest('button, [role="button"], a');
      if (btn) return btn;
      if (node instanceof Element) return node;
    } catch (e) {
      // ignore malformed/unsupported xpath in current DOM snapshot
    }
  }
  return null;
}

function pickStructuralConfirmButton(container) {
  if (!(container instanceof Element)) return null;
  const allCandidates = Array.from(container.querySelectorAll('button, [role="button"], a'));
  const actionable = allCandidates.filter(isButtonActionable);
  if (actionable.length === 0) return null;

  const contextualText = normalizeDialogText(container.textContent || '');
  const hasDeleteContext =
    !!container.querySelector('delete-source, base-dialog') ||
    contextualText.includes('要删除') ||
    contextualText.includes('删除') ||
    contextualText.includes('移除来源') ||
    contextualText.includes('deletesource') ||
    contextualText.includes('removesource');

  if (!hasDeleteContext) return null;

  const nonCancel = actionable.filter((btn) => {
    const text = (btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '');
    return !isCancelLikeText(text);
  });
  const pool = nonCancel.length > 0 ? nonCancel : actionable;

  const preferred = pool.find((btn) =>
    btn.hasAttribute('cdkfocusinitial') ||
    btn.getAttribute('mat-flat-button') !== null ||
    /mat-mdc-unelevated-button|mdc-button--unelevated|mdc-button--raised|mat-primary/.test(btn.className || '')
  );

  return preferred || pool[pool.length - 1] || null;
}

/**
 * Non-blocking async search for the Angular confirm-dialog "delete" button.
 * Scoped strictly to CDK / dialog overlay containers — never matches our own
 * toolbar buttons (which also contain "\u5220\u9664").
 * Each iteration yields the main thread via await — no busy-wait, no deadlock.
 */
async function confirmDeleteDialog() {
  const maxRetries = 120; // 12000ms 轮询上限，覆盖真实页面慢弹窗/动画期
  const pollInterval = 100;
  const diagLog = [];
  const DIALOG_ROOT_SELECTOR = 'dialog, [role="dialog"], [role="alertdialog"], .mat-mdc-dialog-container, mat-dialog-container, .cdk-dialog-container, .dialog-container, .gmat-dialog';

  const tryClickConfirm = async (btn, i, reasonTag) => {
    const rawText = btn.textContent || '';
    const cleanText = normalizeDialogText(rawText);
    diagLog.push(`✓ [轮询${i}] 触发确认点击(${reasonTag}): "${rawText}" → "${cleanText}"`);

    let clicked = false;
    try {
      btn.click();
      diagLog.push(`✓ [轮询${i}] btn.click() 已执行`);
      clicked = true;
    } catch (e) {
      diagLog.push(`✗ [轮询${i}] btn.click() 失败: ${e.message}`);
    }

    if (typeof simulateClick === 'function') {
      await new Promise(resolve => setTimeout(resolve, 30));
      const stillMounted = document.body.contains(btn);
      if (!clicked || stillMounted) {
        try {
          simulateClick(btn);
          diagLog.push(`✓ [轮询${i}] simulateClick() 已执行`);
        } catch (e) {
          diagLog.push(`✗ [轮询${i}] simulateClick() 失败: ${e.message}`);
        }
      }
    }

    let waitUnmountCount = 0;
    while (document.body.contains(btn) && waitUnmountCount < 20) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitUnmountCount++;
    }
    diagLog.push(`✓ [轮询${i}] 按钮卸载检查结束 (等待${waitUnmountCount}*100ms)`);

    if (DIAG.debugEnabled) {
      console.log('[NLM Cleaner] confirmDeleteDialog 诊断日志:', diagLog.join('\n'));
    }
    return true;
  };

  for (let i = 0; i < maxRetries; i++) {
    const nativeByXPath = findNativeConfirmByXPath();
    if (nativeByXPath) {
      if (isButtonActionable(nativeByXPath)) {
        diagLog.push(`[轮询${i}] 命中 XPath 原生确认按钮兜底`);
        return tryClickConfirm(nativeByXPath, i, 'xpath-fallback');
      }
      diagLog.push(`[轮询${i}] XPath 已命中但不可点击: ${getButtonRejectReason(nativeByXPath) || 'unknown'}`);
    }

    const overlayContainers = document.querySelectorAll(
      '.cdk-overlay-container, .cdk-global-overlay-wrapper, dialog, .mat-mdc-dialog-container, [role="dialog"], [role="alertdialog"], mat-dialog-container'
    );
    const dialogRoots = Array.from(document.querySelectorAll(DIALOG_ROOT_SELECTOR)).filter((root) => {
      // 不对根节点做严格“可见性”判定，避免误杀 display: contents / 过渡态容器
      return root.querySelectorAll('button, [role="button"], a').length > 0;
    });

    if (i === 0 || i % 10 === 0) {
      diagLog.push(`[轮询${i}] 找到${overlayContainers.length}个overlay容器, ${dialogRoots.length}个dialog根节点`);
    }

    let matchedButBlocked = 0;

    // 优先处理后出现的 dialog（通常为最顶层）
    for (const container of dialogRoots.reverse()) {
      const candidates = Array.from(container.querySelectorAll('button, [role="button"], a'));

      for (const btn of candidates) {
        // 清洗文本：去除所有空白字符（换行、制表符、空格）
        const rawText = btn.textContent || '';
        const cleanText = normalizeDialogText(rawText);
        const ariaLabel = normalizeDialogText(btn.getAttribute('aria-label'));
        const title = normalizeDialogText(btn.getAttribute('title'));
        const matchedToken = Array.from(CONFIRM_DELETE_TOKENS).find((token) => {
          return cleanText.includes(token) || ariaLabel.includes(token) || title.includes(token);
        });
        const hasConfirmSemantics =
          btn.hasAttribute('cdkfocusinitial') ||
          btn.getAttribute('mat-flat-button') !== null ||
          /mat-mdc-unelevated-button|mdc-button--unelevated|mdc-button--raised|mat-primary/.test(btn.className || '');
        const fallbackConfirm = hasConfirmSemantics && !isCancelLikeText(rawText) && !isCancelLikeText(btn.getAttribute('aria-label'));
        const actionable = isButtonActionable(btn);
        const rejectReason = getButtonRejectReason(btn);
        
        // 匹配删除语义或结构语义（主操作按钮）
        if (matchedToken || fallbackConfirm) {
          diagLog.push(`✓ [轮询${i}] 找到确认候选: "${rawText}" → "${cleanText}" (${matchedToken ? `token: ${matchedToken}` : 'semantic fallback'}, actionable=${actionable}${rejectReason ? `, reason=${rejectReason}` : ''})`);
          
          if (DIAG.debugEnabled) {
            console.log('[NLM Cleaner] 确认按钮详情:', {
              rawText,
              cleanText,
              ariaLabel,
              title,
              matchedToken,
              html: btn.outerHTML.substring(0, 100),
              disabled: btn.disabled,
              dataTestid: btn.getAttribute('data-testid'),
              actionable,
              rejectReason,
            });
          }

          if (actionable || rejectReason === 'pointer-events-none') {
            return tryClickConfirm(btn, i, 'actionable');
          }

          matchedButBlocked++;
        }
      }

      const structuralBtn = pickStructuralConfirmButton(container);
      if (structuralBtn) {
        diagLog.push(`[轮询${i}] 结构兜底命中确认按钮`);
        return tryClickConfirm(structuralBtn, i, 'structural-fallback');
      }
    }

    if (matchedButBlocked > 0) {
      diagLog.push(`[轮询${i}] 检测到 ${matchedButBlocked} 个确认候选，但当前不可点击，继续等待下一轮`);
    }
    
    // 每10轮（1秒）输出一次统计
    if (i % 10 === 0 && i > 0) {
      const allButtons = Array.from(dialogRoots).flatMap(c => 
        Array.from(c.querySelectorAll('button')).map(b => b.textContent.substring(0, 20))
      );
      if (allButtons.length > 0) {
        diagLog.push(`[轮询${i}] 发现${allButtons.length}个按钮，但未匹配任何token: ${allButtons.join(', ')}`);
      }
    }
    
    // 释放主线程
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // 超时时的详细诊断
  const finalContainers = Array.from(document.querySelectorAll(DIALOG_ROOT_SELECTOR)).filter((root) => {
    return root.querySelectorAll('button, [role="button"], a').length > 0;
  });
  const orphanedButtons = finalContainers.flatMap(c =>
    Array.from(c.querySelectorAll('button, [role="button"], a')).map(b => ({
      text: b.textContent,
      clean: normalizeDialogText(b.textContent),
      actionable: isButtonActionable(b),
      rejectReason: getButtonRejectReason(b),
      html: b.outerHTML.substring(0, 80),
    }))
  );

  recordFailure(
    FAILURE_TYPES.DIALOG_TIMEOUT,
    '确认按钮查找超时 - 5秒钟轮询后仍未找到',
    { 
      pollInterval, 
      maxRetries,
      tokens: Array.from(CONFIRM_DELETE_TOKENS),
      orphanedButtons,
      diagLog,
    }
  );
  
  if (orphanedButtons.length > 0) {
    const textList = orphanedButtons.map(b => b.text.trim().substring(0, 10));
    showToast(`超时。可点元素: [${textList.join(' | ')}]`, 8000);
  } else {
    showToast('超时。画面上没有任何对话框/按钮，Selector不匹配...', 8000);
  }

  console.warn('[NLM Cleaner] 确认按钮查找超时。', {
    foundContainers: finalContainers.length,
    buttons: orphanedButtons,
    tokens: Array.from(CONFIRM_DELETE_TOKENS),
  });
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
  progress.textContent = t('preparing');
  overlay.appendChild(progress);

  overlayProgressEl = progress;
  loadingOverlay = overlay;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => updateOverlayProgress(0, total));
}

function updateOverlayProgress(current, total) {
  if (overlayProgressEl) {
    overlayProgressEl.textContent = t('cleaningProgress', { current, total });
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
    recordFailure(
      FAILURE_TYPES.SELECTOR_MISS,
      '未找到来源菜单按钮',
      { selector: SELECTORS.MENU_BTN }
    );
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
    recordFailure(
      FAILURE_TYPES.SELECTOR_MISS,
      '未找到删除菜单项',
      { selector: SELECTORS.DELETE_MENU_ITEM }
    );
    console.warn('[NLM Cleaner] Delete menu item not found — pressing Escape');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
    );
    return false;
  }

  // Step 4: click delete menu item
  simulateClick(deleteMenuItem);

  // Step 5: non-blocking confirm dialog (scoped to overlay containers)
  const confirmed = await confirmDeleteDialog();
  if (!confirmed) {
    recordFailure(
      FAILURE_TYPES.DIALOG_TIMEOUT,
      '删除确认未完成，跳过当前项',
      { sourceText: sourceItem.textContent?.slice(0, 80) || '' }
    );
  }

  return confirmed;
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
    selectedCount > 0 ? t('selectedCount', { count: selectedCount }) : '';
  deleteBtn.disabled = selectedCount === 0;
}

function injectCheckbox(sourceItem) {
  if (sourceItem.querySelector('.nlm-source-checkbox')) return;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'nlm-source-checkbox';

  // 仅阻断冒泡，不阻止默认勾选行为
  cb.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  // 兜底拦截早于 click 的链路，避免宿主页在 down 阶段触发详情跳转
  ['pointerdown', 'mousedown', 'mouseup'].forEach((type) => {
    cb.addEventListener(type, (event) => {
      event.stopPropagation();
    });
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
      toggleBtn.appendChild(document.createTextNode(t('exitBulk')));
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
      toggleBtn.appendChild(document.createTextNode(t('bulkSelect')));
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
    showToast(t('successDeleted', { count: successCount }), 2500);
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
  toggleBtn.appendChild(document.createTextNode(t('bulkSelect')));
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
  deleteBtn.appendChild(document.createTextNode(t('deleteSelected')));
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
    recordFailure(
      FAILURE_TYPES.SELECTOR_MISS,
      '工具栏注入失败：未找到侧边栏',
      { selector: SELECTORS.SIDEBAR }
    );
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
    recordFailure(
      FAILURE_TYPES.ROUTE_REMOUNT_FAIL,
      'Sidebar 在 15s 内未出现，重挂失败',
      { selector: SELECTORS.SIDEBAR }
    );
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

/* ── 事件拦截模块（防误跳转） ─────────────────────────────────────────────── */

function interceptCheckboxEvent(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const checkbox = target.closest('.nlm-source-checkbox');
  if (!checkbox) return;

  if (event.type in DIAG.eventInterceptions) {
    DIAG.eventInterceptions[event.type]++;
  }

  // 捕获阶段尽早阻断宿主页事件链，避免导航逻辑抢占
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }

  // down 阶段阻断默认行为，避免父级/宿主页触发预导航动作
  if (event.type === 'pointerdown' || event.type === 'mousedown') {
    event.preventDefault();
  }
}

const INTERCEPT_EVENT_TYPES = ['pointerdown', 'mousedown', 'mouseup', 'click'];

function setupCheckboxInterception() {
  INTERCEPT_EVENT_TYPES.forEach((type) => {
    document.addEventListener(type, interceptCheckboxEvent, true);
  });
}

/* ── Diagnostics (window.nlmDebug) ────────────────────────────────────── */

window.nlmDebug = function () {
  console.group('[NLM Cleaner] v4 Diagnostic');
  const rootStyles = getComputedStyle(document.documentElement);
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
  console.log('Theme tokens:', {
    textPrimary: rootStyles.getPropertyValue('--ext-text-primary').trim(),
    textMuted: rootStyles.getPropertyValue('--ext-text-muted').trim(),
    bgIdle: rootStyles.getPropertyValue('--ext-bg-idle').trim(),
  });
  console.log('Event interception count:', DIAG.eventInterceptions);
  console.log('Recent failures:', DIAG.failures);
  console.log('CDK overlay:', document.querySelector('.cdk-overlay-container') || 'not found');
  console.log('DELETE_MENU_ITEM (if open):', document.querySelector(SELECTORS.DELETE_MENU_ITEM) || 'not visible');
  console.groupEnd();
  return 'Done';
};

window.nlmSetDebug = function (enabled) {
  DIAG.debugEnabled = !!enabled;
  return DIAG.debugEnabled;
};

window.nlmGetFailures = function () {
  return [...DIAG.failures];
};

/* ── Init ──────────────────────────────────────────────────────────────── */

function init() {
  console.log('[NLM Cleaner] v4 \u2014 started');
  setupCheckboxInterception();
  globalGuardian.observe(document.body, { childList: true, subtree: true });
  if (isNotebookUrl(location.href)) debouncedMount(500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
