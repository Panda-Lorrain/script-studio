# 交接：刷新闪现管理员后台问题

> 日期：2026-06-22
> 状态：已做两轮修复，但用户反馈"似乎还没解决"，未确认是否根治，需接力排查。

## 问题现象

用户报告：**刷新浏览器时，会短暂闪现管理员后台界面**，担心后台被泄露给非管理员。

## 相关背景

- 项目：`C:\Users\26875\Desktop\Script Studio\workspace\`（纯前端 ES Modules 工作台，无构建）
- 入口：`workspace/index.html` → `workspace/js/app.js`
- 启动：`python -m http.server 8080` → `http://localhost:8080/workspace/`
- 权限模型：`store.isAdmin()` = 当前操作者（localStorage `ss_operator`）在管理员名单（localStorage `ss_admins`，默认 `['lorrain']`）。纯前端，无服务端鉴权。
- 管理员可见：总览(#dashboard)、管理员后台(#admin)、导入/选目录/新建按钮。普通成员只见审核台(#review)、设计台(#design)。

## 已做的修复（commit 69828ec）

在 `workspace/js/app.js` 的 `route()` 函数开头加了双重保险：

```js
async function route() {
  let hash = location.hash.slice(1) || 'dashboard';
  // ① 非 admin 访问 admin/dashboard → 立即重定向 review（URL 都改掉）
  if (!store.isAdmin() && (hash === 'admin' || hash === 'dashboard' || hash === '')) {
    hash = 'review';
    history.replaceState(null, '', '#review');
  }
  // ② 主区先占位清空，避免上次内容在 async 渲染期间闪现
  $('main').innerHTML = '<div style="padding:80px;text-align:center;color:#8a9099">加载中…</div>';
  ...原逻辑...
}
```

## 为什么可能还没根治（根因未确认）

用户的反馈较笼统（"似乎还没解决"），**关键信息缺失，未确认真实根因**。可能性：

1. **用户其实是管理员（lorrain）**：刷新时 URL 是 `#admin`，route 渲染 admin 后台——这对管理员是**正常行为**，不是泄露。需先确认用户登录身份。
2. **闪现的不是 admin 后台，而是总览（#dashboard）或侧栏的 admin 项**：用户表述"管理员后台"可能泛指管理类界面。
3. **CSS 加载时序**：`<link>` CSS 在 `<head>`，理论上先于 `<script type="module">`（defer）。但若 JS 渲染的 DOM 先于 CSS 应用，可能短暂无样式显示（FOUC）。需确认是否无样式闪现。
4. **登录浮层背后的残留**：`boot()` 无 operator 时弹 `#loginOverlay`（z-index 200，背景半透明）。若此时 `#main` 有内容，会透过半透明背景显示。但无 operator 不调 route，main 应为空——除非 DOM 有残留。
5. **浏览器 bfcache / 前进后退**：用户"刷新"可能指 SPA 内切换或前进后退，非 F5 reload。
6. **isAdmin 时序**：`isAdmin()` 读 localStorage（同步），boot 顺序是 `setupDirButton(await) → ... → route`。await 期间 main 是空（占位前的原始空）。理论上无闪现。

## 待排查清单（给接力 agent）

**第一步：确认现象（最重要，问用户或自己复现）**
- [ ] 闪现时用的是**什么身份**登录？（lorrain 还是别的名字）
- [ ] 闪现的**具体界面**是哪个？（👑 管理员后台 / 📊 总览 / 侧栏多了项 / 登录浮层后的内容）
- [ ] 闪现**时机**：刷新瞬间（白屏后）/ 登录前 / 登录后 / 切换操作者时
- [ ] 是 **F5 刷新** 还是 **浏览器前进后退 / SPA 切换**？
- [ ] 闪现**多久**（毫秒级 / 秒级）？有没有样式？

**第二步：根据现象定位**
- 若用户是 lorrain 看到 admin → **正常，非 bug**，向用户解释（管理员看自己的后台）。
- 若非 admin 看到 admin 内容 → 检查 `route()` 的重定向是否生效：在 `route` 开头加 `console.log(hash, store.isAdmin())` 看时序。
- 若是 CSS FOUC → 检查 `<link>` 位置，或给 `#main` 初始内联样式。
- 若是登录浮层背后残留 → 检查 `boot()` 无 operator 时是否确保 `#main` 为空；考虑 `#loginOverlay` 背景不透明（现 `rgba(31,35,41,.5)` 半透明，改成纯色或更高 opacity）。
- 若是 bfcache → 加 `pageshow` 事件监听重新 route。

**第三步：可选的更彻底防御**
- `index.html` 的 `<main id="main">` 初始就放「加载中」占位（而非依赖 JS）。
- `#loginOverlay` 背景改不透明（`rgba(31,35,41,.95)` 或纯色），登录前彻底遮住背后。
- `boot()` 在弹登录浮层前 `$('main').innerHTML = ''` 确保空。
- 非 admin 的 `isAdmin()` 在所有渲染路径前置（目前 route 开头已做，但 `boot`/`applyAdminUI` 也涉及按钮显隐，确认一致）。

## 关键文件 & 函数

| 文件 | 函数 | 作用 |
|------|------|------|
| `workspace/index.html` | `#loginOverlay`, `#main` | 登录浮层（z-index 200）、主区 |
| `workspace/js/app.js` | `boot()` | 启动：setupDirButton → setupImport → 判断 operator → route 或 openLogin |
| `workspace/js/app.js` | `route()` | 路由：开头已加重定向 + 占位（本次修复） |
| `workspace/js/app.js` | `renderSidebar()` | 侧栏：admin 项仅 isAdmin 时渲染 |
| `workspace/js/app.js` | `applyAdminUI()` | 按 isAdmin 显隐导入/选目录按钮 |
| `workspace/js/app.js` | `openLogin({mode})` | 登录浮层（首次/切换/退出） |
| `workspace/js/store.js` | `isAdmin()`, `getAdmins()`, `getOperator()` | 权限判断（localStorage） |

## 复现 / 验证方法

```bash
cd "C:\Users\26875\Desktop\Script Studio"
python -m http.server 8080
# 浏览器开 http://localhost:8080/workspace/
```

1. 用「lorrain」登录（管理员）→ 访问 `#admin` → 刷新 → 应正常显示后台（admin 看 admin，正常）。
2. 退出，用「小王」登录（非管理员）→ 手动改 URL 为 `#admin` → 应**立即跳 `#review`**，不显示后台。
3. 关键观察：刷新瞬间（F12 Network 勾 Disable cache，慢速刷新）主区是否闪现过 admin/总览内容。

## 当前 git 状态

- 分支：`master`
- 最新相关提交：`69828ec fix(workspace): 防后台闪现——非admin访问admin/总览立即重定向+主区先占位清空`
- 工作区干净（workspace/ 全提交）
- 预存在未跟踪文件（非本次工作）：`.gitignore`(M)、`Material Collection/`、`output/storyboard-*.html`
