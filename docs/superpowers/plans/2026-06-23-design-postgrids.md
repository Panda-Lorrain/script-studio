# 画面设计台 · 后期元素/转场/时机重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把设计台每镜的「后期」从 5 个固定单值格，重构成「可多条的元素列表 + 多轨口播文字轴设时机 + 镜间转场槽」。

**Architecture:** 数据层在 `store.migrateData` 里把旧 flat 的 `post`/`timing` 一次性迁移成 `post` 元素数组 + 独立 `trans`，并用 `design.schemaVer` 标记；`design.js` 重构渲染（元素列表、多轨轴、转场槽）与交互（增删、拖/点设 `range`）；`design.css` 配套样式与手机端横向滚动；`export.js` 的 `exportCutGuide` 适配新结构、`mergeData` 适配数组化 `post`。

**Tech Stack:** 纯前端 ES Modules，无构建/无 npm/无测试框架（见 CLAUDE.md）。验证靠浏览器手测 + console 断言 + 旧数据迁移回归，**不引入测试栈**。

**Spec:** `docs/superpowers/specs/2026-06-23-design-postgrids-design.md`

**数据契约（最终态，所有任务以此为准）:**
```js
shot = {
  no, line, subtitle,
  subject: { type, assetIds, refs, prompt },
  post: [ { kind:'text'|'sticker'|'fx'|'anim', content:string, range:[start,end]|null, note:string } ],
  trans: string | null,           // 本镜→下一镜；末镜恒 null
  audio: {bgm,sfx,voice,voiceFx},  // 不动
  audioTiming: {bgm,sfx,voice,voiceFx}  // 不动
  // 旧 timing 字段迁移后删除（内容并入各元素 note）
}
design.schemaVer = 2
```

---

## Task 1: 数据迁移 + 后期元素列表渲染 + CRUD

把迁移和渲染作为**一次原子改动**（迁移把 `post` 变数组，旧渲染会崩，必须配套），先实现「多条元素」、时机暂全 `null`（跟镜）、转场数据保留但暂不渲染（Task 4 做）。

**Files:**
- Modify: `workspace/js/store.js:182-191`（`migrateData` 扩展）
- Modify: `workspace/js/design.js:7,68-85,155-244`（`POST` 去 `trans`、input 处理、`shotHTML` 后期区重构）
- Modify: `workspace/css/design.css:47-52`（`.post` grid → 列表）

- [ ] **Step 1: 扩展 `store.migrateData`，迁移 flat → 数组 + trans + schemaVer**

打开 `workspace/js/store.js`，把 `migrateData`（约 182 行）整段替换为：

```js
// 向后兼容迁移：
//  ① 旧 shot.subject.assetId(单值) → assetIds(数组)
//  ② 旧 flat post/timing 单值格 → post 元素数组 + 独立 trans（design.schemaVer=2）
function migrateData(data) {
  const shots = (data.design && data.design.shots) || [];
  const last = shots.length - 1;
  shots.forEach((s, i) => {
    if (s.subject && !Array.isArray(s.subject.assetIds)) {
      s.subject.assetIds = s.subject.assetId ? [s.subject.assetId] : [];
      delete s.subject.assetId;
    }
    if (!Array.isArray(s.post)) {
      const oldPost = s.post || {};
      const oldTiming = s.timing || {};
      const KINDS = ['text', 'sticker', 'fx', 'anim'];
      const post = [];
      KINDS.forEach(k => {
        if (oldPost[k]) post.push({ kind: k, content: oldPost[k], range: null, note: oldTiming[k] || '' });
      });
      s.post = post;
      // trans：本镜→下一镜；末镜无下一镜→丢弃；空串归一为 null
      let tr = oldPost.trans;
      s.trans = (i < last && tr) ? tr : null;
      delete s.timing;  // 已并入各元素 note，删除免混淆
    }
  });
  if (data.design) data.design.schemaVer = 2;
  return data;
}
```

- [ ] **Step 2: console 验证迁移正确**

`python workspace/server.py` 起服务，浏览器开 `http://localhost:8080/workspace/`，进任一篇有旧数据的文案（如「吃苦卖命」），DevTools console 跑：

