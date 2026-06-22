# Workspace 手机端自动同步 设计规格

> 日期：2026-06-23
> 状态：已与用户共创确认，待实现
> 作者：lorrain + Claude

## 背景

当前 workspace 工作台是纯前端 ES Modules 应用，数据读写依赖 **File System Access API**（仅桌面 Chrome/Edge 支持）。手机端/公网协作者没有 FSA，改的内容只能存**本机浏览器 IndexedDB**（key=`draft_<标题>`），运营者（lorrain）和其他人看不到，必须靠「导出 JSON → 导入合并」手动回流。

痛点：手机上改了内容，不手动导出 JSON 就进不了服务器，协作摩擦大、改动易丢。

## 目标

让授权成员（手机 / 公网）改完内容**自动同步到服务器** `data/*.json`，无需手动导出导入。lorrain 和所有人实时看到同一份数据。

## 非目标（YAGNI，本期不做）

- 实时多人光标 / 在线状态
- 字段级细粒度冲突合并（保留 LWW，少数人够用）
- 离线编辑队列（save 失败即报错重试，不做 IndexedDB 离线兜底）
- 固定域名的命名隧道（继续用 trycloudflare 临时 URL）
- 读写权限分级（白名单内统一可读可写）
- 口令/二次认证（用户选择纯名单；风险见末节，后续可加）

## 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 使用场景 | lorrain + 少数信任成员协作 | 当前规模，过度工程不值 |
| 鉴权 | 用户名白名单（无口令） | 用户指定；名单内即授权 |
| 未授权者 | 直接拒绝进门 | 私有协作工具 |
| 冲突策略 | last-write-wins（按 `meta.updated`） | 少数人不太会同时改同一篇 |
| 后端语言 | Python 标准库（无 npm、无构建） | 遵循 CLAUDE.md 静态哲学 |
| localhost 运营者 | 保留 FSA 直写 | 体验不变、最快 |
| 同步触发 | 改完即存（实时） | 根治"不想手动"痛点 |

## 架构

```
                     ┌─ localhost (lorrain 电脑) ──────────┐
浏览器 ──FSA 直写──►  data/*.json  ◄──写── server.py (8080)
                     └─────────────────────────────────────┘
                     ┌─ 公网 (手机 / 成员) ────────────────┐
浏览器 ──HTTPS──► cloudflared ──► server.py
   登录 POST /api/login  (校验白名单)
   改完 POST /api/save   ──写──► data/*.json + index.json
                     └─────────────────────────────────────┘
```

一个 `workspace/server.py` **同时承担两件事**：① 静态文件服务（替换 `python -m http.server`）② API 接口。所有写入最终都落到同一批 `data/*.json`，lorrain 与成员看同一份数据。

## 文件改动清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `workspace/server.py` | **新建** | ~150 行，`http.server` 自定义 Handler，静态分发 + API 路由 |
| `workspace/data/users.json` | **新建** | 白名单 `{admins:["lorrain"], members:["lorrain","陈德基",...]}` |
| `js/store.js` | **改** | 无 FSA 时登录 / save 走 API（替代只存 IndexedDB）；新增 `setAdminFromServer` |
| `js/app.js` | **改** | 登录提交接 `/api/login`，未授权拒绝进门；`applyAdminUI` 改用服务端 `isAdmin` |
| `js/admin.js` | **改** | 后台加「👥 成员管理」区块（增删白名单） |
| `css/base.css` | 微调 | 成员管理区块、登录失败提示样式 |

## 接口契约

所有 `/api/*` 走 JSON，凭 httpOnly cookie `ss_session` 鉴权。

### `POST /api/login`
- 请求：`{"name":"陈德基"}`
- name 在 `users.json` 的 `members` 内 → 生成随机 token（`secrets.token_hex`），存内存 `Map<token,name>`，`Set-Cookie: ss_session=<token>; HttpOnly; SameSite=Lax; Path=/`，返回 `{"ok":true,"name":"陈德基","isAdmin":false}`
- 不在名单 → `403 {"ok":false,"error":"unauthorized"}`

### `GET /api/me`
- 凭 cookie 的 token 查内存 Map → 返回 `{"ok":true,"name","isAdmin"}`；token 失效/无 → `401 {"ok":false}`

### `POST /api/save`
- 请求体：整篇 project JSON
- 鉴权：cookie token 有效 + token 对应 name **仍在** `members`（实时查，lorrain 移出名单即时生效）
- 冲突检测（LWW）：读现有文件 `meta.updated`
  - 客户端 `meta.updated` ≥ 服务器 → 接受；**server 用服务器当前 UTC 时间重写 `meta.updated`**，写 `data/<title>.json` + 更新 `index.json`，返回 `{"ok":true,"updated":"<新时间>"}`
  - 客户端 < 服务器 → `409 {"ok":false,"error":"stale","server":<服务器当前整篇JSON>}`
- 未登录 → `401`；非 member → `403`

### `GET /api/users`（仅 admin）
- 返回 `{"admins":[...],"members":[...]}`

### `POST /api/user`（仅 admin）
- 请求 `{"name":"陈德基"}` → 加入 `members`（去重），写回 `users.json`，返回新名单
- admin 判定：token 对应 name 在 `admins`

