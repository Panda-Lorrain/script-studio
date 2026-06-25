# workspace/scripts/scan-assets.py
# 扫描 ../../Material Collection/ 生成 ../assets.json
# 文件名格式：编号_构图_描述.扩展名  （如 01_全身_哭.png）
# 文件夹名格式：编号_分类  （如 01_悲伤）
#
# 同时为每张原图生成压缩缩略图（长边 600px / JPEG q72），落到 ../assets-thumb/
# 前端 preloadAssets 只下载缩略图（~35KB/张），不拉原图（2MB+/张），预加载快约 60 倍。
# 缩略图随原图 mtime 失效：图被替换即自动重生，配合 assets.json 的 mtime 字段语义。
import os
import json
import sys

CAT_MAP = {
    '01': '悲伤', '02': '愤怒', '03': '懵圈无力',
    '04': '打工人', '05': '开心', '06': '转场特效'
}

MAX_SIDE = 600      # 缩略图长边
JPEG_QUALITY = 72   # JPEG 质量

# --no-thumb：跳过缩略图生成，仅刷新清单（无 Pillow / 临时环境用）
NO_THUMB = '--no-thumb' in sys.argv

try:
    from PIL import Image
except ImportError:
    Image = None


def make_thumb(src_path, thumb_path):
    """生成缩略图。返回 True=新生成，False=跳过（已存在且新于原图）。"""
    src_mtime = os.path.getmtime(src_path)
    # 增量：缩略图已存在且 mtime ≥ 原图 → 跳过
    if os.path.exists(thumb_path) and os.path.getmtime(thumb_path) >= src_mtime:
        return False
    os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
    with Image.open(src_path) as im:
        im.load()
        # 缩放：长边 ≤ MAX_SIDE，小图不放大
        w, h = im.size
        scale = MAX_SIDE / max(w, h)
        if scale < 1:
            new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
            im = im.resize(new_size, Image.LANCZOS)
        # PNG 透明背景转白底，避免透明区变黑
        if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
            im = im.convert('RGBA')
            bg = Image.new('RGB', im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[3])
            im = bg
        else:
            im = im.convert('RGB')
        im.save(thumb_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
    # 把缩略图 mtime 对齐原图，保证「缩略图 mtime ≥ 原图 mtime」判定稳定
    os.utime(thumb_path, (src_mtime, src_mtime))
    return True


def main():
    if not NO_THUMB and Image is None:
        print('错误：缩略图生成需要 Pillow，请先安装：pip install pillow', file=sys.stderr)
        print('（或用 --no-thumb 仅刷新清单，不生成缩略图）', file=sys.stderr)
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.dirname(script_dir)
    repo_root = os.path.dirname(workspace_dir)
    mat_dir = os.path.join(repo_root, 'Material Collection')
    thumb_root = os.path.join(workspace_dir, 'assets-thumb')

    if not os.path.isdir(mat_dir):
        print('错误：找不到 Material Collection 目录：' + mat_dir, file=sys.stderr)
        sys.exit(1)

    assets = []
    gen_cnt = 0
    skip_cnt = 0
    for folder in sorted(os.listdir(mat_dir)):
        folder_path = os.path.join(mat_dir, folder)
        if not os.path.isdir(folder_path):
            continue
        # 文件夹名解析：编号_分类
        folder_parts = folder.split('_', 1)
        cat = folder_parts[1] if len(folder_parts) > 1 else CAT_MAP.get(folder_parts[0], folder)

        for fname in sorted(os.listdir(folder_path)):
            if not fname.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                continue
            # 文件名解析：编号_构图_描述.扩展名
            name_no_ext = os.path.splitext(fname)[0]
            parts = name_no_ext.split('_', 2)
            if len(parts) < 3:
                print('跳过（命名不符）：' + fname, file=sys.stderr)
                continue
            aid, framing, desc = parts[0], parts[1], parts[2]
            src_path = os.path.join(folder_path, fname)

            entry = {
                'id': aid,
                'file': fname,
                'folder': folder,
                'cat': cat,
                'action': '',
                'framing': framing,
                'state': '',
                'prop': '',
                'desc': desc,
                # 文件修改时间戳：前端 preloadAssets 据此作缓存 key，图被替换(mtime 变)时自动重新下载
                'mtime': int(os.path.getmtime(src_path))
            }

            if not NO_THUMB:
                # 缩略图路径：assets-thumb/<folder>/<原文件名去扩展>.jpg
                thumb_rel = 'assets-thumb/' + folder + '/' + name_no_ext + '.jpg'
                thumb_path = os.path.join(workspace_dir, thumb_rel.replace('/', os.sep))
                try:
                    if make_thumb(src_path, thumb_path):
                        gen_cnt += 1
                    else:
                        skip_cnt += 1
                    entry['thumb'] = thumb_rel
                except Exception as e:
                    print('缩略图生成失败（跳过该图缩略图，前端回退原图）：' + fname + ' -> ' + str(e), file=sys.stderr)

            assets.append(entry)

    out_path = os.path.join(workspace_dir, 'assets.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(assets, f, ensure_ascii=False, indent=2)

    print('已生成 ' + out_path)
    print('共 ' + str(len(assets)) + ' 个素材')
    if not NO_THUMB:
        print('缩略图：新生成 ' + str(gen_cnt) + '，跳过 ' + str(skip_cnt) + '（已最新）')


if __name__ == '__main__':
    main()