```js
// 旧数据已通过 loadProject→migrateData 自动迁移并缓存，直接读缓存验证
const d = await (await import('./js/store.js')).loadProject('吃苦卖命');
const s = d.design.shots[0];
console.log('schemaVer', d.design.schemaVer);              // 期望 2
console.log('post 是数组', Array.isArray(s.post));          // 期望 true
console.log('post 样例', s.post);                           // 期望 [{kind,content,range:null,note}]
console.log('trans', s.trans, '(末镜应 null)');             // 末镜期望 null
console.log('timing 已删', s.timing === undefined);        // 期望 true
console.log('audio 仍在', s.audio !== undefined);          // 期望 true
```

期望：`schemaVer=2`、`post` 是数组、`timing` 已删、`audio` 仍在、末镜 `trans=null`。**此时页面后期区会渲染异常（旧 `shotHTML` 还在读 `s.post[k]`）——下一步修。**

- [ ] **Step 3: `design.js` —— `POST` 去 `trans`、加常量与标签**

打开 `workspace/js/design.js`，第 7 行替换为（`trans` 移出，单独管理）：

```js
const POST_KINDS = [['text', '文字'], ['sticker', '贴纸'], ['fx', '特效'], ['anim', '动画']];
const TRANS_PRESETS = ['', '淡入淡出', '黑场', '白场', '缩放', '滑动', '运镜', '闪白', '无缝'];
const AUDIO = [['bgm', '背景音乐'], ['sfx', '音效'], ['voice', '口播'], ['voiceFx', '变声']];
```

- [ ] **Step 4: `design.js` —— 替换 input 事件处理，支持元素 content 编辑**

把 `shotsEl.addEventListener('input', ...)`（约 68-85 行）整段替换为：

```js
  shotsEl.addEventListener('input', e => {
    const el = e.target;
    if (el.classList.contains('auto-grow')) autoGrow(el);
    const i = el.dataset.i, k = el.dataset.k;
    if (i === undefined) return;
    const s = design.shots[+i];
    if (!s) return;
    const v = el.value;
    if (k === 'subtitle') s.subtitle = v;
    else if (k === 'prompt') s.subject.prompt = v;
    else if (k && k.startsWith('postc.')) {            // 元素 content：postc.<元素下标>
      const idx = +k.slice(6);
      if (s.post[idx]) s.post[idx].content = v;
    }
    else if (k && k.startsWith('audio.')) s.audio[k.slice(6)] = v;
    else if (k && k.startsWith('audioTiming.')) s.audioTiming[k.slice(12)] = v;
    s.lastBy = store.getOperator();
    s.lastTs = utils.nowIso();
    debounceSave(data);
  });
```

- [ ] **Step 5: `design.js` —— 加元素增删全局函数**

在 `window.__designRemoveLib`（约 140 行）之后、`let saveTimer`（约 142 行）之前，插入：

```js
  window.__designAddPost = (i, kind) => {
    design.shots[i].post.push({ kind, content: '', range: null, note: '' });
    design.shots[i].lastBy = store.getOperator();
    design.shots[i].lastTs = utils.nowIso();
    renderShots();
    safeSave(data, 'design_edit', `第${i + 1}镜加${kind}`);
  };
  window.__designDelPost = (i, idx) => {
    design.shots[i].post.splice(idx, 1);
    design.shots[i].lastBy = store.getOperator();
    design.shots[i].lastTs = utils.nowIso();
    renderShots();
    safeSave(data, 'design_edit', `第${i + 1}镜删后期元素`);
  };
```

- [ ] **Step 6: `design.js` —— 重构 `shotHTML` 的后期区为元素列表**

把 `shotHTML` 里「✂️ 剪映后期」那个 `<div class="field">`（约 221-226 行，含 `POST.map(...)` 那段）整段替换为：

