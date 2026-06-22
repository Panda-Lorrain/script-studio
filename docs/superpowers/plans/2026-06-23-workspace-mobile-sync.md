# Workspace 手机端自动同步 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让授权成员（手机/公网）在工作台改完内容自动同步到服务器 `data/*.json`，无需手动导出 JSON。

**Architecture:** 新建 `workspace/server.py`（Python 标准库 `http.server`），同时承担静态分发（替换 `python -m http.server`）与协作 API（login/me/save/users）。前端 `store.js` 在无 FSA 时改走 API；`app.js` 登录接 `/api/login`、未授权拒绝；`admin.js` 后台增删白名单。冲突用 LWW（server 用自身时钟重写 `meta.updated`）。

**Tech Stack:** Python 3 标准库（无第三方包）、浏览器原生 ES Modules、File System Access API（localhost 运营者保留）。

**全局约定:**
- 所有 git 命令在仓库根 `C:/Users/26875/Desktop/Script Studio` 执行（若 cwd 不确定，用 `git -C "C:/Users/26875/Desktop/Script Studio"`）。
- curl 验证前先确保 `server.py` 在 8080 运行（见 Task 1 启动方式）。
- curl 的 cookie 存到临时文件 `cookies.txt`（验证用，最后删除）。
- 前端文件改的是 `workspace/js/*.js` 与 `workspace/css/*.css`，无构建，改完浏览器刷新即生效。

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `workspace/server.py`（新建） | 静态分发 + 协作 API（login/me/save/users + user 增删），会话内存 Map |
| `workspace/data/users.json`（新建） | 白名单 `{admins, members}` |
| `workspace/js/store.js`（改） | 无 FSA 时 saveProject/loadProject 走 API；admin 状态由服务端下发 |
| `workspace/js/app.js`（改） | 登录走 `/api/login`、boot 走 `/api/me`、未授权拒绝进门 |
| `workspace/js/admin.js`（改） | 后台「成员管理」区块 |
| `workspace/css/base.css`（改） | 成员管理样式 |

---

## Task 1: server.py 骨架（静态分发 + API 路由框架）

**Files:**
- Create: `workspace/server.py`

- [ ] **Step 1: 停掉占用 8080 的旧服务**

当前 `python -m http.server 8080` 占着端口。执行（在已开的终端按 Ctrl+C，或在此会话用 TaskStop 停掉后台 task id `bdlp86x4e`）。确认 8080 已释放。

- [ ] **Step 2: 写 server.py 骨架**

创建 `workspace/server.py`，完整内容：

```python
#!/usr/bin/env python3
"""Script Studio workspace server: 静态分发 + 协作 API。
替换 `python -m http.server`。端口默认 8080，环境变量 PORT 可覆盖。
静态根 = Script Studio/（保持 /workspace/ 与 /Material Collection/ 的 URL 不变）。
"""
import json, os, secrets, datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

WORKSPACE = os.path.dirname(os.path.abspath(__file__))      # workspace/
SITE_ROOT = os.path.dirname(WORKSPACE)                       # Script Studio/
DATA = os.path.join(WORKSPACE, 'data')
USERS_FILE = os.path.join(DATA, 'users.json')
PORT = int(os.environ.get('PORT', '8080'))

SESSIONS = {}   # token -> name，内存，重启失效


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def load_users():
    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_users(u):
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(u, f, ensure_ascii=False, indent=2)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SITE_ROOT, **kw)

    @property
    def cookies(self):
        if not hasattr(self, '_cookies'):
            self._cookies = {}
            for part in self.headers.get('Cookie', '').split(';'):
                if '=' in part:
                    k, v = part.split('=', 1)
                    self._cookies[k.strip()] = v.strip()
        return self._cookies

    def session_name(self):
        return SESSIONS.get(self.cookies.get('ss_session'))

    def _json(self, code, obj, set_cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if set_cookie:
            self.send_header('Set-Cookie', set_cookie)
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/me':
            return self.api_me()
        if path == '/api/users':
            return self.api_users()
        if path.startswith('/api/'):
            return self._json(404, {'ok': False, 'error': 'not found'})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/login':
            return self.api_login()
        if path == '/api/save':
            return self.api_save()
        if path == '/api/user':
            return self.api_user_add()
        self._json(404, {'ok': False, 'error': 'not found'})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == '/api/user':
            return self.api_user_del()
        self._json(404, {'ok': False, 'error': 'not found'})

    # ---- API 占位（Task 2-4 填充）----
    def api_login(self):
        self._json(501, {'ok': False, 'error': 'not implemented'})

    def api_me(self):
        self._json(501, {'ok': False, 'error': 'not implemented'})

    def api_save(self):
        self._json(501, {'ok': False, 'error': 'not implemented'})

    def api_users(self):
        self._json(501, {'ok': False, 'error': 'not implemented'})

    def api_user_add(self):
        self._json(501, {'ok': False, 'error': 'not implemented'})

    def api_user_del(self):
        self._json(501, {'ok': False, 'error': 'not implemented'})


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Script Studio workspace server on http://0.0.0.0:{PORT}/  (site root: {SITE_ROOT})')
    srv.serve_forever()
```

