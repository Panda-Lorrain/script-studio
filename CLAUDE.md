# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

Script Studio 是 `script-review` skill 的**工作目录**：该 skill 对抖音/小红书口播文案做语义级合规审核，产物（自包含的交互式审核台 HTML）就落在这里。**无构建、无 npm 依赖、无测试**——别去找 `package.json`。

目录：

- `审核台/` —— skill 的**素材区**：
  - `_template.html` —— 审核台模板（skill 据此生成产物）。
  - `wordbank.js` —— **参考词库**，给 skill 审核时兜底用（见下）。
- `output/` —— skill 的**产物区**：`review-*.html` 审核成品，数据内联、自包含，直接浏览器打开即可用。
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

审核台是自包含 HTML，直接双击 `output/review-*.html`（`file://` 即可，离线）。需要本地分享时用静态服务器（`python -m http.server` 等）。

## 版本控制

本目录是一个**独立 git 仓库**（`master` 分支），跟踪 `审核台/`、`output/`、`CLAUDE.md`、`.gitignore`。

`.gitignore` 排除两类：
- `词库源/` —— 三个子目录各自是独立 git clone，自带版本管理，不重复跟踪。
- `.claude/settings.local.json` —— 机器相关的本地权限配置。

注意：本仓库**嵌套在桌面（`Desktop`）那个大 git 仓库里**。对桌面仓库而言，整个 `Script Studio/` 现在是一个嵌套仓库（gitlink），桌面仓库不再直接跟踪本目录内部文件——这是预期行为。每次 `script-review` 生成新产物后，记得把文件归到 `output/` 并 `git add output/ && git commit` 记录版本。
