"""HTML for the demo shop "ひだまり雑貨店" and AgentGuard's block / maintenance pages.

Everything user-supplied is escaped: the demo site itself must not be vulnerable.
"""

from __future__ import annotations

from html import escape

PRODUCTS = [
    ("🍵", "まあるい湯のみ", 1800, "手にやさしくなじむ、ころんとした形の湯のみ。"),
    ("☕", "朝のマグカップ", 2200, "たっぷり入る大きめサイズ。青と白の2色。"),
    ("🕯️", "ひだまりキャンドル", 1500, "ほんのり柑橘の香り。燃焼時間は約20時間。"),
    ("🧺", "編みかご（中）", 3400, "職人の手編み。小物やパンを入れて。"),
    ("📓", "手帳ノート", 980, "やわらかい紙で書き心地なめらか。"),
    ("🌿", "ドライフラワーの束", 2600, "季節の草花を束ねました。そのまま飾れます。"),
]

_CSS = """
:root{--bg:#F6F8FC;--card:#FFFFFF;--ink:#0F172A;--muted:#64748B;--line:#E2E8F0;
--brand:#4F46E5;--brand2:#06B6D4;--safe:#10B981;--warn:#F59E0B;--danger:#F43F5E}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic UI",system-ui,sans-serif;line-height:1.7}
a{color:var(--brand)}header{background:var(--card);border-bottom:1px solid var(--line)}
.wrap{max-width:960px;margin:0 auto;padding:16px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.logo{font-weight:800;font-size:20px;text-decoration:none;color:var(--ink)}
nav a{margin-left:14px;text-decoration:none;color:var(--muted);font-size:14px}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--brand);
background:#EEF2FF;border-radius:999px;padding:4px 10px}
.hero{margin:24px 0;padding:28px;border-radius:20px;color:#fff;
background:linear-gradient(120deg,var(--brand),var(--brand2))}
.hero h1{margin:0 0 6px;font-size:26px}form.search{display:flex;gap:8px;margin-top:14px}
input,textarea{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;font:inherit}
button{padding:12px 18px;border:0;border-radius:12px;background:var(--ink);color:#fff;font:inherit;cursor:pointer;white-space:nowrap;flex-shrink:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px}
.emoji{font-size:38px}.price{font-weight:700}.muted{color:var(--muted);font-size:14px}
.panel{max-width:560px;margin:48px auto;background:var(--card);border:1px solid var(--line);
border-radius:24px;padding:32px;text-align:center}
.shield{width:72px;height:72px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;font-size:34px}
code{background:#F1F5F9;border-radius:6px;padding:2px 6px;font-size:13px;word-break:break-all}
footer{color:var(--muted);font-size:12px;text-align:center;padding:24px}
"""


def _page(title: str, body: str, site_id: str | None = None) -> str:
    base = f"/s/{escape(site_id)}" if site_id else ""
    nav = (
        f'<nav><a href="{base}/">商品</a><a href="{base}/login">ログイン</a>'
        f'<a href="{base}/contact">お問い合わせ</a></nav>'
        if site_id
        else ""
    )
    return f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)}</title><style>{_CSS}</style></head><body>
<header><div class="wrap top"><a class="logo" href="{base}/">🌼 ひだまり雑貨店</a>{nav}
<span class="badge">🛡️ AgentGuard が見守っています（デモサイト）</span></div></header>
<main class="wrap">{body}</main>
<footer>これは AgentGuard のデモ用の架空のお店です。実際の販売は行っていません。</footer>
</body></html>"""


def _product_cards(items) -> str:
    return "".join(
        f'<div class="card"><div class="emoji">{e}</div><b>{escape(n)}</b>'
        f'<div class="muted">{escape(d)}</div><div class="price">¥{p:,}</div></div>'
        for e, n, p, d in items
    )


def home(site_id: str) -> str:
    body = f"""<section class="hero"><h1>日々に、ひだまりを。</h1>
