# workspace/scripts/scan-assets.py
# 扫描 ../../Material Collection/ 生成 ../assets.json
# 文件名格式：编号_构图_描述.扩展名  （如 01_全身_哭.png）
# 文件夹名格式：编号_分类  （如 01_悲伤）
import os
import json
import sys

CAT_MAP = {
    '01': '悲伤', '02': '愤怒', '03': '懵圈无力',
    '04': '打工人', '05': '开心', '06': '转场特效'
}

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.dirname(script_dir)
    repo_root = os.path.dirname(workspace_dir)
    mat_dir = os.path.join(repo_root, 'Material Collection')

    if not os.path.isdir(mat_dir):
        print('错误：找不到 Material Collection 目录：' + mat_dir, file=sys.stderr)
        sys.exit(1)

    assets = []
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
            assets.append({
                'id': aid,
                'file': fname,
                'folder': folder,
                'cat': cat,
                'action': '',
                'framing': framing,
                'state': '',
                'prop': '',
                'desc': desc
            })

    out_path = os.path.join(workspace_dir, 'assets.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(assets, f, ensure_ascii=False, indent=2)

    print('已生成 ' + out_path)
    print('共 ' + str(len(assets)) + ' 个素材')

if __name__ == '__main__':
    main()
