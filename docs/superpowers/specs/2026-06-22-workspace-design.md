# Script Studio Workspace 设计规格

> 日期：2026-06-22
> 状态：已自审，待用户审阅
> 作者：lorrain + Claude

## 背景

当前 Script Studio 的工作流是"一篇文案一个自包含 HTML"（`review-*.html`、`storyboard-*.html`），存在以下问题：

1. 模板改动后存量产物全部作废
2. 协作靠文件分发，版本管理混乱
3. 多篇文案无统一入口
4. 审核台和设计台割裂为两个独立文件

目标：将审核台和设计台融合为一个纯前端工作台网站，用 JSON 数据包驱动协作，通过内网穿透共享给团队。

## 约束

- **无构建、无 npm**：延续 Script Studio 静态哲学
- **ES Modules**：浏览器原生 import/export，需要 HTTP 服务器（不支持 file://）
- **纯前端**：无后端、无数据库、无云
- **内网穿透部署**：本地静态服务器 + 穿透工具出 URL

## 已确认的技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 技术栈 | ES Modules + 无构建 | 保持静态哲学，代码能分层 |
| /script-review 产出 | JSON | 不再生成 HTML |
| 多篇管理 | 文件目录扫描 data/ | 简单，文件即数据 |
| 素材管理 | 扫描生成 assets.json | 运行时无需 File System Access API |
| 审核→设计衔接 | 一键推入，同文件 | 数据自动流转 |
| 运营者角色 | 进度总览 + 数据合并/对比 | lorrain 作为平台搭建者和运营者 |

## 目录结构

```
workspace/
├── index.html              ← 唯一入口，<script type="module" src="js/app.js">
├── css/
│   ├── base.css            ← CSS 变量、reset、布局骨架、通用组件
│   ├── review.css          ← 审核面板样式
│   └── design.css          ← 设计面板样式
├── js/
│   ├── app.js              ← 入口：路由 + 视图切换 + 初始化
│   ├── store.js            ← 数据层：加载/保存 JSON、管理 data/ 目录清单
│   ├── review.js           ← 审核模块：渲染审核面板 + 交互
│   ├── design.js           ← 设计模块：渲染设计面板 + 交互
│   ├── picker.js           ← 选图弹窗（审核/设计共用）
│   ├── dashboard.js        ← 进度总览：项目列表 + 状态统计
│   ├── export.js           ← 导入/导出 JSON + 数据合并
│   └── utils.js            ← esc()、toast()、download() 等
├── data/                   ← 每篇文案一个 JSON
│   └── 吃苦卖命.json
├── assets.json             ← 素材清单（scan-assets.py 生成）
└── scripts/
    └── scan-assets.py      ← 扫描 Material Collection 生成 assets.json
```

workspace 目录放在 Script Studio 根目录下，与 `审核台/`、`output/`、`Material Collection/` 同级。

## 数据架构

一篇文案 = 一个 JSON 文件，包含审核+设计两阶段数据、进度、操作记录。

```json
{
  "meta": {
    "title": "吃苦卖命",
    "created": "2026-06-22T10:00:00Z",
    "updated": "2026-06-22T15:30:00Z",
    "stage": "design",
    "operator": "lorrain"
  },
  "review": {
    "platform": "抖音 · 小红书",
    "verdict": "一句话总评",
    "original": "完整原文（保留【角色】【镜头】等标记）",
    "splitOriginal": "断句版本（每句<=10字，按口播节奏切分）",
    "items": [
      {
        "id": 1,
        "level": "high",
        "category": "消极价值观",
        "original": "原文精确子串",
        "suggestion": "改写建议",
        "splitSuggestion": "断句版改写",
        "reason": "原因说明"
      }
    ],
    "decisions": {
      "1": { "adopted": true, "editedSuggestion": "用户编辑后的改写" }
    },
    "output": "审核定稿的最终文案"
  },
  "design": {
    "shots": [
      {
        "line": "口播文案（来自 review.output 断句）",
        "subtitle": "字幕（可空，默认同口播）",
        "subject": {
          "type": "lib|ai|null",
          "assetId": "05",
          "refs": [],
          "prompt": ""
        },
        "post": { "text": "", "sticker": "", "fx": "", "anim": "", "trans": "" },
        "timing": { "text": "", "sticker": "", "fx": "", "anim": "", "trans": "" }
      }
    ]
  },
  "changelog": [
    { "ts": "2026-06-22T10:00:00Z", "who": "lorrain", "action": "created", "detail": "从 script-review 生成" },
    { "ts": "2026-06-22T12:00:00Z", "who": "lorrain", "action": "review_done", "detail": "审核完成，采纳 8 条" },
    { "ts": "2026-06-22T15:30:00Z", "who": "小王", "action": "design_edit", "detail": "设计了 12 镜" }
  ]
}
```