```js
      <div class="field">
        <div class="field-label">✂️ 剪映后期（在剪映里加）</div>
        <div class="post-list">
          ${s.post.map((el, idx) => `
            <div class="post-item">
              <span class="post-kind k-${el.kind}">${(POST_KINDS.find(p => p[0] === el.kind) || ['', '?'])[1]}</span>
              <input class="inp post-content" placeholder="内容" value="${utils.escAttr(el.content)}" data-i="${i}" data-k="postc.${idx}">
              <span class="post-range-tag" title="${utils.escAttr(el.note ? '原时机备注：' + el.note : '')}">${el.range ? '⏱已设' : '⏱跟镜'}${el.note ? '·有备注' : ''}</span>
              <span class="post-x" onclick="window.__designDelPost(${i},${idx})" title="删除">×</span>
            </div>`).join('')}
          <div class="post-add">
            ${POST_KINDS.map(([k, l]) => `<button class="post-add-btn" onclick="window.__designAddPost(${i},'${k}')">＋${l}</button>`).join('')}
          </div>
        </div>
      </div>
```

> 说明：此步不渲染口播轴（Task 3）、不渲染转场槽（Task 4）。`post-range-tag` 此步只显示静态文字；`range` 编辑在 Task 3 接上。旧 `timing` 的内容已迁移进 `el.note`，通过 `title` 悬停可见，不丢。

- [ ] **Step 7: `design.css` —— 列表样式**

打开 `workspace/css/design.css`，把 `.post { ... }` 与 `.cell` 相关行（47-52 行）替换为：

```css
.post-list { display: flex; flex-direction: column; gap: 7px; }
.post-item { display: flex; align-items: center; gap: 7px; }
.post-kind { font-size: 11px; font-weight: 700; color: #fff; border-radius: 5px; padding: 3px 8px; flex-shrink: 0; min-width: 38px; text-align: center; }
.post-kind.k-text { background: var(--accent); }
.post-kind.k-sticker { background: #ec6bad; }
.post-kind.k-fx { background: #8b5cf6; }
.post-kind.k-anim { background: #f59e0b; }
.post-item .post-content { flex: 1; font-size: 13px; padding: 5px 9px; }
.post-range-tag { font-size: 11px; color: var(--muted); flex-shrink: 0; cursor: default; white-space: nowrap; }
.post-x { color: var(--muted); cursor: pointer; font-size: 16px; padding: 0 3px; flex-shrink: 0; }
.post-x:hover { color: #e23; }
.post-add { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.post-add-btn { border: 1px dashed var(--border); background: var(--bg); color: var(--muted); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
.post-add-btn:hover { border-color: var(--accent); color: var(--accent); }
.audio { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cell { display: flex; flex-direction: column; gap: 4px; }
.cell label { font-size: 11px; color: var(--muted); font-weight: 600; }
.cell .inp { font-size: 13px; padding: 5px 8px; }
.cell .timing { color: var(--accent); font-size: 12px; border-color: #dbe4ff; background: #fbfcff; }
```

- [ ] **Step 8: 浏览器手测**

刷新设计台。验证：
1. 旧数据迁移后正常显示，每条旧后期内容显示为列表项、`⏱跟镜·有备注`（悬停见旧 timing 文字）。
2. 点「＋文字/贴纸/特效/动画」新增一条，能编辑内容、`×` 删除。
3. 多条文字共存（解决「多文本加不进去」）。
4. 刷新后数据持久化（FSA 写盘）。
5. 音频四格不变。

- [ ] **Step 9: Commit**

```bash
git add workspace/js/store.js workspace/js/design.js workspace/css/design.css
git commit -m "feat(design): 后期元素 flat 格 → 可多条元素列表 + 数据迁移"
```

---

## Task 2: `mergeData` 适配数组化 `post`

`export.mergeData`（合并多篇）原按 `post`/`timing` 是 flat 对象合并，`post` 变数组后会崩。改为按元素数组合并。

**Files:**
- Modify: `workspace/js/export.js:47-53`

- [ ] **Step 1: 替换合并逻辑**

打开 `workspace/js/export.js`，把 `['post','timing','audio','audioTiming'].forEach(...)`（47-53 行）整段替换为：

