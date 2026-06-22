// workspace/js/review.js
import * as store from './store.js';
import * as utils from './utils.js';

const LEVEL_RANK = { high: 3, medium: 2, low: 1 };
const LEVEL_LABEL = { high: '🔴 高危', medium: '🟡 中危', low: '🟢 低危' };
const LEVEL_CLS = { high: 'h', medium: 'm', low: 'l' };

export async function renderReview(data, main) {
  const review = data.review;
  if (!review.decisions) review.decisions = {};
  if (!review.items) review.items = [];

  review.items.forEach(it => {
    if (!review.decisions[it.id]) review.decisions[it.id] = { adopted: false, kept: false, editedSuggestion: it.suggestion, lastBy: null, lastTs: null };
  });

  let sortOrder = 'risk';
  let splitMode = false;
  let origSplitMode = false;
  let autoOutput = '';  // 基于采纳 items 算出的建议输出（不含手动改），用于 diff 手动修改

  main.innerHTML = `
    <div class="review-wrap">
      <div class="review-head">
        <h1>🛡️ 文案审核 · ${utils.esc(data.meta.title)}</h1>
      </div>
      <div class="review-grid">
        <section class="panel rev-panel panel-original">
          <h2><span>原文</span><button class="split-btn" id="origSplitBtn">✂️ 字幕断句</button></h2>
          <div id="revOriginal"></div>
        </section>
        <section class="panel rev-panel panel-items">
          <h2><span>采纳区</span>
            <span class="sort-bar">
              <button class="sort-btn on" data-sort="risk">⚠️ 危险程度</button>
              <button class="sort-btn" data-sort="text">📜 文案顺序</button>
            </span>
          </h2>
          <div id="revItems"></div>
        </section>
        <section class="panel rev-panel panel-output">
          <div class="out-head">
            <h2 style="margin:0">输出 <span style="font-size:11px;color:#8a9099;font-weight:400">（可手动编辑，改动的行会记录到上方「手动修改」）</span></h2>
            <div class="btns">
              <button class="split-btn" id="splitBtn">✂️ 字幕断句</button>
              <button class="btn primary" id="copyBtn">📋 复制</button>
              <button class="btn ok" id="pushDesignBtn">✓ 完成审核</button>
            </div>
          </div>
          <textarea id="revOutput" placeholder="实时拼合修改后的文案，可手动编辑"></textarea>
        </section>
      </div>
    </div>
  `;

  main.querySelectorAll('.sort-btn').forEach(b => {
    b.onclick = () => {
      sortOrder = b.dataset.sort;
      main.querySelectorAll('.sort-btn').forEach(x => x.classList.toggle('on', x.dataset.sort === sortOrder));
      renderItems();
    };
  });

  main.querySelector('#origSplitBtn').onclick = () => {
    origSplitMode = !origSplitMode;
    const btn = main.querySelector('#origSplitBtn');
    btn.classList.toggle('active', origSplitMode);
    btn.textContent = origSplitMode ? '↩️ 连续原文' : '✂️ 字幕断句';
    renderOriginal();
  };
  main.querySelector('#splitBtn').onclick = () => {
    splitMode = !splitMode;
    const btn = main.querySelector('#splitBtn');
    btn.classList.toggle('active', splitMode);
    btn.textContent = splitMode ? '↩️ 连续原文' : '✂️ 字幕断句';
    compose();
  };

  main.querySelector('#copyBtn').onclick = async () => {
    const t = main.querySelector('#revOutput').value;
    try {
      await navigator.clipboard.writeText(t);
      utils.toast('已复制');
    } catch {
      const ta = main.querySelector('#revOutput');
      ta.focus(); ta.select(); document.execCommand('copy');
      utils.toast('已复制');
    }
  };

  main.querySelector('#pushDesignBtn').onclick = () => pushToDesign(data);

  // 用户手动编辑输出框：记录到 review.output，debounce 后重渲采纳区（显示手动修改条目）
  let manualTimer = null;
  main.querySelector('#revOutput').addEventListener('input', () => {
    const ta = main.querySelector('#revOutput');
    review.output = ta.value;
    autoResize(ta);
    clearTimeout(manualTimer);
    manualTimer = setTimeout(() => {
      review.outputLastBy = store.getOperator();
      review.outputLastTs = utils.nowIso();
      renderItems();
      safeSave(data, 'manual_edit', '手动编辑输出');
    }, 800);
  });

  function posOf(it) { return it.original ? review.original.indexOf(it.original) : 999999; }
  function sortedItems() {
    const arr = review.items.slice();
    if (sortOrder === 'risk') arr.sort((a, b) => (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) || (posOf(a) - posOf(b)));
    else arr.sort((a, b) => posOf(a) - posOf(b));
    return arr;
  }

  function renderOriginal() {
    const rawText = origSplitMode && review.splitOriginal ? review.splitOriginal : review.original;
    const NL = '\x00';
    const text = origSplitMode ? rawText.replace(/\n/g, NL) : rawText;
    const marks = [];
    review.items.forEach(it => {
      if (!it.original) return;
      let idx = text.indexOf(it.original);
      while (idx !== -1) { marks.push({ s: idx, e: idx + it.original.length, level: it.level }); idx = text.indexOf(it.original, idx + 1); }
    });
    marks.sort((a, b) => a.s - b.s || b.e - a.e);
    const merged = [];
    for (const m of marks) {
      const last = merged[merged.length - 1];
      if (last && m.s < last.e) { last.e = Math.max(last.e, m.e); last.level = topRank(last.level, m.level); }
      else merged.push({ ...m });
    }
    let html = '', cur = 0;
    for (const m of merged) {
      if (m.s > cur) html += utils.esc(text.slice(cur, m.s));
      html += `<mark class="${LEVEL_CLS[m.level]}">${utils.esc(text.slice(m.s, m.e))}</mark>`;
      cur = m.e;
    }
    if (cur < text.length) html += utils.esc(text.slice(cur));
    main.querySelector('#revOriginal').innerHTML = origSplitMode ? html.replace(/\x00/g, '\n') : html;
  }

  function topRank(a, b) { return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b; }

  function renderItems() {
    const box = main.querySelector('#revItems');
    const manuals = diffManuals();
    const manualHtml = manuals.length ? `
      <div class="manual-section">
        <div class="manual-head">✏️ 手动修改 · ${manuals.length} 处 <span class="manual-hint">（你在输出框里改的行，按文案顺序排列，可逐行撤销）</span></div>
        ${manuals.map(m => `
          <div class="rev-card manual">
            <div><span class="tag manual-tag">✏️ 第${m.line}行</span>${review.outputLastBy ? ' ' + utils.operatorTag(review.outputLastBy) : ''}</div>
            <div class="rev-line">
              <span class="from">${utils.esc(m.auto)}</span>
              <span class="arrow">→</span>
              <span class="manual-to">${utils.esc(m.manual)}</span>
            </div>
            <div class="rev-actions">
              <button class="btn" data-revert="${m.line}">↩️ 撤销该行</button>
            </div>
          </div>
        `).join('')}
      </div>` : '';

    const itemsHtml = sortedItems().map(it => {
      const d = review.decisions[it.id] || { adopted: false, kept: false, editedSuggestion: it.suggestion };
      return `<div class="rev-card ${d.adopted ? 'adopted' : ''}">
        <div><span class="tag ${it.level}">${LEVEL_LABEL[it.level]}</span><span class="cat">${utils.esc(it.category || '')}</span>${d.lastBy ? ' ' + utils.operatorTag(d.lastBy) : ''}</div>
        <div class="rev-line">
          <span class="from">${utils.esc(it.original)}</span>
          <span class="arrow">→</span>
          <input class="edit-sug" data-id="${it.id}" value="${utils.escAttr(d.editedSuggestion)}" title="可直接修改改写内容">
        </div>
        <div class="rev-reason">${utils.esc(it.reason || '')}</div>
        <div class="rev-actions">
          <button class="btn yes ${d.adopted ? 'on' : ''}" data-id="${it.id}" data-act="1">✓ 采纳</button>
          <button class="btn no ${d.kept ? 'on' : ''}" data-id="${it.id}" data-act="0">✗ 保留原文</button>
        </div>
      </div>`;
    }).join('');

    box.innerHTML = manualHtml + itemsHtml;

    box.querySelectorAll('button[data-revert]').forEach(b => {
      b.onclick = () => revertManual(+b.dataset.revert);
    });
    box.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = async () => {
        const id = +b.dataset.id;
        const adopt = (b.dataset.act === '1');
        review.decisions[id].adopted = adopt;
        review.decisions[id].kept = !adopt;
        review.decisions[id].lastBy = store.getOperator();
        review.decisions[id].lastTs = utils.nowIso();
        await safeSave(data, 'review_decide', `第${id}条 ${adopt ? '采纳' : '保留'}`);
        compose();
      };
    });
    box.querySelectorAll('input.edit-sug').forEach(inp => {
      inp.oninput = () => {
        const id = +inp.dataset.id;
        review.decisions[id].editedSuggestion = inp.value;
      };
      inp.onblur = async () => {
        const id = +inp.dataset.id;
        review.decisions[id].lastBy = store.getOperator();
        review.decisions[id].lastTs = utils.nowIso();
        await safeSave(data, 'review_edit', `第${id}条改写`);
        compose();
      };
    });
  }

  // 基于采纳 items 算出建议输出（不含手动改），纯函数不碰输出框
  function computeAuto() {
    let text = splitMode && review.splitOriginal ? review.splitOriginal : review.original;
    const adopted = review.items
      .filter(it => review.decisions[it.id] && review.decisions[it.id].adopted && it.original)
      .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
    const NL = '\x00';
    if (splitMode) text = text.replace(/\n/g, NL);
    for (const it of adopted) {
      let sug = review.decisions[it.id].editedSuggestion;
      if (!sug || sug === it.original) continue;
      if (splitMode && it.splitSuggestion && sug === it.suggestion) sug = it.splitSuggestion;
      const ph = '\x01' + it.id + '\x01';
      text = text.split(it.original).join(ph);
      text = text.split(ph).join(sug);
    }
    if (splitMode) text = text.replace(/\x00/g, '\n');
    return cleanText(text);
  }

  function compose() {
    const prevAuto = autoOutput;
    autoOutput = computeAuto();
    const ta = main.querySelector('#revOutput');
    // 输出框未被手动改（== 上次自动值 或 空）→ 跟随新自动值；否则保留用户手动值
    if (ta.value === prevAuto || ta.value === '') {
      ta.value = autoOutput;
      review.output = autoOutput;
    }
    autoResize(ta);
    renderItems();
  }

  // 输出框随内容自动增高（电脑端 + 手机端都生效），原文框保持固定高度滚动
  function autoResize(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }

  // diff 建议输出(autoOutput) 与 用户输出(review.output) 的逐行差异 = 手动修改
  function diffManuals() {
    if (!autoOutput || review.output === autoOutput) return [];
    const a = autoOutput.split('\n'), m = (review.output || '').split('\n');
    const edits = [];
    const max = Math.max(a.length, m.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== m[i]) {
        edits.push({ line: i + 1, auto: a[i] !== undefined ? a[i] : '(无此行)', manual: m[i] !== undefined ? m[i] : '(已删除)' });
      }
    }
    return edits;
  }

  function revertManual(line) {
    const m = (review.output || '').split('\n');
    const a = autoOutput.split('\n');
    if (line >= 1 && line <= m.length && a[line - 1] !== undefined) {
      m[line - 1] = a[line - 1];
      review.output = m.join('\n');
      main.querySelector('#revOutput').value = review.output;
      renderItems();
      safeSave(data, 'manual_revert', `撤销第${line}行手动修改`);
      utils.toast('已撤销第' + line + '行');
    }
  }

  function cleanText(text) {
    return text
      .replace(/【[^】]*】/g, '')
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .split('\n')
      .map(l => l.replace(/^[\s　]+/, '').replace(/[\s　]+$/, ''))
      .filter(l => l.length > 0)
      .join('\n');
  }

  async function pushToDesign(data) {
    review.output = main.querySelector('#revOutput').value;
    if (!review.output || !review.output.trim()) {
      utils.toast('输出为空，无法推入');
      return;
    }
    const lines = review.output.split('\n').map(l => l.trim()).filter(Boolean);
    const pushBy = store.getOperator(), pushTs = utils.nowIso();
    data.design.shots = lines.map(line => ({
      line, subtitle: '',
      subject: { type: null, assetId: null, refs: [], prompt: '' },
      post: { text: '', sticker: '', fx: '', anim: '', trans: '' },
      timing: { text: '', sticker: '', fx: '', anim: '', trans: '' },
      lastBy: pushBy, lastTs: pushTs
    }));
    data.meta.stage = 'design';
    await safeSave(data, 'pushed_to_design', `生成 ${lines.length} 镜`);
    utils.toast(`✓ 审核完成，已生成 ${lines.length} 镜分镜。到「🎨 设计台」打开`);
  }

  async function safeSave(data, action, detail) {
    try { await store.logAndSave(data, action, detail); }
    catch (e) { utils.toast('保存失败：' + e.message); }
  }

  renderOriginal();
  renderItems();
  compose();
}
