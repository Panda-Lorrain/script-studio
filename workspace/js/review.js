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
    if (!review.decisions[it.id]) review.decisions[it.id] = { adopted: false, editedSuggestion: it.suggestion };
  });

  let sortOrder = 'risk';
  let splitMode = false;
  let origSplitMode = false;

  main.innerHTML = `
    <div class="review-wrap">
      <div class="review-head">
        <h1>🛡️ 文案审核 · ${utils.esc(data.meta.title)}</h1>
        <div class="verdict">${utils.esc(review.platform || '')}${review.verdict ? ' · ' + utils.esc(review.verdict) : ''}</div>
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
            <h2 style="margin:0">输出</h2>
            <div class="btns">
              <button class="split-btn" id="splitBtn">✂️ 字幕断句</button>
              <button class="btn primary" id="copyBtn">📋 复制</button>
              <button class="btn ok" id="pushDesignBtn">→ 推入设计台</button>
            </div>
          </div>
          <textarea id="revOutput" placeholder="实时拼合修改后的文案"></textarea>
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
    box.innerHTML = sortedItems().map(it => {
      const d = review.decisions[it.id] || { adopted: false, editedSuggestion: it.suggestion };
      return `<div class="rev-card ${d.adopted ? 'adopted' : ''}">
        <div><span class="tag ${it.level}">${LEVEL_LABEL[it.level]}</span><span class="cat">${utils.esc(it.category || '')}</span></div>
        <div class="rev-line">
          <span class="from">${utils.esc(it.original)}</span>
          <span class="arrow">→</span>
          <input class="edit-sug" data-id="${it.id}" value="${utils.escAttr(d.editedSuggestion)}" title="可直接修改改写内容">
        </div>
        <div class="rev-reason">${utils.esc(it.reason || '')}</div>
        <div class="rev-actions">
          <button class="btn yes ${d.adopted ? 'on' : ''}" data-id="${it.id}" data-act="1">✓ 采纳</button>
          <button class="btn no ${!d.adopted ? 'on' : ''}" data-id="${it.id}" data-act="0">✗ 保留原文</button>
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = async () => {
        const id = +b.dataset.id;
        review.decisions[id].adopted = (b.dataset.act === '1');
        await safeSave(data, 'review_decide', `第${id}条 ${review.decisions[id].adopted ? '采纳' : '保留'}`);
        renderItems();
        compose();
      };
    });
    box.querySelectorAll('input.edit-sug').forEach(inp => {
      inp.oninput = () => {
        const id = +inp.dataset.id;
        review.decisions[id].editedSuggestion = inp.value;
      };
      inp.onblur = async () => {
        await safeSave(data, 'review_edit', `第${inp.dataset.id}条改写`);
        compose();
      };
    });
  }

  function compose() {
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
    const cleaned = cleanText(text);
    main.querySelector('#revOutput').value = cleaned;
    review.output = cleaned;
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
    compose();
    if (!review.output || !review.output.trim()) {
      utils.toast('输出为空，无法推入');
      return;
    }
    const lines = review.output.split('\n').map(l => l.trim()).filter(Boolean);
    data.design.shots = lines.map(line => ({
      line, subtitle: '',
      subject: { type: null, assetId: null, refs: [], prompt: '' },
      post: { text: '', sticker: '', fx: '', anim: '', trans: '' },
      timing: { text: '', sticker: '', fx: '', anim: '', trans: '' }
    }));
    data.meta.stage = 'design';
    await safeSave(data, 'pushed_to_design', `生成 ${lines.length} 镜`);
    utils.toast(`已推入设计台（${lines.length} 镜）`);
    location.hash = encodeURIComponent(data.meta.title) + '/design';
  }

  // 只读模式（未授权目录）下保存静默失败，不阻断交互
  async function safeSave(data, action, detail) {
    if (!store.hasDir()) return;
    try { await store.logAndSave(data, action, detail); }
    catch (e) { utils.toast('保存失败（只读模式？）：' + e.message); }
  }

  renderOriginal();
  renderItems();
  compose();
}