```js
    // post：新结构是元素数组；按「内容相等」去重并入（base 没有的元素补进来）
    const iPost = Array.isArray(iShots[i].post) ? iShots[i].post : [];
    const bPost = Array.isArray(bShots[i].post) ? bShots[i].post : (bShots[i].post = []);
    iPost.forEach(pe => {
      if (!bPost.some(be => be.kind === pe.kind && be.content === pe.content && JSON.stringify(be.range) === JSON.stringify(pe.range))) {
        bPost.push(JSON.parse(JSON.stringify(pe)));
      }
    });
    // trans：base 空才取 incoming
    if (iShots[i].trans && !bShots[i].trans) bShots[i].trans = iShots[i].trans;
    // audio / audioTiming：结构未变，按字段补空
    ['audio', 'audioTiming'].forEach(field => {
      if (iShots[i][field]) {
        Object.keys(iShots[i][field]).forEach(k => {
          if (iShots[i][field][k] && !bShots[i][field][k]) bShots[i][field][k] = iShots[i][field][k];
        });
      }
    });
```

- [ ] **Step 2: 手测合并不崩**

console 构造两个 data 手动跑 `mergeData`，确认不抛错、元素被并入：

```js
const { mergeData } = await import('./js/export.js');
const base = { design:{ shots:[ {line:'A', subject:{}, post:[{kind:'text',content:'x',range:null,note:''}], trans:null, audio:{}, audioTiming:{}} ] }, changelog:[] };
const inc  = { design:{ shots:[ {line:'A', subject:{}, post:[{kind:'fx',content:'y',range:null,note:''}], trans:'淡入淡出', audio:{}, audioTiming:{}} ] }, changelog:[] };
const r = mergeData(base, inc);
console.log(r.merged.design.shots[0].post.length, r.conflicts);  // 期望 2 []
```

期望：`post.length=2`、`conflicts=[]`、不抛异常。

- [ ] **Step 3: Commit**

```bash
git add workspace/js/export.js
git commit -m "fix(design): mergeData 适配 post 数组化 + 独立 trans"
```

---

## Task 3: 口播文字轴 + 时机（range）编辑

在元素列表基础上，加多轨口播文字轴：拖条段 / 点口播字设进/出 / 双击跟镜。`range = [startChar, endChar)` 基于 `shot.line`，`null` = 跟镜。

**Files:**
- Modify: `workspace/js/design.js`（`shotHTML` 加轴渲染、新增交互函数）
- Modify: `workspace/css/design.css`（轴样式）

- [ ] **Step 1: `design.js` —— 在 `shotHTML` 后期 `<div class="field">` 内、`</div>` 结束前插入轴**

定位 Task 1 Step 6 插入的 `.post-list` 容器之后（仍在「✂️ 剪映后期」field 内），追加轴 HTML。把该 field 的内容改为（在 `.post-list` 的 `</div>` 之后加）：

```js
        ${renderAxis(s, i)}
```

并在 `design.js` 文件内（`shotHTML` 函数之前）新增辅助函数：

```js
  // 口播文字轴：line 按字切块；每条 post 元素一轨，range 映射成 % 条段
  function renderAxis(s, i) {
    const line = s.line || '';
    if (!line) return '';                       // 口播空→不渲染轴
    const words = [...line];                    // 按 Unicode 码点切字（中文友好）
    const len = words.length;
    const bars = s.post.map((el, idx) => {
      if (el.range == null) return '';          // 跟镜：不画条段（跟镜=铺满，用浅底轨道表示）
      const [a, b] = el.range;
      const left = (Math.max(0, a) / len * 100).toFixed(2);
      const width = (Math.min(len, b) - Math.max(0, a)) / len * 100;
      return `<div class="seg-bar k-${el.kind}" style="left:${left}%;width:${width}%" data-i="${i}" data-idx="${idx}" title="拖两端改区间·双击跟镜"></div>`;
    }).join('');
    const wordSpans = words.map((w, ci) => `<span class="w" data-i="${i}" data-c="${ci}">${utils.esc(w)}</span>`).join('');
    const tracks = s.post.map((el, idx) => {
      const full = el.range == null ? ' full' : '';   // 跟镜轨道铺满浅底
      return `<div class="track${full}" data-i="${i}" data-idx="${idx}"></div>`;
    }).join('');
    return `
      <div class="axis" data-i="${i}">
        <div class="axis-cap">口播文字轴（拖条段·点字设进/出·双击跟镜）</div>
        <div class="track track-line">${wordSpans}</div>
        ${tracks}
        <div class="bars">${bars}</div>
      </div>`;
  }
```

