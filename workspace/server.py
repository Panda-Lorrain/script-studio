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

    # ---- API（Task 2-4 填充）----
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


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Script Studio workspace server on http://0.0.0.0:{PORT}/  (site root: {SITE_ROOT})')
    srv.serve_forever()
