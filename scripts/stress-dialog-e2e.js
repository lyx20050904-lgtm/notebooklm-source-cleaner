const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const projectRoot = path.resolve(__dirname, '..');
const contentJs = fs.readFileSync(path.join(projectRoot, 'content.js'), 'utf8');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function buildEnv() {
  const html = `<!doctype html><html><body>
    <section class="source-panel">
      <button class="add-source-button">Add Source</button>
      <div class="single-source-container" data-id="s1">
        <div class="source-title">Source 1</div>
        <button class="source-item-more-button">more_vert</button>
      </div>
    </section>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'https://notebooklm.google.com/notebook/stress-e2e',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  // Execute extension content script and expose internals for harness.
  window.eval(`${contentJs}\nwindow.__nlmExports = { deleteSourceItem, confirmDeleteDialog, nlmGetFailures: window.nlmGetFailures };`);
  if (document.readyState === 'loading') {
    document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  }

  await sleep(30);
  return { window, document };
}

function mountNoiseDialogs(document, variant) {
  // Mimic emoji keyboard dialog noise from real logs.
  const emoji = document.createElement('div');
  emoji.className = 'emoji-keyboard__container emoji-keyboard__container--with-shadow';
  emoji.setAttribute('role', 'dialog');
  for (let i = 0; i < 12; i++) {
    const b = document.createElement('button');
    b.textContent = i === 10 ? '搜索结果' : i === 11 ? '最近使用过' : '';
    emoji.appendChild(b);
  }
  document.body.appendChild(emoji);

  if (variant === 'nested-dialog') {
    const cdkOverlay = document.createElement('div');
    cdkOverlay.className = 'cdk-overlay-container';
    const matDialog = document.createElement('div');
    matDialog.className = 'mat-mdc-dialog-container mdc-dialog cdk-dialog-container mdc-dialog--open';
    const inner = document.createElement('div');
    inner.className = 'dialog-container';

    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.textContent = '删除';
    confirm.dataset.confirmDelete = '1';

    inner.appendChild(cancel);
    inner.appendChild(confirm);
    matDialog.appendChild(inner);
    cdkOverlay.appendChild(matDialog);
    document.body.appendChild(cdkOverlay);
    return confirm;
  }

  const dialog = document.createElement('div');
  dialog.className = 'dialog-container';
  dialog.setAttribute('role', 'dialog');

  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  const confirm = document.createElement('button');
  confirm.textContent = sample(['删除', 'Delete', '刪除', '削除', 'eliminar']);
  confirm.dataset.confirmDelete = '1';

  dialog.appendChild(cancel);
  dialog.appendChild(confirm);
  document.body.appendChild(dialog);
  return confirm;
}

function installMockFlow(window, document, options) {
  const sourceItem = document.querySelector('.single-source-container');
  const menuBtn = sourceItem.querySelector('.source-item-more-button');

  let confirmedCount = 0;
  let menuOpenedCount = 0;

  // Step A: opening source menu creates delete menu item.
  menuBtn.addEventListener('click', () => {
    menuOpenedCount += 1;

    const existing = document.querySelector('.mock-menu-host');
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.className = 'mock-menu-host cdk-overlay-container';

    const deleteItem = document.createElement('button');
    deleteItem.className = 'more-menu-delete-source-button';
    // Deliberately mixed text to reproduce prior false-positive behavior.
    deleteItem.textContent = options.menuDeleteText;

    deleteItem.addEventListener('click', async () => {
      await sleep(options.dialogDelayMs);
      const confirmBtn = mountNoiseDialogs(document, options.dialogVariant);
      confirmBtn.addEventListener('click', () => {
        confirmedCount += 1;
        // Remove all dialog roots after confirm.
        document
          .querySelectorAll('dialog, [role="dialog"], .mat-mdc-dialog-container, mat-dialog-container, .cdk-dialog-container, .dialog-container')
          .forEach((el) => el.remove());
      });
    });

    host.appendChild(deleteItem);
    document.body.appendChild(host);
  });

  return {
    sourceItem,
    getStats: () => ({ confirmedCount, menuOpenedCount }),
  };
}

async function runOnce(caseId, options) {
  const { window, document } = await buildEnv();

  const exports = window.__nlmExports || {};
  if (typeof exports.deleteSourceItem !== 'function') {
    throw new Error('deleteSourceItem is not exposed to stress harness');
  }

  const flow = installMockFlow(window, document, options);

  const ok = await exports.deleteSourceItem(flow.sourceItem);
  const stats = flow.getStats();
  const failures = typeof exports.nlmGetFailures === 'function' ? exports.nlmGetFailures() : [];

  const pass = ok === true && stats.confirmedCount === 1;

  return {
    caseId,
    pass,
    ok,
    confirmedCount: stats.confirmedCount,
    menuOpenedCount: stats.menuOpenedCount,
    recentFailure: failures.length ? failures[failures.length - 1] : null,
    options,
  };
}

async function main() {
  const rounds = 220;
  const cases = [];

  for (let i = 0; i < rounds; i++) {
    const options = {
      menuDeleteText: sample([
        'delete 移除来源',
        'delete source',
        '删除来源',
        'delete',
      ]),
      dialogDelayMs: randomInt(0, 800),
      dialogVariant: sample(['flat-dialog', 'nested-dialog']),
    };

    // eslint-disable-next-line no-await-in-loop
    const result = await runOnce(`R${i + 1}`, options);
    cases.push(result);
  }

  const failed = cases.filter((c) => !c.pass);
  const summary = {
    total: cases.length,
    passed: cases.length - failed.length,
    failed: failed.length,
    passRate: Number((((cases.length - failed.length) / cases.length) * 100).toFixed(2)),
  };

  console.log(JSON.stringify({ summary, failedSamples: failed.slice(0, 10) }, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