- [ ] **Step 3: 启动 server 并验证静态分发**

启动（后台或独立终端）：
```bash
python "C:/Users/26875/Desktop/Script Studio/workspace/server.py"
```
验证：
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/workspace/
```
Expected: `200`

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/workspace/js/app.js"
```
Expected: `200`

```bash
curl -s http://localhost:8080/api/me
```
Expected: `{"ok": false, "error": "not implemented"}`（501，占位）

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/26875/Desktop/Script Studio" add workspace/server.py
git -C "C:/Users/26875/Desktop/Script Studio" commit -m "feat(workspace): server.py 骨架——静态分发+API路由框架"
```

---

## Task 2: users.json 白名单 + /api/login + /api/me

**Files:**
- Create: `workspace/data/users.json`
- Modify: `workspace/server.py`（填充 `api_login`、`api_me`）

- [ ] **Step 1: 写 users.json**

创建 `workspace/data/users.json`：
```json
{
  "admins": ["lorrain"],
  "members": ["lorrain"]
}
```

- [ ] **Step 2: 验证 login/me 当前未实现（红）**

```bash
curl -s -X POST http://localhost:8080/api/login -H "Content-Type: application/json" -d "{\"name\":\"lorrain\"}"
```
Expected: `{"ok": false, "error": "not implemented"}`（501）

- [ ] **Step 3: 填充 api_login 与 api_me**

把 `workspace/server.py` 里这两个占位方法替换为：

```python
    def api_login(self):
        body = self._read_body()
        name = (body.get('name') or '').strip()
        users = load_users()
        if name and name in users.get('members', []):
            token = secrets.token_hex(16)
            SESSIONS[token] = name
            is_admin = name in users.get('admins', [])
            self._json(200, {'ok': True, 'name': name, 'isAdmin': is_admin},
                       set_cookie=f'ss_session={token}; HttpOnly; SameSite=Lax; Path=/')
        else:
            self._json(403, {'ok': False, 'error': 'unauthorized'})

    def api_me(self):
        name = self.session_name()
        if not name:
            return self._json(401, {'ok': False})
        users = load_users()
        self._json(200, {'ok': True, 'name': name, 'isAdmin': name in users.get('admins', [])})
```

- [ ] **Step 4: 重启 server，验证 login/me（绿）**

重启 server（Ctrl+C 后重跑 Step 3 of Task 1 的启动命令），然后：

```bash
# 成员登录成功，cookie 存 cookies.txt
curl -s -X POST http://localhost:8080/api/login -H "Content-Type: application/json" -d "{\"name\":\"lorrain\"}" -c "C:/Users/26875/Desktop/Script Studio/cookies.txt"
```
Expected: `{"ok": true, "name": "lorrain", "isAdmin": true}`

```bash
# 带 cookie 查询登录态
curl -s http://localhost:8080/api/me -b "C:/Users/26875/Desktop/Script Studio/cookies.txt"
```
Expected: `{"ok": true, "name": "lorrain", "isAdmin": true}`

```bash
# 非成员被拒
curl -s -X POST http://localhost:8080/api/login -H "Content-Type: application/json" -d "{\"name\":\"hacker\"}"
```
Expected: `{"ok": false, "error": "unauthorized"}`（HTTP 403）

```bash
# 不带 cookie 查 me → 未登录
curl -s http://localhost:8080/api/me
```
Expected: `{"ok": false}`（HTTP 401）

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/26875/Desktop/Script Studio" add workspace/data/users.json workspace/server.py
git -C "C:/Users/26875/Desktop/Script Studio" commit -m "feat(workspace): /api/login+/api/me+users.json 白名单"
```

---

## Task 3: /api/save（LWW 冲突 + 写文件 + 更新 index）