### 字段说明

- `meta.stage`：`review` | `design` | `done`，驱动进度总览
- `review.items`：agent 生成的审核建议，只增不改
- `review.decisions`：用户的采纳/编辑决定，覆盖式更新
- `review.output`：审核定稿文案，由采纳的建议逐条替换原文后拼合
- `review.items[].original`：必须是 `review.original` 的精确子串（indexOf 定位高亮）
- `design.shots[].line`：来自 review.output 按换行拆分
- `design.shots[].subject.type`：`null` 未定 | `lib` 选库 | `ai` AI 生成
- `changelog`：追加式操作记录，每次 save 追加一条

### assets.json 格式

由 `scripts/scan-assets.py` 扫描 Material Collection 生成：

```json
[
  {
    "id": "01",
    "file": "01_全身_哭.png",
    "folder": "01_悲伤",
    "cat": "悲伤",
    "action": "站立哭泣",
    "framing": "全身",
    "state": "流泪",
    "prop": "",
    "desc": "哭"
  }
]
```

字段与现有 storyboard HTML 的 ASSETS 数组一致。

### data/index.json 格式

浏览器无法直接列目录，需要一个索引文件。每次 saveProject 时自动更新。

```json
{
  "projects": [
    {
      "title": "吃苦卖命",
      "stage": "design",
      "updated": "2026-06-22T15:30:00Z",
      "shotCount": 38,
      "reviewItemCount": 12
    }
  ]
}
```

### 操作者身份

首次访问工作台时弹窗要求输入昵称，存入 localStorage。后续所有 changelog 的 `who` 字段自动填入。

```js
// 首次访问
if (!localStorage.getItem('ss_operator')) {
  // 弹窗输入昵称
}
// changelog 追加时
changelog.push({ ts: new Date().toISOString(), who: getOperator(), action, detail });
```

## 模块架构

### 依赖关系

```
app.js
 ├── store.js
 ├── review.js
 ├── design.js
 ├── dashboard.js
 └── export.js

review.js
 └── store.js

design.js
 ├── store.js
 └── picker.js

export.js
 └── store.js

picker.js
 └── store.js
```

### 模块接口

```js
// store.js
export async function loadProjectList()        // 加载 data/index.json 返回项目摘要列表
export async function loadProject(title)       // 加载 data/{title}.json 完整数据
export async function saveProject(title, data) // 保存 JSON + 更新 index.json（自动追加 changelog）
export async function createProject(title)     // 创建空项目 JSON + 更新 index.json
export async function loadAssets()             // 加载 assets.json（带缓存）
export function setOperator(name)              // 设置当前操作者身份（存 localStorage）

// review.js
export function renderReview(data, container)  // 渲染审核面板到 container

// design.js
export function renderDesign(data, container)  // 渲染设计面板到 container

// dashboard.js
export function renderDashboard(projects, container)  // 渲染总览

// export.js
export function importJSON(file) → Promise<data>       // 解析上传的 JSON
export function exportJSON(data, filename)              // 触发下载
export function mergeData(base, incoming) → merged      // 合并逻辑
export function parseLegacyReview(htmlText) → data      // 从旧 HTML 迁移

// picker.js
export function openPicker({ assets, currentId, multi, onSelect })  // 弹出选图

// utils.js
export function esc(s)                         // HTML 转义
export function escAttr(s)                     // 属性值转义
export function toast(msg)                     // 底部提示条
export function download(name, content, type)  // 触发文件下载
```

### 设计原则

- **无全局状态**：模块通过函数参数接收数据，改完调 store.saveProject() 持久化
- **CSS 隔离**：base.css 管骨架，review.css 和 design.css 各管各的样式
- **picker 共享**：选图弹窗独立为模块，审核和设计都可调用

## 路由与导航

### 路由规则

| Hash | 视图 | 说明 |
|------|------|------|
| `#dashboard` | 总览 | 默认页，项目列表+进度统计 |
| `#标题/review` | 审核 | 某篇文案的审核面板 |
| `#标题/design` | 设计 | 某篇文案的设计面板 |