### `DELETE /api/user?name=`（仅 admin）
- 从 `members` 删除；**lorrain 不可删**（保护）；写回 `users.json`

### 会话与鉴权细节
- 会话：httpOnly cookie + server 内存 token Map。**server 重启 → Map 清空 → 所有 session 失效 → 前端 401 → 重新登录**（可接受，lorrain 重启 server 时成员重登一次）。
- 静态文件请求（非 `/api/`）：照常返回，无需鉴权（但未登录者前端会卡在登录浮层，看不到内容）。

## store.js 改造要点

```js
async function saveProject(data) {
  data.meta.updated = nowIso();
  if (dirHandle) {
    /* 现有 FSA 写：localhost lorrain 不变 */
  } else {
    /* 手机/成员：走 API */
    const res = await fetch('/api/save', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    if (res.status === 409) { /* 冲突：用 res.json().server 刷新本地，toast 提示 */ }
    if (!res.ok) throw new Error('保存失败');
    const { updated } = await res.json();
    data.meta.updated = updated; /* 用服务器接管后的时间 */
  }
  projectCache.set(data.meta.title, data);
  return data;
}
```

- `loadProject`：无 FSA 时仍 `fetch('data/<title>.json?t=<ts>')`，**带时间戳防缓存**，保证拿服务器最新版；移除 IndexedDB draft 读取（API 模式下数据以服务器为准）。
- 新增 `setAdminFromServer(bool)`：login 返回 `isAdmin` 后存 `localStorage`，`isAdmin()` 改读它（替代硬编码 `ss_admins` 默认值，但保持 lorrain 默认 admin 兜底）。
- `loadProjectList`：fetch `data/index.json?t=<ts>` 防缓存。

## app.js 改造要点

- `openLogin` 的 `ok()`：提交前先 `POST /api/login`，**通过才** `setOperator` + 进工作台；不通过则提示「未授权，联系 lorrain」并留在登录页。
- 页面加载（`boot`）：先 `GET /api/me`，已登录→恢复；未登录→弹登录浮层。
- `applyAdminUI`：改用 login 返回的 `isAdmin`（经 store 持久化）控制「总览/后台/导入/选目录/新建」的显隐。

## 冲突处理（LWW）

- 唯一时间源：**server 接受写入时用服务器 UTC 时间重写 `meta.updated`**，避免各设备时钟偏差导致 LWW 误判。
- 客户端拿到的 `meta.updated` 永远是服务器给的；下次 save 携带它，server 与文件里的比。
- 并发丢失（A 改镜1、B 改镜2 几乎同时，基于同一版本）：LWW 下后存者覆盖先存者的另一处改动——少数人场景可接受，需要字段级合并再说。

## 错误处理

| 情况 | server | 前端行为 |
|------|--------|---------|
| 断网 / save 失败 | — | toast「保存失败」，数据留前端可重试 |
| 未登录 / session 过期 | 401 | 弹登录浮层 |
| 非成员（被移出） | 403 | toast「无权限」，弹登录 |
| 冲突（版本落后） | 409 + 服务器版 | toast「已被别人更新，已刷新」，用服务器版覆盖本地并重渲染 |
| server 不可达 | — | toast「无法连接服务器」 |

## 白名单管理 UI

lorrain 的「管理员后台」（`admin.js`）新增「👥 成员管理」区块：
- 输入框 + 「添加」按钮 → `POST /api/user`
- 当前 `members` 列表，每项一个「删除」→ `DELETE /api/user?name=`（lorrain 项禁用删除）
- 改动经 server 写 `users.json`，所有成员下次 `save` 时实时生效。

## 启动方式（变化）

```bash
# 旧：python -m http.server 8080
# 新：
python workspace/server.py              # 内部绑定 0.0.0.0:8080
# cloudflared 不变：
E:/cloudflared.exe tunnel --url http://localhost:8080
```

`server.py` 默认 8080，可用 `PORT=xxxx python workspace/server.py` 覆盖。

## localhost 运营者行为

- **优先 FSA 直写**（lorrain 已授权 `workspace/` 目录，体验不变、最快）。
- 公网成员走 API；两者写同一批 `data/*.json`，无冲突。
- lorrain 默认在 `users.json` 的 `admins` + `members` 首项；lorrain 用手机/其他浏览器时也在白名单内，可直接登录。
- lorrain 在 localhost 也需正常登录（白名单内）——**登录是进入工作台的统一门槛，localhost 不例外**。登录后 FSA 写入照旧（不经 server），后台管理与成员增删走 `/api/*` 凭 cookie。

## 风险与后续

- **纯用户名无口令**：名单内名字一旦泄露即可被冒充登录。后续若觉得不够，可加口令字段（`users.json` 增 `password` 或独立 secrets）。
- **LWW 并发丢失**：少数人可接受；若协作密度上升，再做字段级合并（复用 `export.js` 的 `mergeData` 思路）。
- **trycloudflare URL 临时**：server/cloudflared 重启即变；要固定需注册 Cloudflare 账号建命名隧道。
- **server 重启丢 session**：成员需重登；若困扰可把 token 持久化到 `data/sessions.json`。