**Files:**
- Modify: `workspace/server.py`（新增模块级 `update_index`，填充 `api_save`）

- [ ] **Step 1: 验证 save 当前未实现（红）**

```bash
curl -s -X POST http://localhost:8080/api/save -H "Content-Type: application/json" -b "C:/Users/26875/Desktop/Script Studio/cookies.txt" -d "{\"meta\":{\"title\":\"x\"}}"
```
Expected: `{"ok": false, "error": "not implemented"}`（501）

- [ ] **Step 2: 新增 update_index 模块级函数**

在 `workspace/server.py` 的 `save_users` 函数下方（`class Handler` 之前）插入：

```python
def update_index(data):
    idx_path = os.path.join(DATA, 'index.json')
    try:
        with open(idx_path, 'r', encoding='utf-8') as f:
            idx = json.load(f)
    except Exception:
        idx = {'projects': []}
    projects = idx.get('projects', [])
    summary = {
        'title': data['meta']['title'],
        'stage': data['meta'].get('stage', 'review'),
        'updated': data['meta']['updated'],
        'shotCount': len(data.get('design', {}).get('shots', [])),
        'reviewItemCount': len(data.get('review', {}).get('items', [])),
    }
    for i, p in enumerate(projects):
        if p.get('title') == summary['title']:
            projects[i] = summary
            break
    else:
        projects.append(summary)
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump({'projects': projects}, f, ensure_ascii=False, indent=2)
```

- [ ] **Step 3: 填充 api_save**

把 `api_save` 占位替换为：

```python
    def api_save(self):
        name = self.session_name()
        if not name:
            return self._json(401, {'ok': False, 'error': 'no session'})
        users = load_users()
        if name not in users.get('members', []):
            return self._json(403, {'ok': False, 'error': 'not member'})
        data = self._read_body()
        title = (data.get('meta') or {}).get('title')
        if not title:
            return self._json(400, {'ok': False, 'error': 'no title'})
        safe = title.replace('/', '_').replace('\\', '_').replace(':', '_')
        fpath = os.path.join(DATA, safe + '.json')
        client_updated = (data.get('meta') or {}).get('updated', '')
        existing = None
        server_updated = ''
        if os.path.exists(fpath):
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
                server_updated = (existing.get('meta') or {}).get('updated', '')
            except Exception:
                existing = None
        # LWW：客户端版本落后于服务器 → 拒绝，返回服务器版
        if client_updated and server_updated and client_updated < server_updated:
            return self._json(409, {'ok': False, 'error': 'stale', 'server': existing})
        # 接受：server 用自身时钟接管 updated
        new_updated = now_iso()
        data.setdefault('meta', {})['updated'] = new_updated
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        update_index(data)
        self._json(200, {'ok': True, 'updated': new_updated})
```

- [ ] **Step 4: 重启 server，验证 save 正常路径（绿）**

```bash
curl -s -X POST http://localhost:8080/api/save -H "Content-Type: application/json" -b "C:/Users/26875/Desktop/Script Studio/cookies.txt" -d "{\"meta\":{\"title\":\"测试同步\",\"updated\":\"2000-01-01T00:00:00.000Z\",\"stage\":\"review\"},\"review\":{\"items\":[],\"decisions\":{},\"output\":\"\"},\"design\":{\"shots\":[]}}"
```
Expected: `{"ok": true, "updated": "<当前UTC时间>"}`

确认文件落地：
```bash
ls "C:/Users/26875/Desktop/Script Studio/workspace/data/测试同步.json"
```
Expected: 文件存在。打开看 `meta.updated` 应为服务器时间（非 2000 年）。

确认 index 更新：
```bash
curl -s "http://localhost:8080/workspace/data/index.json?t=1" | grep -o "测试同步"
```
Expected: 输出 `测试同步`

- [ ] **Step 5: 验证 LWW 冲突（409）**

用更旧的 updated 再存一次（服务器版已是刚才的新时间，客户端 2000 年更旧）：
```bash
curl -s -X POST http://localhost:8080/api/save -H "Content-Type: application/json" -b "C:/Users/26875/Desktop/Script Studio/cookies.txt" -d "{\"meta\":{\"title\":\"测试同步\",\"updated\":\"2000-01-01T00:00:00.000Z\",\"stage\":\"review\"},\"review\":{\"items\":[]},\"design\":{\"shots\":[]}}"
```
Expected: `{"ok": false, "error": "stale", "server": {...}}`（HTTP 409）

- [ ] **Step 6: 验证未登录被拒**