### app.js 核心逻辑

```js
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

async function route() {
  const hash = location.hash.slice(1) || 'dashboard';
  if (hash === 'dashboard') {
    const projects = await store.loadProjectList();
    dashboard.renderDashboard(projects, main);
    return;
  }
  const [title, mode] = hash.split('/');
  const data = await store.loadProject(title);
  if (mode === 'review') review.renderReview(data, main);
  else if (mode === 'design') design.renderDesign(data, main);
}
```

### 界面布局

```
┌─────────────────────────────────────────────────────────────┐
│  🎬 Script Studio                          [lorrain] [导入] │
├──────────┬──────────────────────────────────────────────────┤
│ 侧栏     │  主内容区                                        │
│          │                                                  │
│ 📊 总览  │  ← 根据 hash 渲染不同视图                        │
│          │                                                  │
│ ──────── │  #dashboard → renderDashboard()                 │
│ 📄 吃苦  │  #吃苦卖命/review → renderReview()               │
│   🟡审核 │  #吃苦卖命/design → renderDesign()               │
│ 📄 新文案 │                                                  │
│   🟢设计 │                                                  │
│          │                                                  │
│ [＋新建] │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### 侧栏行为

- 点项目名 → 切换到该项目的当前阶段（meta.stage 决定默认打开 review 还是 design）
- 项目名旁显示阶段标签：🔵审核中 / 🟡设计中 / 🟢已完成
- 「＋新建」→ 弹窗输入标题 → 创建空 JSON → 跳转到审核

### 手机适配

- 侧栏折叠为顶部下拉菜单
- 主内容区全宽
- 保持现有 storyboard 的移动端优化（卡片横向滑动、全屏弹窗等）

## 审核模块

从 `_template.html` 迁移为 ES Module。

### 与现有审核台的差异

| 现有 _template.html | 新 review.js |
|---------------------|-------------|
| `var REVIEW_DATA = {...}` 内联 | 从 store 读取 data.review |
| 全局变量 state/edits | 模块内局部状态 |
| 无保存 | 每次操作调 store.saveProject() |
| 无「推入设计台」按钮 | 新增：审核定稿后一键生成 design.shots |

### 核心功能（从 _template.html 迁移）

- 原文面板：高亮标记问题文案（高危红/中危黄/低危绿）
- 字幕断句切换：原文/断句版本切换
- 问题卡片：按危险程度/文案顺序排序
- 每张卡片：显示级别标签、分类、原文→改写、原因、采纳/保留按钮
- 输出面板：实时拼合修改后的文案，一键复制
- 字幕断句：输出面板也支持断句切换

### 「推入设计台」逻辑

```
用户点「推入设计台」
  → 校验：review.output 非空
  → 用 review.output 按换行拆分
  → 生成 design.shots[]，每行一个 shot
  → shot 的 line = 该行文案，其余字段初始化为空
  → 更新 meta.stage = "design"
  → 追加 changelog: {action: "pushed_to_design"}
  → 保存 → hash 跳转到 #标题/design
```

## 设计模块

从 `storyboard-吃苦卖命.html` 迁移为 ES Module。

### 与现有 storyboard HTML 的差异

| 现有 storyboard HTML | 新 design.js |
|---------------------|-------------|
| const SCRIPT = [...] 硬编码 | 从 data.design.shots[].line 读取 |
| const ASSETS = [...] 硬编码 | 从 store.loadAssets() 读取 |
| exportJSON() 触发下载 | store.saveProject() 原地保存 |
| importJSON() 文件上传 | 不需要（数据在 data/ 目录里） |
| 无操作记录 | 每次保存追加 changelog |

### 核心功能（从 storyboard HTML 迁移）

- 分镜卡片列表：一镜一卡，展示口播、字幕、画面主体、剪映后期
- 画面主体三态：未定 / 选库 / AI 生成
- 选库：弹出 picker.js 选图弹窗，搜索+分类+构图筛选
- AI 生成：参考图（多选）+ 提示词
- 剪映后期五格：文字/贴纸/特效/动画/转场，每格有内容和时序
- 汇总条：已设计/选库/AI生成/待定 统计
- 导出生图清单：仅 AI 生成的镜
- 导出剪辑指引：全部镜的信息

### 选图弹窗（picker.js）

审核台和设计台共用，通过 onSelect 回调区分行为：

```js
// 设计台选主体（单选）
picker.openPicker({
  assets, currentId: shot.subject.assetId,
  multi: false,
  onSelect: (id) => { shot.subject.type = 'lib'; shot.subject.assetId = id; }
});