> 结构：`.track-line` 是可点字块的上轨；每个元素一条 `.track`（跟镜的加 `.full` 浅底铺满）；`.bars` 绝对定位叠放条段（与轨道等高对齐，靠 CSS 网格行对应）。点字/拖条段通过 data 属性定位。

- [ ] **Step 2: `design.js` —— 选中端状态 + 点字设端**

在 `renderShots`（约 155 行）之后新增轴交互绑定函数，并在 `renderShots()` 调用处（243 行 `renderShots();`）改为 `renderShots(); bindAxis();`：

```js
  // 轴交互：每个 .axis 维护一个「当前选中元素 + 选中端('a'|'b')」状态，存 dataset
  function bindAxis() {
    shotsEl.querySelectorAll('.axis').forEach(axis => {
      if (axis.dataset.bound) return;
      axis.dataset.bound = '1';
      // 点口播字：把当前选中端设到该字
      axis.querySelectorAll('.w').forEach(w => {
        w.addEventListener('click', () => {
          const i = +axis.dataset.i;
          const idx = axis.dataset.selIdx;
          if (idx == null) { utils.toast('先点一条元素的条段选中它'); return; }
          const end = axis.dataset.selEnd || 'a';
          const s = design.shots[i];
          const el = s.post[+idx];
          if (!el) return;
          const c = +w.dataset.c;
          if (el.range == null) el.range = [c, c + 1];
          if (end === 'a') el.range = [c, Math.max(c + 1, el.range[1])];
          else el.range = [Math.min(el.range[0], c), c + 1];
          if (el.range[0] >= el.range[1]) el.range = [el.range[0], el.range[0] + 1];
          s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
          renderShots(); bindAxis(); debounceSave(data);
        });
      });
      // 点条段：选中该元素+进端
      axis.querySelectorAll('.seg-bar').forEach(bar => {
        bar.addEventListener('click', e => e.stopPropagation());
        bar.addEventListener('mousedown', e => startDrag(axis, bar, e));
        bar.addEventListener('dblclick', e => { e.preventDefault(); resetRange(axis, bar); });
      });
    });
  }
  function resetRange(axis, bar) {
    const i = +axis.dataset.i, idx = +bar.dataset.idx;
    const s = design.shots[i];
    s.post[idx].range = null;
    s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
    renderShots(); bindAxis(); debounceSave(data);
  }
```

- [ ] **Step 3: `design.js` —— 拖拽条段两端改 range（含选中端切换）**

紧接 Step 2 之后新增拖拽实现：

```js
  function startDrag(axis, bar, ev) {
    ev.preventDefault();
    const i = +axis.dataset.i, idx = +bar.dataset.idx;
    axis.dataset.selIdx = idx; axis.dataset.selEnd = 'a';
    const s = design.shots[i], el = s.post[idx];
    const line = s.line || '';
    const len = [...line].length;
    if (el.range == null) el.range = [0, len];   // 跟镜→先铺满再拖
    const axisRect = axis.getBoundingClientRect();
    const charAt = (clientX) => {
      const ratio = Math.min(1, Math.max(0, (clientX - axisRect.left) / axisRect.width));
      return Math.round(ratio * len);
    };
    let dragEnd = null;   // 'a' | 'b'，由离哪端近决定
    const onMove = (e) => {
      const x = e.clientX;
      // 首次 move 决定拖哪端（离进/出端近的）
      if (dragEnd == null) {
        const aPx = axisRect.left + (el.range[0] / len) * axisRect.width;
        const bPx = axisRect.left + (el.range[1] / len) * axisRect.width;
        dragEnd = Math.abs(x - aPx) <= Math.abs(x - bPx) ? 'a' : 'b';
        axis.dataset.selEnd = dragEnd;
      }
      const c = charAt(x);
      if (dragEnd === 'a') el.range = [Math.min(c, el.range[1] - 1), el.range[1]];
      else el.range = [el.range[0], Math.max(c, el.range[0] + 1)];
      // 实时刷条段位置（不整页 renderShots，免丢拖拽）
      const left = (el.range[0] / len * 100).toFixed(2);
      const width = ((el.range[1] - el.range[0]) / len * 100).toFixed(2);
      bar.style.left = left + '%'; bar.style.width = width + '%';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
      renderShots(); bindAxis(); debounceSave(data);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
```