```bash
curl -s -X POST http://localhost:8080/api/save -H "Content-Type: application/json" -d "{\"meta\":{\"title\":\"x\"}}"
```
Expected: `{"ok": false, "error": "no session"}`（HTTP 401）

- [ ] **Step 7: 清理测试数据**

删除测试项目文件，并从 index.json 移除「测试同步」条目（手动编辑 index.json 去掉该条，删 `data/测试同步.json`）。删 `cookies.txt`。

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/26875/Desktop/Script Studio" add workspace/server.py
git -C "C:/Users/26875/Desktop/Script Studio" commit -m "feat(workspace): /api/save LWW 冲突+写文件+更新index"
```

---

## Task 4: /api/users + /api/user 增删（admin）

**Files:**
- Modify: `workspace/server.py`（填充 `api_users`、`api_user_add`、`api_user_del`）

- [ ] **Step 1: 填充三个 admin 接口**

把这三个占位方法替换为：

```python
    def api_users(self):
        name = self.session_name()
        if not name:
            return self._json(401, {'ok': False})
        users = load_users()
        if name not in users.get('admins', []):
            return self._json(403, {'ok': False, 'error': 'admin only'})
        self._json(200, {'ok': True, 'admins': users.get('admins', []), 'members': users.get('members', [])})

    def api_user_add(self):
        name = self.session_name()
        if not name:
            return self._json(401, {'ok': False})
        users = load_users()
        if name not in users.get('admins', []):
            return self._json(403, {'ok': False, 'error': 'admin only'})
        body = self._read_body()
        new = (body.get('name') or '').strip()
        if new and new not in users['members']:
            users['members'].append(new)
            save_users(users)
        self._json(200, {'ok': True, 'members': users['members']})

    def api_user_del(self):
        name = self.session_name()
        if not name:
            return self._json(401, {'ok': False})
        users = load_users()
        if name not in users.get('admins', []):
            return self._json(403, {'ok': False, 'error': 'admin only'})
        target = parse_qs(urlparse(self.path).query).get('name', [''])[0]
        if target == 'lorrain':
            return self._json(400, {'ok': False, 'error': 'cannot remove lorrain'})
        if target in users['members']:
            users['members'].remove(target)
            save_users(users)
        self._json(200, {'ok': True, 'members': users['members']})