// 设计台选参考图（多选）
picker.openPicker({
  assets, currentId: null,
  multi: true,
  onSelect: (ids) => { shot.subject.refs = ids; }
});
```

弹窗功能：
- 搜索框（匹配描述、动作、状态、道具、分类）
- 情绪分类筛选（全部/悲伤/愤怒/懵圈无力/打工人/开心/转场特效）
- 构图筛选（全部/全身/上半身/转场）
- 缩略图网格，点击选中/取消

## 进度总览

### 项目卡片

```
┌──────────────────────────────────────┐
│  📄 吃苦卖命                         │
│  🟡 设计中 · 38 镜 · 已设计 12/38   │
│  最后编辑：小王 · 2小时前            │
│                                      │
│  [查看审核]  [进入设计]  [导出JSON]  │
└──────────────────────────────────────┘
```

### 统计栏

```
全部 5 篇 ｜ 🔵 审核中 1 ｜ 🟡 设计中 2 ｜ 🟢 已完成 2
```

### 进度指标（实时计算，不额外存储）

| 指标 | 算法 |
|------|------|
| 审核进度 | review.decisions 已决定数 / review.items 总数 |
| 设计进度 | shots 中 subject.type !== null 的数量 / 总镜数 |
| 最后编辑 | changelog 最后一条的时间 + who |

## 导入/导出与数据合并

### 导入

1. **JSON 导入**：协作者导出 JSON → 发给运营者 → 运营者导入合并
2. **旧 HTML 迁移**：解析 review-*.html 里的 `REVIEW_DATA` 对象，转成新格式

### 合并策略

导入协作者的 JSON 时显示对比面板：

```
导入「吃苦卖命-小王.json」

┌─ 对比 ──────────────────────────────────┐
│                                          │
│  审核部分：无变化（小王没改审核）         │
│                                          │
│  设计部分：小王改了 15 镜                │
│    第 1 镜：未定 → 选库 05               │
│    第 3 镜：未定 → AI 生成               │
│    第 7 镜：选库 02 → 选库 09            │
│    ...                                   │
│                                          │
│  [全部采纳]  [逐条对比]  [放弃]         │
└──────────────────────────────────────────┘
```

合并逻辑：
- 以 changelog 时间戳为基准，取最新修改
- 同一字段两边都改了 → 显示冲突，让运营者选择
- meta.operator 标记数据来源，导入时写入 changelog

## 内网穿透部署

### 启动方式

```bash
cd "C:\Users\26875\Desktop\Script Studio"
python -m http.server 8080
```

从 Script Studio 根目录启动，确保 workspace/ 和 Material Collection/ 都在服务范围内。

项目清单通过 `data/index.json` 管理（saveProject 自动维护），不需要服务器开目录列表。

### 穿透后访问

运营者启动本地服务器 + 穿透工具 → 得到公网 URL → 团队成员浏览器访问。

### 功能兼容性

| 功能 | 穿透可用 | 说明 |
|------|---------|------|
| ES Modules 加载 | ✅ | HTTP 下正常 import |
| 素材图显示 | ✅ | 同源，浏览器不拦 |
| JSON 读写 | ✅ | 通过 HTTP 拉取 |
| 导出文件下载 | ✅ | Blob + URL.createObjectURL |
| 剪贴板复制 | ⚠️ | 需 HTTPS 或 localhost，HTTP 降级到 execCommand |

## 与 /script-review skill 的集成

skill 改为输出 JSON 文件到 `workspace/data/` 目录：

```
/script-review 吃苦卖命
  → 生成 workspace/data/吃苦卖命.json
  → meta.stage = "review"
  → 包含完整的 review 数据
  → design.shots = []（空，等审核后推入）
```

## 旧产物兼容

- `_template.html` 保留作参考，不再作为产物模板
- `output/review-*.html` 存量产物可通过 export.js 的 parseLegacyReview() 迁移
- `output/storyboard-*.html` 存量产物的 JSON 导出可直接导入新工作台

## 待补接口

以下功能留接口，当前不实现：

1. 剪映后期五格预设内容（数据驱动，初始空）
2. 电脑端布局提效（当前沿用现有布局）
3. 镜间间隔（可能需要，暂不做）
4. 实时多人协作（当前为数据包流转模式）
5. 权限控制细粒度（当前为全功能访问）
