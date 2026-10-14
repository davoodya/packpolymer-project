#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build: محتوای فازها + CSS + JS + فونت وزیر (base64) را در یک Single HTML File می‌چسباند.
اجرا:  python3 work/build.py
خروجی: /home/user/wordpress-polymer-store-roadmap.html
"""
import base64, os, sys, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
P = lambda *a: os.path.join(ROOT, *a)
OUT = "/home/user/packpolymer-marketplace-roadmap.html"

def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

def b64(p):
    with open(p, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")

css = read(P("parts", "app_css.txt"))
css = css.replace("__FONT_REGULAR__", b64(P("fonts", "Vazir-Regular.woff2")))
css = css.replace("__FONT_MEDIUM__",  b64(P("fonts", "Vazir-Medium.woff2")))
css = css.replace("__FONT_BOLD__",    b64(P("fonts", "Vazir-Bold.woff2")))

plan = "\n".join(read(P("parts", f)) for f in ("plan_a.js", "plan_b.js", "plan_c.js", "plan_d.js", "plan_e.js"))
js = read(P("parts", "app_js.txt"))
shell = read(P("parts", "shell.html"))

html = (shell.replace("/*__CSS__*/", css)
             .replace("/*__PLAN__*/", plan)
             .replace("/*__JS__*/", js))

# بررسی سلامت
for token in ("__FONT_REGULAR__", "__FONT_MEDIUM__", "__FONT_BOLD__", "/*__CSS__*/", "/*__PLAN__*/", "/*__JS__*/", "/*__C"):
    if token in html:
        print("WARN: placeholder باقی مانده:", token, file=sys.stderr)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

size = os.path.getsize(OUT)
print("✅ built:", OUT)
print("   size: %.1f KB" % (size / 1024))
print("   plan chars: %d | js chars: %d | css chars: %d" % (len(plan), len(js), len(css)))
print("   time:", datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