```

- [ ] **Step 2: 重启 server，重新登录拿 cookie（重启后 session 失效）**

```bash
curl -s -X POST http://localhost:8080/api/login -H "Content-Type: application/json" -d "{\"name\":\"lorrain\"}" -c "C:/Users/26875/Desktop/Script Studio/cookies.txt"
```
Expected: `{"ok": true, "name": "lorrain", "isAdmin": true}`

- [ ] **Step 3: 验证 users 查询**

```bash
curl -s http://localhost:8080/api/users -b "C:/Users/26875/Desktop/Script Studio/cookies.txt"
```
Expected: `{"ok": true, "admins": ["lorrain"], "members": ["lorrain"]}`

- [ ] **Step 4: 验证添加成员**

```bash
curl -s -X POST http://localhost:8080/api/user -H "Content-Type: application/json" -b "C:/Users/26875/Desktop/Script Studio/cookies.txt" -d "{\"name\":\"陈德基\"}"
```
Expected: `{"ok": true, "members": ["lorrain", "陈德基"]}`

确认 users.json 落地：
```bash
curl -s "http://localhost:8080/workspace/data/users.json?t=1"
```
Expected: `members` 含「陈德基」

- [ ] **Step 5: 验证陈德基现在能登录**

```bash
curl -s -X POST http://localhost:8080/api/login -H "Content-Type: application/json" -d "{\"name\":\"陈德基\"}"
```
Expected: `{"ok": true, "name": "陈德基", "isAdmin": false}`

- [ ] **Step 6: 验证删除成员**

```bash
curl -s -X DELETE "http://localhost:8080/api/user?name=%E9%99%88%E5%BE%B7%E5%9F%BA" -b "C:/Users/26875/Desktop/Script Studio/cookies.txt"
```
（`%E9%99%88%E5%BE%B7%E5%9F%BA` 是「陈德基」的 URL 编码）
Expected: `{"ok": true, "members": ["lorrain"]}`

- [ ] **Step 7: 验证 lorrain 不可删**

```bash
curl -s -X DELETE "http://localhost:8080/api/user?name=lorrain" -b "C:/Users/26875/Desktop/Script Studio/cookies.txt"
```
Expected: `{"ok": false, "error": "cannot remove lorrain"}`（HTTP 400）

- [ ] **Step 8: 清理 cookies.txt，Commit**

```bash
rm -f "C:/Users/26875/Desktop/Script Studio/cookies.txt"
git -C "C:/Users/26875/Desktop/Script Studio" add workspace/server.py workspace/data/users.json
git -C "C:/Users/26875/Desktop/Script Studio" commit -m "feat(workspace): /api/users+user增删（admin）"
```

---

## Task 5: store.js 改造（无 FSA 时走 API）

**Files:**
- Modify: `workspace/js/store.js`

- [ ] **Step 1: 替换 admin 身份相关函数**

找到 `store.js` 里 `getAdmins` / `isAdmin` / `addAdmin` 这一段（约 53-65 行），整段替换为：

```js
/* ---------- 管理员身份：服务端 /api/login 下发，存 localStorage ---------- */
const ADMIN_KEY = 'ss_is_admin';
export function isAdmin() {
  // lorrain 兜底：未登录过且昵称是 lorrain 时视为 admin（保证 server 未起时的本地可用性）
  const op = getOperator();
  if (op === 'lorrain' && localStorage.getItem(ADMIN_KEY) === null) return true;
  return localStorage.getItem(ADMIN_KEY) === '1';
}
export function setAdminFromServer(v) {
  localStorage.setItem(ADMIN_KEY, v ? '1' : '0');
}
```

- [ ] **Step 2: 改 loadProject——移除 IndexedDB draft 读取（API 模式以服务器为准）**

把 `loadProject` 函数替换为：

```js
export async function loadProject(title) {
  if (projectCache.has(title)) return projectCache.get(title);
  const txt = await readText('data/' + title + '.json');  // readText 无 dirHandle 时 fetch 已带 ?t= 防缓存
  const data = JSON.parse(txt);
  projectCache.set(title, data);
  return data;
}
```

- [ ] **Step 3: 改 loadProjectList——移除 indexCache（多用户场景要新鲜度）**

把 `loadProjectList` 函数替换为：

```js
export async function loadProjectList() {
  try {
    const txt = await readText('data/index.json');  // readText 已带 ?t= 防缓存
    return (JSON.parse(txt).projects) || [];
  } catch {
    return [];
  }
}
```
同时删除 `let indexCache = null;` 那一行（约 133 行）。

- [ ] **Step 4: 改 saveProject——无 dirHandle 时走 /api/save**

把 `saveProject` 函数替换为：

```js
export async function saveProject(data) {
  data.meta.updated = nowIso();
  const title = data.meta.title;
  projectCache.set(title, data);  // 内存缓存始终更新
  if (dirHandle) {
    // localhost 运营者：FSA 直写（不变）
    try {
      await writeText('data/' + title + '.json', JSON.stringify(data, null, 2));
      const list = await loadProjectList();
      const sum = projectSummary(data);
      const i = list.findIndex(p => p.title === title);
      if (i >= 0) list[i] = sum; else list.push(sum);
      await saveIndex(list);
    } catch (e) {
      if (e.message !== 'NO_DIR') throw e;
      await idbSet('draft_' + title, data);
    }
  } else {
    // 手机/成员：走 API
    const res = await fetch('/api/save', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.status === 409) {
      const r = await res.json();
      if (r.server) { projectCache.set(title, r.server); }
      throw new Error('STALE');  // 交由调用方处理刷新
    }
    if (res.status === 401) throw new Error('NO_SESSION');
    if (!res.ok) throw new Error('保存失败(' + res.status + ')');
    const r = await res.json();
    data.meta.updated = r.updated;  // 用服务器接管的时间
  }
  return data;
}
```

> 注：`STALE` / `NO_SESSION` 错误的 UI 处理在 review.js / design.js 的调用点（或 Task 6 的 app 层兜底）。本任务只改 store。

- [ ] **Step 5: 浏览器验证（localhost，FSA 模式应仍正常）**

打开 `http://localhost:8080/workspace/`，以 lorrain 登录，进入「吃苦卖命」审核页，采纳一条建议。
Expected: 正常保存（FSA 模式，data/吃苦卖命.json 更新），无报错。

- [ ] **Step 6: 浏览器验证（API 模式：用非 localhost 或关闭 FSA）**