- [ ] **Step 4: `design.css` —— 轴样式**

在 `design.css`（Task 1 Step 7 追加的内容之后）加：

```css
.axis { margin-top: 10px; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.axis-cap { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
.axis .track { position: relative; height: 16px; border-radius: 4px; margin-bottom: 4px; background: #fff; border: 1px solid var(--border); }
.axis .track.full { background: #eef0f3; }                       /* 跟镜轨道：浅底铺满 */
.axis .track-line { height: auto; padding: 4px 6px; line-height: 1.8; background: #fff; word-break: break-all; }
.axis .track-line .w { display: inline; padding: 1px 0; cursor: pointer; border-radius: 3px; }
.axis .track-line .w:hover { background: #fff3bf; }
.axis .bars { position: relative; }
.axis .bars .seg-bar { position: absolute; height: 16px; border-radius: 4px; cursor: ew-resize; opacity: .85; margin-bottom: 4px; }
/* 条段纵向对齐各轨道：用 CSS 变量错开；简单起见靠 margin-top 叠层，按 DOM 顺序 = 轨道顺序 */
.axis .bars .seg-bar.k-text { background: var(--accent); }
.axis .bars .seg-bar.k-sticker { background: #ec6bad; }
.axis .bars .seg-bar.k-fx { background: #8b5cf6; }
.axis .bars .seg-bar.k-anim { background: #f59e0b; }
```

> 条段纵向定位说明：`.bars` 内 `.seg-bar` 按 DOM 顺序对应轨道顺序，每个条段 `margin-top` 需随其元素下标递增（`(idx+1)*(16+4)px`，+1 是跳过 track-line 行）。Step 5 补这条内联样式。

- [ ] **Step 5: `design.js` —— 条段纵向对齐（补内联 top）**

回到 Step 1 的 `renderAxis`，把 `bars` 的 `style` 由 `left/width` 扩展加 `top`：

```js
      const top = (idx + 1) * 20;   // 跳过 track-line 那一行
      return `<div class="seg-bar k-${el.kind}" style="left:${left}%;width:${width}%;top:${top}px" data-i="${i}" data-idx="${idx}" title="拖两端改区间·双击跟镜"></div>`;
```

- [ ] **Step 6: 浏览器手测**

刷新。验证：
1. 有口播的镜显示轴；口播字块可点。
2. 加一条文字 → 默认跟镜（浅底铺满轨道，无条段）。
3. 拖出新条段：在跟镜轨道上 mousedown 拖动，出现条段，拖两端改区间，松手持久化。
4. 点口播字：先点条段选中，再点字，进/出端跳到该字。
5. 双击条段 → 重置跟镜。
6. 多条元素各占一轨、条段颜色按类区分。
7. `post-range-tag`（列表项）显示 `⏱已设` / `⏱跟镜`（若 Task 1 的 tag 没随 range 实时更新，本步在 renderShots 后已重渲，自然正确）。

- [ ] **Step 7: Commit**

```bash
git add workspace/js/design.js workspace/css/design.css
git commit -m "feat(design): 多轨口播文字轴·拖条段/点字设 range 时机"
```

---

## Task 4: 转场镜间槽

`trans` 从后期元素剥离，渲染成镜卡之间的独立槽（N 镜 → N−1 槽，末镜后无槽）。无 `range`、无时机。

**Files:**
- Modify: `workspace/js/design.js:155-159`（`renderShots` 在镜卡之间插转场槽）
- Modify: `workspace/css/design.css`（转场槽样式）

- [ ] **Step 1: `design.js` —— `renderShots` 在相邻镜之间插转场槽**

把 `renderShots`（约 155-159 行）替换为：

