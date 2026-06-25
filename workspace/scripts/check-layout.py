#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
workspace/scripts/check-layout.py
电脑端审核台布局回归自检 —— 改 review.css 或手机端后跑这个，确认电脑端三区仍各自
内部滚动、整页不滚。只用标准库（subprocess/re/json），系统 python 即可，无需 pip。

用法：  python workspace/scripts/check-layout.py
退出码：0=通过，1=布局被破坏，2=环境/脚本自身问题
"""
import subprocess, re, json, sys, os, html

# 浏览器候选（按优先级），找不到自行加一条
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "layout-fixture.html")
URL = "file:///" + FIX.replace("\\", "/").replace(" ", "%20")


def find_browser():
    for p in BROWSERS:
        if os.path.isfile(p):
            return p
    return None


def main():
    exe = find_browser()
    if not exe:
        print("✗ 找不到 Edge/Chrome，请在 BROWSERS 里加一条路径"); sys.exit(2)
    if not os.path.isfile(FIX):
        print("✗ 夹具不存在:", FIX); sys.exit(2)

    try:
        r = subprocess.run(
            [exe, "--headless=new", "--disable-gpu", "--force-device-scale-factor=1",
             "--window-size=1440,900", "--dump-dom", "--virtual-time-budget=2500", URL],
            capture_output=True, text=True, timeout=60
        )
    except subprocess.TimeoutExpired:
        print("✗ 浏览器超时"); sys.exit(2)

    m = re.search(r"LAYOUTCHECK(\{.*?\})", r.stdout)
    if not m:
        print("✗ 没拿到测量数据（浏览器可能没执行 JS）。stdout 片段：")
        print(r.stdout[:400]); sys.exit(2)

    d = json.loads(html.unescape(m.group(1)))  # title 里的 " 被 dump-dom 转义成 &quot;，先反转义
    print("== 电脑端审核台布局自检（viewport %dx%d, isMobile=%s）==" % (d["vw"], d["vh"], d["isMobile"]))
    for k in ["main", "wrap", "grid", "panelOrig", "revOrig", "panelOut", "outHead", "revOut", "panelItems", "revItems"]:
        print("  %-11s %s" % (k, d[k]))
    print("  overflowY:  revOrig=%s revOut=%s revItems=%s" % (d["revOrigOv"], d["revOutOv"], d["revItemsOv"]))
    print("")

    if d["isMobile"]:
        print("✗ 视口被判为手机端（isMobile=true），无法验证电脑端布局。")
        print("  多半是浏览器的 --window-size=1440,900 没生效，或 base.css 断点变了。"); sys.exit(2)

    fails = []

    def chk(cond, msg):
        print(("  ✓ " if cond else "  ✗ ") + msg)
        if not cond:
            fails.append(msg)

    chk(d["main"] <= 850,
        ".main 不撑破视口（main=%d <= 850，否则整页被内容撑开）" % d["main"])
    chk(d["revOut"] >= 150,
        "输出框被拉伸（revOut=%d >= 150，否则塌成两行半）" % d["revOut"])
    chk(d["panelOrig"] <= d["grid"] + 5,
        "原文区不溢出 grid（panelOrig=%d <= grid=%d）" % (d["panelOrig"], d["grid"]))
    chk(d["panelItems"] <= d["grid"] + 5,
        "采纳区不溢出 grid（panelItems=%d <= grid=%d）" % (d["panelItems"], d["grid"]))
    chk(d["revOrigOv"] == "auto" and d["revOutOv"] == "auto" and d["revItemsOv"] == "auto",
        "三区均 overflow:auto（各自内部滚动，整页不滚）")

    print("")
    if fails:
        print("❌ %d 项失败 —— 电脑端布局被破坏，别提交！常见元凶：" % len(fails))
        print("   .review-grid 的 align-items 被改回 start / 约束链某环缺失。见 review.css 顶部契约。")
        sys.exit(1)
    print("✅ 全部通过，电脑端布局正常。")
    sys.exit(0)


if __name__ == "__main__":
    main()