最简：用手机/另一浏览器访问公网 URL（cloudflared），以 lorrain 登录，进入一篇文案改一条决定。
Expected: 改完自动保存，无报错；电脑端刷新能看到该改动（data/*.json 已更新）。
若暂无公网：在电脑 Chrome 开无痕窗口（无 FSA 授权即 API 模式）登录 lorrain 验证同样流程。

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/26875/Desktop/Script Studio" add workspace/js/store.js
git -C "C:/Users/26875/Desktop/Script Studio" commit -m "feat(workspace): store.js 无FSA时走 /api/save 同步"
```

---

## Task 6: app.js 改造（登录走 /api/login、boot 走 /api/me、未授权拒绝、错误兜底）

**Files:**
- Modify: `workspace/js/app.js`

- [ ] **Step 1: 改 boot——先 /api/me 恢复登录态**

把 `boot` 函数末尾的登录判断段：
```js
  if (localStorage.getItem('ss_operator')) {
    showOperator(store.getOperator());
    route();
  } else {
    openLogin({ mode: 'first' });
  }
```
替换为：
```js
  // 先尝试凭 cookie 恢复登录态（server 重启后 cookie 失效会回到登录）
  let me = null;
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) me = await res.json();
  } catch { /* server 未起：me 为 null，落到本地 lorrain 兜底 */ }
  if (me && me.ok) {
    store.setOperator(me.name);
    store.setAdminFromServer(me.isAdmin);
    showOperator(me.name);
    applyAdminUI();
    route();
  } else if (localStorage.getItem('ss_operator')) {
    // server 不可用时的本地兜底（仅 lorrain 能进，isAdmin 兜底为 true）
    showOperator(store.getOperator());
    applyAdminUI();
    route();
  } else {
    openLogin({ mode: 'first' });
  }
```

- [ ] **Step 2: 改 openLogin 的 ok()——走 /api/login，未授权拒绝**

把 `openLogin` 里的 `const ok = () => { ... };` 整个函数替换为：

```js
  const ok = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    try {
      const res = await fetch('/api/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.status === 403) {
        sub.textContent = '未授权——联系 lorrain 把你的昵称加入白名单';
        input.select();
        return;
      }
      if (!res.ok) throw new Error('登录失败(' + res.status + ')');
      const r = await res.json();
      store.setOperator(name);
      store.setAdminFromServer(r.isAdmin);
      showOperator(name);
      ov.classList.remove('on');
      applyAdminUI();
      utils.toast(mode === 'first' ? '欢迎，' + name : '已切换为 ' + name);
      route();
    } catch (e) {
      sub.textContent = '登录失败：' + e.message + '（服务器是否已启动？）';
    }
  };
```

- [ ] **Step 3: 加全局 save 错误兜底（处理 store 抛的 STALE/NO_SESSION）**

在 `boot` 函数内、`route()` 首次调用之前，加一个全局错误监听。在 `window.addEventListener('hashchange', route);` 这行下方插入：

```js
  // store.saveProject 在 API 模式下可能抛 STALE / NO_SESSION，统一兜底
  window.addEventListener('unhandledaction', () => {});
```
此行仅为占位提醒——真正的兜底放在各 save 调用点的 catch（review.js/design.js 已有 try/catch 包裹 save）。若调用点未处理，在此追加：
```js
  window.addEventListener('unhandledrejection', e => {
    const msg = (e.reason && e.reason.message) || '';
    if (msg === 'STALE') {
      utils.toast('该文案已被别人更新，正在刷新…');
      setTimeout(() => location.reload(), 800);
      e.preventDefault();
    } else if (msg === 'NO_SESSION') {
      utils.toast('登录已过期，请重新登录');
      openLogin({ mode: 'switch' });
      e.preventDefault();
    }
  });
```
（把这段实际加进去，删掉上面那行占位。）

- [ ] **Step 4: 浏览器验证——未授权拒绝**

清浏览器 cookie（或无痕窗口），访问 `http://localhost:8080/workspace/`，登录框输「hacker」点进入。
Expected: 不进工作台，提示「未授权——联系 lorrain 把你的昵称加入白名单」。

- [ ] **Step 5: 浏览器验证——成员登录正常**

输「lorrain」登录。
Expected: 正常进入，看到审核台/设计台。

- [ ] **Step 6: 浏览器验证——刷新保持登录**