```js
  function renderShots() {
    const html = design.shots.map((s, i) => {
      const card = shotHTML(s, i, assets);
      const trans = (i < design.shots.length - 1) ? transHTML(s, i) : '';  // 末镜后无槽
      return card + trans;
    }).join('');
    shotsEl.innerHTML = html;
    shotsEl.querySelectorAll('.auto-grow').forEach(autoGrow);
    updateSummary();
    bindAxis();
  }
  function transHTML(s, i) {
    const cur = s.trans || '';
    const opts = TRANS_PRESETS.map(p => `<option value="${utils.escAttr(p)}"${p === cur ? ' selected' : ''}>${p || '（无转场）'}</option>`).join('');
    return `<div class="trans-slot"><span class="trans-arrow">▶</span><label>转场到第 ${i + 2} 镜</label><select class="inp trans-select" data-i="${i}">${opts}</select></div>`;
  }
```

- [ ] **Step 2: `design.js` —— 转场 select 变更处理**

在 `shotsEl.addEventListener('input', ...)` 内（Task 1 Step 4 替换的那段），在 `audioTiming` 分支后再加一条（注意 select 触发的是 `change` 不是 `input`，单独绑）：

```js
  shotsEl.addEventListener('change', e => {
    const el = e.target;
    if (!el.classList.contains('trans-select')) return;
    const i = +el.dataset.i;
    const s = design.shots[i];
    s.trans = el.value || null;
    s.lastBy = store.getOperator(); s.lastTs = utils.nowIso();
    debounceSave(data);
  });
```

- [ ] **Step 3: `design.css` —— 转场槽样式**

在 `design.css` 加：

```css
.trans-slot { display: flex; align-items: center; gap: 8px; justify-content: center; padding: 6px 12px; margin: -2px 0; }
.trans-slot .trans-arrow { color: var(--accent); font-size: 14px; }
.trans-slot label { font-size: 12px; color: var(--muted); white-space: nowrap; }
.trans-slot .trans-select { width: auto; max-width: 180px; font-size: 13px; padding: 4px 8px; }
```

- [ ] **Step 4: 浏览器手测**

刷新。验证：
1. 每两块镜卡之间出现「▶ 转场到第 N 镜 [下拉]」。
2. 末镜之后**无**转场槽。
3. 下拉选转场、刷新后持久化。
4. 旧数据迁移来的 `trans` 正确显示在对应镜间槽。

- [ ] **Step 5: Commit**

```bash
git add workspace/js/design.js workspace/css/design.css
git commit -m "feat(design): 转场剥离为镜间槽（N-1个，末镜无槽）"
```

---

## Task 5: `exportCutGuide` 适配新结构

后期区按 `post` 元素列表导出，`range` 翻译成口播文本片段，`trans` 单列。

**Files:**
- Modify: `workspace/js/export.js:80-104`（`exportCutGuide`）

- [ ] **Step 1: 替换 `exportCutGuide`**

打开 `workspace/js/export.js`，把 `exportCutGuide`（81-104 行）整段替换为：

```js
export function exportCutGuide(data) {
  const lines = data.design.shots.map((s, i) => {
    const t = s.subject.type;
    let pic;
    if (t === 'lib') pic = `选库 ${(s.subject.assetIds || []).join('、')}`;
    else if (t === 'ai') pic = `AI生成（待生）`;
    else pic = `未定`;
    const sub = s.subtitle || '（同口播/不打）';
    const post = (Array.isArray(s.post) ? s.post : []).map(el => {
      const label = { text: '文字', sticker: '贴纸', fx: '特效', anim: '动画' }[el.kind] || el.kind;
      const tm = rangeToText(s.line, el.range);
      const note = el.note ? `（原：${el.note}）` : '';
      return `${label}「${el.content}」${tm}${note}`;
    }).join('  ');
    const a = AUDIO.map(([k, l]) => {
      if (!s.audio || !s.audio[k]) return '';
      const tm = (s.audioTiming && s.audioTiming[k]) ? `（念到"${s.audioTiming[k]}"时）` : '';
      return `${l}:${s.audio[k]}${tm}`;
    }).filter(Boolean).join('  ');
    const isLast = i === data.design.shots.length - 1;
    const trans = (!isLast && s.trans) ? `\n  转场到第${i + 2}镜：${s.trans}` : '';
    return `【${String(i + 1).padStart(2, '0')}】${s.line}\n  画面：${pic} ｜ 字幕：${sub}\n  ${post ? '后期：' + post : '（后期空）'}${a ? '\n  音频：' + a : ''}${trans}`;
  });
  const txt = `剪辑指引 · ${data.meta.title} · 共 ${data.design.shots.length} 镜\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
  utils.download(`剪辑指引-${data.meta.title}.txt`, txt);
  utils.toast('已导出剪辑指引');
}

