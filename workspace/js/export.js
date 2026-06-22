// workspace/js/export.js
import * as store from './store.js';
import * as utils from './utils.js';

const POST = [['text', '文字'], ['sticker', '贴纸'], ['fx', '特效'], ['anim', '动画'], ['trans', '转场']];

/* ---------- 项目 JSON 导出/导入 ---------- */
export async function exportProject(data) {
  const name = (data.meta.title || '项目') + '.json';
  utils.download(name, JSON.stringify(data, null, 2), 'application/json');
  utils.toast('已导出 ' + name);
}

export async function importJSONFile(file) {
  const text = await file.text();
  let data;
  if (file.name.endsWith('.html')) {
    data = parseLegacyReview(text, file.name);
  } else {
    data = JSON.parse(text);
  }
  if (!data.meta || !data.meta.title) throw new Error('JSON 格式不符（缺 meta.title）');
  if (!store.hasDir()) throw new Error('只读模式无法导入，请先「选择工作目录」');
  await store.saveProject(data);
  await store.logAndSave(data, 'imported', `从 ${file.name} 导入`);
  utils.toast('已导入：' + data.meta.title);
}

/* ---------- 合并 ---------- */
export function mergeData(base, incoming) {
  const merged = JSON.parse(JSON.stringify(base));
  const conflicts = [];
  const bShots = merged.design.shots;
  const iShots = incoming.design ? incoming.design.shots : [];
  const maxLen = Math.max(bShots.length, iShots.length);
  for (let i = 0; i < maxLen; i++) {
    if (!iShots[i]) continue;
    if (!bShots[i]) { bShots[i] = iShots[i]; continue; }
    const bSub = bShots[i].subject || {};
    const iSub = iShots[i].subject || {};
    if (iSub.type && !bSub.type) {
      bShots[i].subject = JSON.parse(JSON.stringify(iSub));
    } else if (iSub.type && bSub.type && JSON.stringify(iSub) !== JSON.stringify(bSub)) {
      conflicts.push({ shot: i, base: bSub, incoming: iSub });
    }
    ['post', 'timing'].forEach(field => {
      if (iShots[i][field]) {
        Object.keys(iShots[i][field]).forEach(k => {
          if (iShots[i][field][k] && !bShots[i][field][k]) bShots[i][field][k] = iShots[i][field][k];
        });
      }
    });
  }
  const logKeys = new Set((merged.changelog || []).map(c => c.ts + c.who + c.action));
  (incoming.changelog || []).forEach(c => {
    const key = c.ts + c.who + c.action;
    if (!logKeys.has(key)) { merged.changelog.push(c); logKeys.add(key); }
  });
  return { merged, conflicts };
}

/* ---------- 生图清单 ---------- */
export function exportShotList(data, assets = []) {
  const ai = data.design.shots.filter(s => s.subject.type === 'ai');
  if (!ai.length) { utils.toast('没有 AI 生成的镜'); return; }
  const lines = ai.map(s => {
    const realIdx = data.design.shots.indexOf(s);
    const refs = s.subject.refs.map(id => {
      const a = store.assetById(assets, id);
      return a ? `${a.id}·${a.desc}` : id;
    }).join('、') || '（无）';
    return `【第${String(realIdx + 1).padStart(2, '0')}镜】${s.line}\n  参考图：${refs}\n  提示词：${s.subject.prompt || '（空）'}`;
  });
  const txt = `生图清单 · ${data.meta.title} · 共 ${ai.length} 张待生成\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
  utils.download(`生图清单-${data.meta.title}.txt`, txt);
  utils.toast(`已导出生图清单（${ai.length} 张）`);
}

/* ---------- 剪辑指引 ---------- */
export function exportCutGuide(data) {
  const lines = data.design.shots.map((s, i) => {
    const t = s.subject.type;
    let pic;
    if (t === 'lib') pic = `选库 ${s.subject.assetId}`;
    else if (t === 'ai') pic = `AI生成（待生）`;
    else pic = `未定`;
    const sub = s.subtitle || '（同口播/不打）';
    const p = POST.map(([k, l]) => {
      if (!s.post[k]) return '';
      const tm = s.timing[k] ? `（念到"${s.timing[k]}"时）` : '';
      return `${l}:${s.post[k]}${tm}`;
    }).filter(Boolean).join('  ');
    return `【${String(i + 1).padStart(2, '0')}】${s.line}\n  画面：${pic} ｜ 字幕：${sub}\n  ${p ? '后期：' + p : '（后期空）'}`;
  });
  const txt = `剪辑指引 · ${data.meta.title} · 共 ${data.design.shots.length} 镜\n${'='.repeat(40)}\n\n${lines.join('\n\n')}`;
  utils.download(`剪辑指引-${data.meta.title}.txt`, txt);
  utils.toast('已导出剪辑指引');
}

/* ---------- 旧 HTML 迁移 ---------- */
export function parseLegacyReview(htmlText, fileName) {
  // 先去掉 /* */ 块注释（注释里有 var REVIEW_DATA 的格式说明，会干扰匹配）
  const cleaned = htmlText.replace(/\/\*[\s\S]*?\*\//g, '');
  // REVIEW_DATA 以顶格的 }; 结尾
  const m = cleaned.match(/var\s+REVIEW_DATA\s*=\s*(\{[\s\S]*\n\})\s*;/);
  if (!m) throw new Error('未找到 REVIEW_DATA');
  const rd = new Function('return ' + m[1])();
  const title = fileName
    ? fileName.replace(/^review-/i, '').replace(/\.html$/i, '')
    : (rd.original ? rd.original.slice(0, 12).replace(/[\s\n]/g, '') : '未命名');
  return {
    meta: { title, created: utils.nowIso(), updated: utils.nowIso(), stage: 'review', operator: store.getOperator() },
    review: {
      platform: rd.platform || '', verdict: rd.verdict || '',
      original: rd.original || '', splitOriginal: rd.splitOriginal || '',
      items: rd.items || [], decisions: {}, output: ''
    },
    design: { shots: [] },
    changelog: [{ ts: utils.nowIso(), who: store.getOperator(), action: 'migrated', detail: '从旧 HTML 迁移' }]
  };
}