登录后刷新页面。
Expected: 不弹登录框，直接恢复（凭 /api/me cookie）。

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/26875/Desktop/Script Studio" add workspace/js/app.js
git -C "C:/Users/26875/Desktop/Script Studio" commit -m "feat(workspace): app.js 登录走 /api/login+/api/me，未授权拒绝"
```

---

## Task 7: admin.js 后台成员管理 + base.css 样式

**Files:**
- Modify: `workspace/js/admin.js`
- Modify: `workspace/css/base.css`

- [ ] **Step 1: admin.js 加载白名单并渲染成员管理区块**

在 `admin.js` 顶部 import 区下方加一个加载函数（在 `renderAdmin` 之前）：

```js
async function loadMembers() {
  try {
    const res = await fetch('/api/users', { credentials: 'include' });
    if (!res.ok) return null;
    const r = await res.json();
    return r.ok ? r : null;
  } catch { return null; }
}
```

- [ ] **Step 2: 在 renderAdmin 里插入成员管理区块**

在 `renderAdmin` 函数内，把：
```js
  const [activity, projects] = await Promise.all([store.loadAllActivity(), store.loadProjectList()]);
```
改为：
```js
  const [activity, projects, users] = await Promise.all([store.loadAllActivity(), store.loadProjectList(), loadMembers()]);
```

然后在 `main.innerHTML = ` 模板里，紧跟 `<div class="admin-head">...</div>` 之后、`${stat}` 之前，插入成员管理 section：
```js
  const membersHtml = users ? `
    <div class="admin-section">
      <div class="admin-sec-title">👥 成员管理（白名单 ${users.members.length}）</div>
      <div class="admin-members">
        ${users.members.map(m => `
          <div class="admin-member">
            ${utils.operatorAvatar(m)}
            <span class="am-name">${utils.esc(m)}${users.admins.includes(m) ? ' <span class="am-admin">管理员</span>' : ''}</span>
            ${m === 'lorrain' ? '' : `<button class="btn ghost am-del" data-name="${utils.escAttr(m)}">移除</button>`}
          </div>`).join('')}
      </div>
      <div class="admin-add">
        <input id="newMemberInput" class="search" placeholder="输入昵称添加到白名单" autocomplete="off">
        <button class="btn primary" id="addMemberBtn">添加</button>
      </div>
    </div>` : '';