// range（基于 line 的字符区间）→ 人话时机描述
function rangeToText(line, range) {
  if (!line || range == null) return '（跟镜·全程）';
  const chars = [...line];
  const a = Math.max(0, range[0]), b = Math.min(chars.length, range[1]);
  if (a >= b) return '（跟镜·全程）';
  const seg = chars.slice(a, b).join('');
  // 进出点用相邻字示意
  const inW = chars[a] || '';
  const outW = chars[b - 1] || '';
  return `（念到"${inW}"出现→"${outW}"消失）`;
}
```

- [ ] **Step 2: 手测导出**

点「🎬 剪辑指引」导出 txt，打开核对：
1. 跟镜元素 → `（跟镜·全程）`。
2. 已设 range 元素 → `（念到"X"出现→"Y"消失）`。
3. 有 note → 附 `（原：旧timing文字）`。
4. 转场单列 `转场到第N镜：淡入淡出`，末镜无此行。
5. 音频不变。

- [ ] **Step 3: Commit**

```bash
git add workspace/js/export.js
git commit -m "feat(design): 剪辑指引导出适配元素列表+range翻译+转场单列"
```

---

## Task 6: 全链路回归 + 手机端横向滚动

确认旧数据迁移、编辑、导出全链路通；手机端轴横向可滚。

**Files:**
- Modify: `workspace/css/design.css`（`@media (max-width:768px)` 块补轴横向滚动）

- [ ] **Step 1: 旧数据迁移回归**

`吃苦卖命.json`（旧 flat）加载后，逐镜核对：`post` 列表项数 = 旧非空格数；旧 `timing` 文字进 `note`（悬停 tag 可见 / 导出附「原：」）；`trans` 在镜间槽显示；末镜无转场槽。console 再跑 Task 1 Step 2 的断言确认 `schemaVer=2`。

- [ ] **Step 2: 新建空项目回归**

工作台新建一篇 → 审核台生成分镜 → 设计台：加多条文字/特效、拖轴设时机、配转场 → 导出生图清单（不受影响）+ 剪辑指引（格式正确）→ 刷新数据持久。

- [ ] **Step 3: `design.css` —— 手机端轴横向滚动**

在 `@media (max-width: 768px)` 块（63-77 行）内追加：

```css
  .axis { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .axis .track-line { white-space: nowrap; min-width: max-content; }
  .axis .bars { min-width: max-content; }
  .post-list { gap: 8px; }
```

- [ ] **Step 4: 手机端手测**

浏览器 DevTools 切手机视口（或真机）。验证：镜卡横向轮播不变；后期列表、转场槽正常；口播轴可横向滚动、字块可点。

- [ ] **Step 5: Commit**

```bash
git add workspace/css/design.css
git commit -m "fix(design): 手机端口播轴横向滚动 + 回归验证"
```

---

## Self-Review（写计划后自检）

- **Spec 覆盖**：① 多条元素 → Task 1；② 时机口播轴 + 默认跟镜 → Task 3；③ 转场镜间槽 N−1 → Task 4；④ 旧数据迁移 → Task 1 Step 1-2；⑤ 导出适配 → Task 5；⑥ 音频不动 → 各 Task 均未碰 audio/audioTiming 渲染与合并字段；⑦ 手机端 → Task 6 Step 3。✓ 全覆盖。
- **placeholder 扫描**：无 TBD/TODO；每个代码步都给了完整可粘贴代码。✓
- **类型/命名一致**：`POST_KINDS`（design.js 与 export.js 的 label 映射一致：text/sticker/fx/anim）；元素字段 `kind/content/range/note` 全程一致；`trans`、`schemaVer`、`renderAxis/bindAxis/startDrag/resetRange/rangeToText/transHTML` 前后引用一致。✓
- **关键风险已处理**：迁移与渲染配套（Task 1 原子）；`mergeData` 同步适配（Task 2），避免合并崩。
