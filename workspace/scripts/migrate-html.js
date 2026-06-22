// workspace/scripts/migrate-html.js
// 把 output/review-*.html 批量迁移成 workspace/data/*.json
// 用法: node workspace/scripts/migrate-html.js [文件1.html 文件2.html ...]
//       不带参数则迁移 output/ 下所有 review-*.html
// 迁移规则：title 取文件名（去 review- 前缀和 .html）；stage=review；decisions/output 空；design.shots 空
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'output');
const DATA_DIR = path.join(ROOT, 'workspace', 'data');
const INDEX = path.join(DATA_DIR, 'index.json');

function parseReviewData(html) {
  // 先去掉 /* */ 块注释（注释里有 var REVIEW_DATA 的格式说明，会干扰匹配）
  const cleaned = html.replace(/\/\*[\s\S]*?\*\//g, '');
  // REVIEW_DATA 以顶格的 }; 结尾（items 内部的 } 都带缩进，不会误匹配）
  const m = cleaned.match(/var\s+REVIEW_DATA\s*=\s*(\{[\s\S]*\n\})\s*;/);
  if (!m) throw new Error('未找到 REVIEW_DATA');
  // REVIEW_DATA 是合法 JS 对象字面量，用 Function 求值
  return new Function('return ' + m[1])();
}

function titleFromFile(fname) {
  // review-吃苦卖命.html → 吃苦卖命
  return fname.replace(/^review-/, '').replace(/\.html$/i, '');
}

function buildWorkspaceJson(rd, title) {
  const now = new Date().toISOString();
  return {
    meta: { title, created: now, updated: now, stage: 'review', operator: 'script-review' },
    review: {
      platform: rd.platform || '',
      verdict: rd.verdict || '',
      original: rd.original || '',
      splitOriginal: rd.splitOriginal || '',
      items: rd.items || [],
      decisions: {},
      output: ''
    },
    design: { shots: [] },
    changelog: [{ ts: now, who: 'script-review', action: 'migrated', detail: '从旧 review-*.html 迁移' }]
  };
}

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); }
  catch { return { projects: [] }; }
}

function saveIndex(idx) {
  fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2), 'utf8');
}

function summary(data) {
  return {
    title: data.meta.title,
    stage: data.meta.stage,
    updated: data.meta.updated,
    shotCount: data.design.shots.length,
    reviewItemCount: data.review.items.length
  };
}

// 校验 items[].original 是 original 的子串
function validate(data) {
  const bad = [];
  (data.review.items || []).forEach(it => {
    if (it.original && !data.review.original.includes(it.original)) {
      bad.push(`  id=${it.id} 「${it.original}」非 original 子串`);
    }
  });
  return bad;
}

function main() {
  const args = process.argv.slice(2);
  let files;
  if (args.length) {
    files = args.map(f => path.isAbsolute(f) ? f : path.join(ROOT, f));
  } else {
    files = fs.readdirSync(OUT_DIR)
      .filter(f => /^review-.*\.html$/i.test(f))
      .map(f => path.join(OUT_DIR, f));
  }

  if (!files.length) {
    console.log('没有找到 review-*.html 文件');
    return;
  }

  const idx = loadIndex();

  files.forEach(f => {
    const fname = path.basename(f);
    const html = fs.readFileSync(f, 'utf8');
    try {
      const rd = parseReviewData(html);
      const title = titleFromFile(fname);
      const data = buildWorkspaceJson(rd, title);
      const bad = validate(data);
      if (bad.length) {
        console.warn('⚠ ' + title + ' 子串校验未通过（工作台高亮会错位）：');
        bad.forEach(b => console.warn(b));
      }
      const outPath = path.join(DATA_DIR, title + '.json');
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
      // 更新 index
      const sum = summary(data);
      const i = idx.projects.findIndex(p => p.title === title);
      if (i >= 0) idx.projects[i] = sum; else idx.projects.push(sum);
      console.log('✓ ' + title + ' → ' + path.relative(ROOT, outPath) + '（items=' + data.review.items.length + '）' + (bad.length ? ' [有子串警告]' : ''));
    } catch (e) {
      console.error('✗ ' + fname + '：' + e.message);
    }
  });

  saveIndex(idx);
  console.log('\n已更新 index.json，共 ' + idx.projects.length + ' 个项目');
}

main();