```

并在模板里 `${stat}` 后面插入 `${membersHtml}`。

最后在 `main.innerHTML = ...` 赋值之后，绑定成员管理事件（在函数末尾、`}` 之前）：
```js
  // 成员管理事件
  const addBtn = main.querySelector('#addMemberBtn');
  const addInput = main.querySelector('#newMemberInput');
  if (addBtn) {
    const addMember = async () => {
      const name = addInput.value.trim();
      if (!name) return;
      try {
        const res = await fetch('/api/user', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        if (res.ok) { utils.toast('已添加：' + name); renderAdmin(main); }
        else utils.toast('添加失败(' + res.status + ')');
      } catch (e) { utils.toast('添加失败：' + e.message); }
    };
    addBtn.onclick = addMember;
    addInput.onkeydown = e => { if (e.key === 'Enter') addMember(); };
  }
  main.querySelectorAll('.am-del').forEach(b => {
    b.onclick = async () => {
      const name = b.dataset.name;
      try {
        const res = await fetch('/api/user?name=' + encodeURIComponent(name), { method: 'DELETE', credentials: 'include' });
        if (res.ok) { utils.toast('已移除：' + name); renderAdmin(main); }
        else utils.toast('移除失败(' + res.status + ')');
      } catch (e) { utils.toast('移除失败：' + e.message); }
    };
  });
```

- [ ] **Step 3: base.css 加成员管理样式**

在 `base.css` 末尾追加：

```css
/* 成员管理 */
.admin-members { display: flex; flex-direction: column; gap: 6px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 8px; }
.admin-member { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px; }
.admin-member:hover { background: #f2f3f5; }
.admin-member .am-name { flex: 1; font-size: 14px; }
.admin-member .am-admin { font-size: 11px; color: var(--accent); }
.admin-member .am-del { padding: 3px 10px; font-size: 12px; }
.admin-add { display: flex; gap: 8px; margin-top: 10px; }
.admin-add .search { flex: 1; }
```

- [ ] **Step 4: 浏览器验证——后台成员管理**

以 lorrain 登录，进「管理员后台」。
Expected: 看到「👥 成员管理」区块，列出 lorrain（管理员，无移除按钮）。

在输入框输「陈德基」点添加。
Expected: 列表出现「陈德基」（有移除按钮），toast「已添加：陈德基」，users.json 更新。

点「陈德基」的移除。
Expected: 列表移除，toast「已移除：陈德基」。

- [ ] **Step 5: 浏览器验证——非 admin 看不到后台**

以非 admin 成员登录（先用 lorrain 在后台加一个「测试员」，再退出以「测试员」登录）。
Expected: 侧栏无「管理员后台」入口；手动改 URL `#admin` 也被重定向（现有逻辑）。

验证后用 lorrain 把「测试员」移除，恢复白名单为 `["lorrain"]`。

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/26875/Desktop/Script Studio" add workspace/js/admin.js workspace/css/base.css
git -C "C:/Users/26875/Desktop/Script Studio" commit -m "feat(workspace): 管理员后台成员管理（白名单增删）"
```

---

## Task 8: 端到端验证 + 启动方式文档更新

**Files:**
- Modify: `CLAUDE.md`（运行方式段）
- Modify: skill `script-review` 的启动提示（`C:/Users/26875/.claude/skills/script-review/SKILL.md` 第 5 步）

- [ ] **Step 1: 端到端验证（公网手机）**

启动 server.py + cloudflared：
```bash
python "C:/Users/26875/Desktop/Script Studio/workspace/server.py"   # 终端1
"E:/cloudflared.exe" tunnel --url http://localhost:8080              # 终端2
```
手机用系统浏览器打开 trycloudflare URL `/workspace/`。
- 以 lorrain 登录 → 进工作台 ✓
- 进一篇文案改一条决定 → 电脑端 data/*.json 立即出现改动 ✓
- 电脑端刷新看到改动 ✓
- 在后台加一个成员 → 手机用该成员名登录可用 ✓

- [ ] **Step 2: 更新 CLAUDE.md 运行方式**

把 `CLAUDE.md` 里：
```bash
cd "C:\Users\26875\Desktop\Script Studio"
python -m http.server 8080
```
改为：
```bash
cd "C:\Users\26875\Desktop\Script Studio"
python workspace/server.py
```
并在「内网穿透后…」那条下面补一句说明协作模式变化：白名单成员改完自动同步，无需导出 JSON。

- [ ] **Step 3: 更新 script-review skill 的启动提示**

编辑 `C:/Users/26875/.claude/skills/script-review/SKILL.md`，把第 5 步告知用户的命令块里：
```
python -m http.server 8080
```
改为：
```
python workspace/server.py
```

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/26875/Desktop/Script Studio" add CLAUDE.md
git -C "C:/Users/26875/Desktop/Script Studio" commit -m "docs(workspace): 运行方式改 server.py + 协作模式说明"
```
（skill 文件在 ~/.claude/ 下，不在本仓库，无需 git。）

---

## Self-Review（写计划后自查）

**1. Spec 覆盖：**
- 静态分发 + 4 类 API（login/me/save/users + user 增删）→ Task 1-4 ✓
- store.js 无 FSA 走 API、LWW 409 处理、移除 IndexedDB draft、admin 服务端下发 → Task 5 ✓
- app.js 登录接 /api/login、boot /api/me、未授权拒绝 → Task 6 ✓
- admin.js 成员管理 → Task 7 ✓
- 启动方式文档 → Task 8 ✓
- LWW + server 接管时间 → Task 3 Step 3 ✓
- localhost lorrain 保留 FSA → Task 5 Step 4 的 if(dirHandle) 分支 ✓
- lorrain 不可删 → Task 4 Step 7 ✓
- 会话内存重启失效 → Task 1 SESSIONS + Task 6 boot 的 /api/me 恢复 ✓

**2. 占位扫描：** 无 TBD/TODO；Task 6 Step 3 的占位行已明确要求替换为实际 unhandledrejection 代码。✓

**3. 类型/命名一致性：**
- `setAdminFromServer`：Task 5 定义、Task 6 使用 ✓
- 错误码 `STALE` / `NO_SESSION`：Task 5 抛出、Task 6 捕获 ✓
- `session_name` / `cookies` / `_json` / `_read_body`：Task 1 定义、Task 2-4 使用 ✓
- `update_index`：Task 3 Step 2 定义、Step 3 使用 ✓
- index summary 字段（title/stage/updated/shotCount/reviewItemCount）与 store.js `projectSummary` 完全一致 ✓

**4. 已知风险（非阻塞）：**
- 前端无单测，验证靠浏览器手动；关键路径（登录/保存/冲突）已在各 Task 的验证步骤覆盖。
- server.py 重启后所有 session 失效，成员需重登——spec 已确认可接受。
- LWW 并发丢修改——spec 已确认少数人可接受。
