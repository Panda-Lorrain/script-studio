# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

Script Studio 是 `script-review` skill 的**工作目录**：该 skill 对抖音/小红书口播文案做语义级合规审核，产物（自包含的交互式审核台 HTML）就落在这里。**无构建、无 npm 依赖、无测试**——别去找 `package.json`。

目录：

- `审核台/` —— skill 的**素材区**：
  - `_template.html` —— 审核台模板（skill 据此生成产物）。
  - `wordbank.js` —— **参考词库**，给 skill 审核时兜底用（见下）。
- `output/` —— skill 的**产物区**：`review-*.html` 审核成品，数据内联、自包含，直接浏览器打开即可用。
- `workspace/` —— **工作台**（主入口）：纯前端 ES Modules 应用，融合审核+设计，JSON 数据驱动协作。详见下方「运行方式」。
- `Material Collection/` —— **素材集**：同角色 AI 生成图库，按情绪分子文件夹。工作台通过 `workspace/assets.json` 引用（扫描脚本生成）。
- `词库源/` —— **只读参考**：三个第三方词库的 git clone（`ad_checker` / `sensitive-word` / `wordscheck`），是词单的原始来源，不要改这里的代码。
- `.claude/` —— Claude Code 配置。

> 历史：本目录曾有一个纯前端的「违禁词检测」Web 应用（`index.html` + `app.js`），因机械词库匹配效果远不如 agent 语义审核，已删；仅保留 `wordbank.js` 词单。

## wordbank.js（参考词库）

人工整理的合规词清单，审核广告法绝对化用语、导流词时可拿来对照/兜底：

```js
const AD_WORDS = [ /* 311 广告法违禁词, 每项: ["词", "分类原因"] */ ];
const DRAIN_WORDS = [ /* 25 导流词, 同格式 */ ];
const WORDBANK = AD_WORDS.concat(DRAIN_WORDS);
```

它**不再被任何网页引用**（应用壳已删），现在是纯数据资产。要更新词条直接改这里；要扩充词源去 `词库源/` 提取后并进来。

## 审核台产物的数据契约（改模板/产物必读）

`_template.html` 里有占位 `var REVIEW_DATA = { PLACEHOLDER };`，skill 把它替换成真实审核数据对象，得到 `review-*.html`。

硬约束：`items[].original` **必须是 `original` 文案的子串**——页面据此 `indexOf` 定位高亮与替换，对不上就错位。生成产物时务必保证这一点。

要改审核台的样式/交互，应改 **skill 本身或 `_template.html`**，不要手改 `output/review-*.html` 成品。

## 运行方式

### 工作台（主入口）

`workspace/` 是融合审核+设计的纯前端工作台（ES Modules，需 HTTP 服务器）：

```bash
cd "C:\Users\26875\Desktop\Script Studio"
python -m http.server 8080
```
浏览器打开 `http://localhost:8080/workspace/`。

- 首次访问输入昵称，点「选择工作目录」授权 `workspace/` 文件夹（Chrome/Edge，localhost 环境）
- 数据在 `workspace/data/*.json`，授权后读写全自动（File System Access API）
- 内网穿透后，协作者访问同一 URL 只读浏览，改完「导出」JSON 发回，运营者「导入」合并
- 加新素材后跑 `python workspace/scripts/scan-assets.py` 刷新 `workspace/assets.json`

设计规格见 `docs/superpowers/specs/2026-06-22-workspace-design.md`。

### 单文件产物（旧，兼容）

审核台产物直接双击 `output/review-*.html`（`file://` 可用，离线）。可通过工作台「导入」按钮迁移到新格式。

## 版本控制

本目录是一个**独立 git 仓库**（`master` 分支），已配远程 `origin` → GitHub 私有库 `ChenDeji123/script-studio`（国内经 `ghfast.top` 加速，凭据存 Windows 凭据管理器；后续直接 `git push` 即可）。实际跟踪范围：

- `审核台/`、`output/`、`workspace/`、`docs/` —— skill 素材、产物、工作台代码、设计文档。
- `Material Collection/素材清单.md` —— 素材图库的**索引文件**（仅此一个入库，原图不入库，见下）。
- `CLAUDE.md`、`.gitignore`。

`.gitignore` 排除：
- `词库源/` —— 三个子目录各自是独立 git clone，自带版本管理，不重复跟踪。
- `.claude/settings.local.json` —— 机器相关的本地权限配置。
- `Material Collection/**/*.{jpg,jpeg,png,webp,gif}` —— 素材图库**原图**，体积大（约 22MB 且持续增长）不入库，靠素材清单索引 + `workspace/assets.json` 本地路径引用。
- `output/Material Collection/` —— 素材图**副本**（供 storyboard HTML 双击离线加载图），同上不入库。

注意：本仓库**嵌套在桌面（`Desktop`）那个大 git 仓库里**。对桌面仓库而言，整个 `Script Studio/` 现在是一个嵌套仓库（gitlink），桌面仓库不再直接跟踪本目录内部文件——这是预期行为。每次 `script-review` 生成新产物后，记得把文件归到 `output/` 并 `git add output/ && git commit` 记录版本。
