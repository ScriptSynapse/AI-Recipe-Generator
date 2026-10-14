#!/usr/bin/env python3
"""Rewrites the shared header, footer, stylesheet links and <title> of every
frontend page, so the navigation is identical everywhere. Idempotent; run
from the repository root after adding or renaming a page."""
import re, pathlib

PAGES = {  # file: (title, active nav href or None)
    'index.html': ('Dashboard', 'index.html'),
    'generator.html': ('Generate', 'generator.html'),
    'results.html': ('Recipe', 'generator.html'),
    'recipes.html': ('My Recipes', 'recipes.html'),
    'ai-lab.html': ('AI Model Lab', 'ai-lab.html'),
    'security.html': ('Security Center', 'security.html'),
    'analytics.html': ('Analytics', 'analytics.html'),
    'settings.html': ('Settings', 'settings.html'),
    'login.html': ('Sign in', None),
}
NAV = [  # label, href, admin-only
    ('Dashboard', 'index.html', False), ('Generate', 'generator.html', False), ('AI Lab', 'ai-lab.html', False),
    ('My Recipes', 'recipes.html', False), ('Security', 'security.html', True), ('Analytics', 'analytics.html', True),
    ('Settings', 'settings.html', False),
]

def header(active):
    items = []
    for label, href, admin in NAV:
        cls = ' class="active" aria-current="page"' if href == active else ''
        li = ' class="admin-only hidden"' if admin else ''
        items.append(f'        <li{li}><a href="{href}"{cls}>{label}</a></li>')
    items.append('        <li id="auth-nav" class="nav-auth"><a href="login.html">Sign in</a></li>')
    return ('<header class="site-header">\n    <nav class="nav" aria-label="Main">\n'
            '      <a href="index.html" class="logo">\n        <span class="logo-mark" aria-hidden="true">S</span>\n'
            '        <span class="logo-text">RecipeAI Sentinel<span class="logo-sub">Secure Multi-LLM Recipe Intelligence Platform</span></span>\n      </a>\n'
            '      <ul class="nav-links">\n' + '\n'.join(items) + '\n      </ul>\n    </nav>\n  </header>')

FOOTER = ('<footer class="site-footer">\n    <div class="container footer-grid">\n'
          '      <div class="logo"><span class="logo-mark" aria-hidden="true">S</span> RecipeAI Sentinel</div>\n'
          '      <p class="footer-note">Secure Multi-LLM Recipe Intelligence Platform &middot; OOP Laboratory project: C++ core, Express API, vanilla JS frontend. <a href="landing.html">About</a></p>\n'
          '    </div>\n  </footer>')

root = pathlib.Path('frontend')
for name, (title, active) in PAGES.items():
    p = root / name
    if not p.exists():
        continue
    s = p.read_text()
    s = re.sub(r'<header class="site-header">.*?</header>', lambda m: header(active), s, flags=re.S)
    s = re.sub(r'<footer class="site-footer">.*?</footer>', lambda m: FOOTER, s, flags=re.S)
    s = re.sub(r'<title>.*?</title>', f'<title>{title} — RecipeAI Sentinel</title>', s, flags=re.S)
    if 'css/sentinel.css' not in s:
        s = s.replace('<link rel="stylesheet" href="css/responsive.css">', '<link rel="stylesheet" href="css/responsive.css">\n  <link rel="stylesheet" href="css/sentinel.css">')
    if 'css/polish.css' not in s:
        s = s.replace('<link rel="stylesheet" href="css/sentinel.css">', '<link rel="stylesheet" href="css/sentinel.css">\n  <link rel="stylesheet" href="css/polish.css">')
    p.write_text(s)
    print('updated', name)
