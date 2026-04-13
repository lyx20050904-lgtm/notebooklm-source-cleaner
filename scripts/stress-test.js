const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const projectRoot = path.resolve(__dirname, '..');
const contentJs = fs.readFileSync(path.join(projectRoot, 'content.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(projectRoot, 'style.css'), 'utf8');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildEnv({ addHostOverride = false } = {}) {
  const html = `<!doctype html><html><head></head><body>
    <section class="source-panel">
      <div class="button-row"><button class="add-source-button">Add Source</button></div>
      <div class="single-source-container"><div class="source-content">S1</div><button class="source-item-more-button">...</button></div>
      <div class="single-source-container"><div class="source-content">S2</div><button class="source-item-more-button">...</button></div>
      <div class="single-source-container"><div class="source-content">S3</div><button class="source-item-more-button">...</button></div>
    </section>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'https://notebooklm.google.com/notebook/test-id',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  let clickNavCount = 0;
  let downNavCount = 0;
  document.querySelectorAll('.single-source-container').forEach((row) => {
    row.addEventListener('click', () => {
      clickNavCount += 1;
    });
    row.addEventListener('mousedown', () => {
      downNavCount += 1;
    });
  });

  if (addHostOverride) {
    const hostStyle = document.createElement('style');
    hostStyle.textContent = 'button { color: rgb(255,255,255) !important; }';
    document.head.appendChild(hostStyle);
  }

  const styleTag = document.createElement('style');
  styleTag.textContent = styleCss;
  document.head.appendChild(styleTag);

  window.eval(contentJs);

  if (document.readyState === 'loading') {
    document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  }

  await sleep(900);

  return {
    window,
    document,
    getClickNavCount: () => clickNavCount,
    getDownNavCount: () => downNavCount,
  };
}

async function buildLargeEnv(itemCount = 200) {
  const itemsHtml = Array.from({ length: itemCount }, (_, i) =>
    `<div class="single-source-container"><div class="source-content">S${i + 1}</div><button class="source-item-more-button">...</button></div>`
  ).join('');

  const html = `<!doctype html><html><head></head><body>
    <section class="source-panel">
      <div class="button-row"><button class="add-source-button">Add Source</button></div>
      ${itemsHtml}
    </section>
  </body></html>`;

  const dom = new JSDOM(html, {
    url: 'https://notebooklm.google.com/notebook/test-large',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const { document } = window;

  const styleTag = document.createElement('style');
  styleTag.textContent = styleCss;
  document.head.appendChild(styleTag);

  window.eval(contentJs);
  if (document.readyState === 'loading') {
    document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  }
  await sleep(900);
  return { window, document };
}

async function run() {
  const results = [];

  {
    const env = await buildEnv();
    const { document } = env;
    const toggleBtn = document.getElementById('nlm-bulk-toggle-btn');
    toggleBtn?.click();
    await sleep(50);

    const cb = document.querySelector('.nlm-source-checkbox');
    const before = cb?.checked;
    cb?.click();
    await sleep(20);
    const after = cb?.checked;

    results.push({
      id: 'TC-P0-02-A',
      title: '复选框点击可选中',
      expected: 'click 后 checked=true',
      actual: `before=${before}, after=${after}`,
      pass: after === true,
      severity: 'P0',
    });
  }

  {
    const env = await buildEnv();
    const { document } = env;
    const toggleBtn = document.getElementById('nlm-bulk-toggle-btn');
    toggleBtn?.click();
    await sleep(50);

    const cb = document.querySelector('.nlm-source-checkbox');
    const downEvent = new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    cb?.dispatchEvent(downEvent);

    results.push({
      id: 'TC-P0-02-B',
      title: '复选框点击不触发来源跳转（mousedown链路）',
      expected: 'source 行 mousedown 导航计数=0',
      actual: `downNavCount=${env.getDownNavCount()}`,
      pass: env.getDownNavCount() === 0,
      severity: 'P0',
    });
  }

  {
    const env = await buildEnv();
    const { document, window } = env;
    const toggleBtn = document.getElementById('nlm-bulk-toggle-btn');
    const color = toggleBtn ? window.getComputedStyle(toggleBtn).color : 'N/A';
    const pass = color !== 'rgb(255, 255, 255)';
    results.push({
      id: 'TC-P0-01-A',
      title: '浅色模式下主按钮文字可读',
      expected: '按钮文字不应为纯白',
      actual: `color=${color}`,
      pass,
      severity: 'P0',
    });
  }

  {
    const env = await buildEnv({ addHostOverride: true });
    const { document, window } = env;
    const toggleBtn = document.getElementById('nlm-bulk-toggle-btn');
    const color = toggleBtn ? window.getComputedStyle(toggleBtn).color : 'N/A';
    const pass = color !== 'rgb(255, 255, 255)';
    results.push({
      id: 'TC-P0-01-B',
      title: '宿主样式覆盖压力下仍保持可读',
      expected: '按钮文字不应被宿主强制变白',
      actual: `color=${color}`,
      pass,
      severity: 'P0',
    });
  }

  {
    const env = await buildEnv();
    const { document } = env;
    const toggleBtn = document.getElementById('nlm-bulk-toggle-btn');
    for (let i = 0; i < 120; i++) {
      toggleBtn?.click();
    }
    await sleep(80);
    const toolbars = document.querySelectorAll('#nlm-bulk-toolbar').length;
    const checkboxes = document.querySelectorAll('.nlm-source-checkbox').length;
    results.push({
      id: 'TC-P1-04',
      title: '快速开关批量模式压力',
      expected: '工具栏唯一且状态可恢复',
      actual: `toolbars=${toolbars}, checkboxes=${checkboxes}`,
      pass: toolbars === 1,
      severity: 'P1',
    });
  }

  {
    const start = Date.now();
    const env = await buildLargeEnv(500);
    const { document } = env;
    const toggleBtn = document.getElementById('nlm-bulk-toggle-btn');
    toggleBtn?.click();
    await sleep(120);
    const elapsed = Date.now() - start;
    const checkboxes = document.querySelectorAll('.nlm-source-checkbox').length;
    results.push({
      id: 'S2-LARGE-500',
      title: '大规模来源注入压力（500条）',
      expected: '500条均成功注入，且在可接受时延内完成',
      actual: `checkboxes=${checkboxes}, elapsedMs=${elapsed}`,
      pass: checkboxes === 500,
      severity: 'P1',
    });
  }

  const total = results.length;
  const failed = results.filter((r) => !r.pass);
  const summary = {
    total,
    passed: total - failed.length,
    failed: failed.length,
    failures: failed,
  };

  console.log(JSON.stringify({ summary, results }, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