<div>手しごとの器や雑貨をお届けする小さなお店です。</div>
<form class="search" action="/s/{escape(site_id)}/search" method="get">
<input name="q" placeholder="商品をさがす（例：マグカップ）" aria-label="商品検索">
<button>検索</button></form></section>
<div class="grid">{_product_cards(PRODUCTS)}</div>
<p class="muted">カタログ（PDF）は <a href="/s/{escape(site_id)}/files?name=catalog.pdf">こちら</a></p>"""
    return _page("ひだまり雑貨店", body, site_id)


def search(site_id: str, q: str) -> str:
    hits = [p for p in PRODUCTS if q and (q in p[1] or q in p[3])]
    result = (
        f'<div class="grid">{_product_cards(hits)}</div>'
        if hits
        else '<p class="muted">該当する商品は見つかりませんでした。</p>'
    )
    body = f'<h2>「{escape(q)}」の検索結果</h2>{result}<p><a href="/s/{escape(site_id)}/">← 商品一覧へ</a></p>'
    return _page("検索結果 | ひだまり雑貨店", body, site_id)


def login(site_id: str, failed: bool = False) -> str:
    note = '<p style="color:var(--danger)">メールアドレスまたはパスワードが違います（デモ）。</p>' if failed else ""
    body = f"""<div class="panel"><h2>ログイン</h2>{note}
<form method="post" action="/s/{escape(site_id)}/login">
<p><input name="email" placeholder="メールアドレス" autocomplete="off"></p>
<p><input name="password" type="password" placeholder="パスワード"></p>
<button>ログイン</button></form></div>"""
    return _page("ログイン | ひだまり雑貨店", body, site_id)


def contact(site_id: str, sent_message: str | None = None) -> str:
    if sent_message is not None:
        inner = f'<h2>送信しました</h2><p class="muted">お問い合わせ内容（デモのため保存されません）：</p><p><code>{escape(sent_message[:500])}</code></p>'
    else:
        inner = f"""<h2>お問い合わせ</h2><form method="post" action="/s/{escape(site_id)}/contact">
<p><input name="name" placeholder="お名前"></p>
<p><textarea name="message" rows="5" placeholder="お問い合わせ内容"></textarea></p>
<button>送信する</button></form>"""
    return _page("お問い合わせ | ひだまり雑貨店", f'<div class="panel">{inner}</div>', site_id)


def files(site_id: str, name: str) -> str:
    body = f'<div class="panel"><h2>ダウンロード</h2><p class="muted"><code>{escape(name)}</code> は準備中です（デモ）。</p></div>'
    return _page("ダウンロード | ひだまり雑貨店", body, site_id)


def not_found(site_id: str | None) -> str:
    return _page("ページが見つかりません", '<div class="panel"><h2>ページが見つかりません</h2></div>', site_id)


def blocked_by_waf(label_ja: str, event_id: str) -> str:
    body = f"""<div class="panel"><div class="shield" style="background:#FFE4E6">🛡️</div>
<h2>AgentGuard がこのアクセスを止めました</h2>
<p>理由：{escape(label_ja)}の疑い</p>
<p class="muted">AIチームが詳しく調べています。心当たりがない場合は、時間をおいて再度お試しください。</p>
<p class="muted">参照ID：<code>{escape(event_id)}</code></p></div>"""
    return _page("アクセスがブロックされました", body)


def blocked_by_list(reason: str, until_text: str) -> str:
    body = f"""<div class="panel"><div class="shield" style="background:#FFE4E6">⛔</div>
<h2>このIPアドレスは一時的にブロックされています</h2>
<p>{escape(reason)}</p><p class="muted">解除予定：{escape(until_text)}</p></div>"""
    return _page("アクセスがブロックされました", body)


def maintenance() -> str:
    body = """<div class="panel"><div class="shield" style="background:#FEF3C7">🧰</div>
<h2>ただいまメンテナンス中です</h2>
<p class="muted">安全のため、AgentGuard がサイトを一時停止しています。しばらくお待ちください。</p></div>"""
    return _page("メンテナンス中", body)
