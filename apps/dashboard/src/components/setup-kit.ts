/**
 * The "setup folder" a site owner downloads: one ZIP with everything needed to connect a site,
 * laid out the way it is used, plus a step-by-step guide page that says exactly where each piece
 * goes for this site's framework and hosting.
 *
 *   agentguard-setup/
 *   ├─ READ_ME_FIRST.html         the guide (open it in a browser)
 *   ├─ files_for_your_site/<file>  copy this into the site's folder
 *   └─ AGENTGUARD_KEY.txt         the connection key line (goes into environment variables, not the site)
 *
 * File names are ASCII on purpose: some unzip tools garble non-ASCII names. The guide is Japanese.
 */

import { INSTALL, type ServerFramework } from "./site-snippets";

export type Host = "vercel" | "cloudrun" | "other";

export const HOSTS: { id: Host; label: string; steps: string[]; publish: string }[] = [
  {
    id: "vercel", label: "Vercel",
    steps: [
      "vercel.com にログインし、このサイトのプロジェクトをクリック",
      "上のメニューの「Settings」→ 左の「Environment Variables」",
      "Key に AGENTGUARD_KEY、Value に接続キーを貼って「Save」",
    ],
    publish: "GitHub に push する（自動で公開し直されます）。push しない場合は Vercel の「Deployments」→ 一番上の「…」→「Redeploy」",
  },
  {
    id: "cloudrun", label: "Cloud Run",
    steps: [
      "Google Cloud コンソールで Cloud Run のサービスを開く",
      "「新しいリビジョンの編集とデプロイ」→「変数とシークレット」",
      "「変数を追加」で 名前 AGENTGUARD_KEY、値 に接続キーを貼って「デプロイ」",
    ],
    publish: "いつもの方法でデプロイし直す（例：gcloud run deploy サービス名 --source .）",
  },
  {
    id: "other", label: "それ以外・自分のPC",
    steps: [
      "サイトのフォルダに、環境変数のファイルを作る（ファイル名は下の「自分のPCで動かす場合」）",
      "接続キーの1行（AGENTGUARD_KEY=…）を貼り付けて保存",
      "このファイルは GitHub などに公開しないでください",
    ],
    publish: "サーバーを再起動する（止めて、もう一度起動する）",
  },
];

/**
 * On your own PC the key goes in a file, but only Next.js reads such a file by itself: Express and
 * FastAPI must be started with the file named, or the key never reaches the code.
 */
export const LOCAL_ENV: Record<ServerFramework, { file: string; start: string }> = {
  next: { file: ".env.local", start: "いつもどおり npm run dev（または npm start）でOK。Next.js は .env.local を自動で読みます" },
  express: { file: ".env", start: "node --env-file=.env server.js で起動する（Node.js 20.6 以降。dotenv を使っているなら、いつもどおりでOK）" },
  fastapi: { file: ".env", start: "uvicorn main:app --env-file .env で起動する" },
};

// Region codes in the short form of Cloud Run URLs (service-hash-xx.a.run.app).
const RUN_REGIONS: Record<string, string> = { an: "asia-northeast1", uc: "us-central1", ue: "us-east1", ew: "europe-west1" };

/** The Cloud Run service and region, read from a run.app address (null for other addresses). */
export function cloudRunService(host: string): { service: string; region: string } | null {
  const long = host.match(/^(.+)-\d{6,}\.([a-z0-9-]+)\.run\.app$/); // service-PROJECTNUMBER.REGION.run.app
  if (long) return { service: long[1], region: long[2] };
  const short = host.match(/^(.+)-[a-z0-9]{10}-([a-z]{2})\.a\.run\.app$/);
  if (short && RUN_REGIONS[short[2]]) return { service: short[1], region: RUN_REGIONS[short[2]] };
  return null;
}

export function cloudRunCommand(siteHost: string, key: string | null): string {
  const run = cloudRunService(siteHost);
  return `gcloud run services update ${run?.service ?? "サービス名"} --region ${run?.region ?? "リージョン"} --update-env-vars AGENTGUARD_KEY=${key ?? "（接続キー）"}`;
}

// ----------------------------------------------------------------------------- ZIP (stored, no compression)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive of text files (stored entries, UTF-8 names), small enough to build in the browser. */
export function zipFiles(files: { path: string; text: string }[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, a) => n + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of all) { out.set(a, at); at += a.length; }
  return out;
}

// ----------------------------------------------------------------------------- the guide

export type KitOptions = {
  kind: ServerFramework;
  host: Host;
  siteUrl: string;
  siteHost: string;
  key: string | null; // shown only right after it is issued; null -> the guide says how to get a new one
  snippet: string;
  dashboardUrl: string;
};

const KIND_LABEL: Record<ServerFramework, string> = { next: "Next.js", express: "Express（Node.js）", fastapi: "FastAPI（Python）" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function keyText(key: string | null): string {
  return key
    ? [
        "# AgentGuard の接続キー（秘密です。人に見せない・GitHub などに上げない）",
        "# 下の1行を、サイトの「環境変数」に入れます（入れ方は READ_ME_FIRST.html の手順3）。",
        "# 入れ終わったら、このファイルは消してかまいません。",
        `AGENTGUARD_KEY=${key}`,
        "",
      ].join("\n")
    : [
        "# 接続キーは、発行したときにだけ表示されます（このセットには入っていません）。",
        "# AgentGuard の「守るサイト」→ ステップ2 の「キーをなくした・作り直す」で新しいキーを出してから、",
        "# もう一度この設定セットをダウンロードしてください。",
        "AGENTGUARD_KEY=（ここに接続キー）",
        "",
      ].join("\n");
}

function hostSection(o: KitOptions): string {
  const local = LOCAL_ENV[o.kind];
  const value = "AGENTGUARD_KEY.txt を開き、AGENTGUARD_KEY= の右側（agk_ で始まる部分）だけを貼ります";
  const vercel = `<ol>${HOSTS[0].steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p class="muted">${esc(value)}。</p>`;
  const cloudrun = `<p><b>いちばんかんたん：Cloud Shell に1行貼るだけ</b></p>
    <ol><li><a href="https://console.cloud.google.com/run?cloudshell=true" target="_blank" rel="noreferrer">Cloud Shell を開く</a>（画面の下に、コマンドを打つ黒い画面が開きます。サイトのプロジェクトが選ばれていることを確認）</li>
    <li>次の1行をコピーして貼り付け、Enter。終わると自動で公開し直されます（1〜2分）。</li></ol>
    <pre>${esc(cloudRunCommand(o.siteHost, o.key))}</pre>
    <p class="muted">画面でやる場合：${HOSTS[1].steps.map(esc).join(" → ")}（${esc(value)}）。</p>`;
  const other = `<ol><li>サイトのフォルダに <code>${local.file}</code> というファイルを作る（すでにあれば開く）</li>
    <li>AGENTGUARD_KEY.txt の最後の行（<code>AGENTGUARD_KEY=…</code>）をコピーして貼り付け、保存</li>
    <li>${esc(local.start)}</li></ol>
    <p class="warn"><code>${local.file}</code> は GitHub などに公開しないでください（<code>.gitignore</code> に <code>${local.file}</code> を書いておくと安心です）。</p>`;
  const blocks: Record<Host, { title: string; body: string }> = {
    vercel: { title: "Vercel で公開している場合", body: vercel },
    cloudrun: { title: "Cloud Run で公開している場合", body: cloudrun },
    other: { title: "自分のPC・そのほかの場所で動かす場合", body: other },
  };
  const order: Host[] = [o.host, ...(["vercel", "cloudrun", "other"] as Host[]).filter((h) => h !== o.host)];
  return order.map((h, i) => i === 0
    ? `<div class="box"><h4>${blocks[h].title}（あなたのサイト）</h4>${blocks[h].body}</div>`
    : `<details><summary>${blocks[h].title}</summary>${blocks[h].body}</details>`).join("\n");
}

export function guideHtml(o: KitOptions): string {
  const i = INSTALL[o.kind];
  const host = HOSTS.find((h) => h.id === o.host)!;
  const step2 = i.addLines
    ? `<p><b>${esc(i.addWhere ?? "")}</b> に、次を足して保存します。</p><pre>${esc(i.addLines)}</pre>
       <p class="muted">足したあとは、たとえばこうなります：</p><pre>${esc(i.context ?? "")}</pre>`
    : `<p>Next.js は、ファイルを置くだけで終わりです。<b>この手順はとばしてください。</b></p>`;
  const nextNotes = o.kind === "next"
    ? `<ul class="muted"><li>サイトのフォルダに <code>src</code> フォルダがあり、その中に <code>app</code> がある場合は、<code>src</code> の中に置きます。</li>
       <li>Next.js 15 以前は、ファイル名を <code>middleware.ts</code> に変えてください。</li>
       <li>すでに同じ名前のファイルがある場合は、上書きせずに、サイトを作った人に相談してください（中身をまとめる必要があります）。</li></ul>`
    : "";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentGuard 設定セット — はじめにお読みください</title>
<style>
  body{margin:0;background:#f6f7fb;color:#1e293b;font:15px/1.75 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif}
  main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 8px;padding-top:8px;border-top:1px solid #e2e8f0}
  h4{margin:0 0 6px} .muted{color:#64748b;font-size:13px} .warn{color:#92400e;background:#fef3c7;padding:8px 10px;border-radius:10px;font-size:13px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px 18px;margin:12px 0}
  .box{background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:12px 14px;margin:10px 0}
  details{border:1px solid #e2e8f0;border-radius:12px;padding:8px 14px;margin:8px 0;background:#fff} summary{cursor:pointer;font-weight:600;color:#4f46e5}
  pre{background:#0f172a;color:#e2e8f0;border-radius:12px;padding:12px 14px;overflow-x:auto;font-size:12.5px;line-height:1.6;white-space:pre}
  pre.tree{background:#f8fafc;color:#1e293b;border:1px solid #e2e8f0}
  code{background:#eef2f7;border-radius:6px;padding:1px 5px;font-size:13px;overflow-wrap:anywhere}
  table{border-collapse:collapse;width:100%;font-size:14px;table-layout:fixed} td,th{border-bottom:1px solid #e2e8f0;padding:8px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
  li,p{overflow-wrap:anywhere}
  .n{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#4f46e5;color:#fff;font-size:14px;margin-right:6px}
</style></head><body><main>
<h1>AgentGuard 設定セット</h1>
<p class="muted">はじめにお読みください。この順番どおりに進めれば、5分ほどで終わります。</p>
<div class="card">
  <table>
    <tr><th>守るサイト</th><td>${esc(o.siteUrl)}</td></tr>
    <tr><th>サイトの種類</th><td>${KIND_LABEL[o.kind]}</td></tr>
    <tr><th>公開している場所</th><td>${esc(host.label)}</td></tr>
  </table>
</div>

<h2>このフォルダの中身</h2>
<div class="card"><table>
  <tr><th>ファイル</th><th>なに？</th><th>どこへ？</th></tr>
  <tr><td><code>READ_ME_FIRST.html</code></td><td>この手順書</td><td>読むだけ</td></tr>
  <tr><td><code>files_for_your_site/${i.fileName}</code></td><td>AgentGuard とつなぐプログラム</td><td><b>あなたのサイトのフォルダ</b>に入れる（手順1）</td></tr>
  <tr><td><code>AGENTGUARD_KEY.txt</code></td><td>接続キー（秘密）</td><td>サイトの<b>環境変数</b>に入れる（手順3）。このファイル自体はサイトに入れません</td></tr>
</table></div>

<h2><span class="n">1</span>ファイルを、サイトのフォルダに入れる</h2>
<p><code>files_for_your_site</code> の中の <b><code>${i.fileName}</code></b> を、<b>${esc(i.place)}</b>にコピーします。</p>
<p class="muted">「サイトのフォルダ」とは、${o.kind === "fastapi" ? "<code>main.py</code>" : "<code>package.json</code>"} が入っているフォルダです。VS Code などでサイトを開いたときの、いちばん上のフォルダであることが多いです。</p>
<p>入れたあとは、こうなります：</p>
<pre class="tree">${esc(i.tree)}</pre>
${nextNotes}

<h2><span class="n">2</span>${i.addLines ? "1〜2行だけ書き足す" : "（Next.js は不要）"}</h2>
${step2}

<h2><span class="n">3</span>接続キーを、サイトの環境変数に入れる</h2>
<p>接続キーは、あなたのサイトだけが AgentGuard とつながるための合言葉です。<code>AGENTGUARD_KEY.txt</code> に入っています。</p>
${hostSection(o)}

<h2><span class="n">4</span>公開し直して、つながったか確かめる</h2>
<ol>
  <li>${esc(host.publish)}</li>
  <li>公開が終わったら、<a href="${esc(o.siteUrl)}" target="_blank" rel="noreferrer">サイト</a>をブラウザで一度開く</li>
  <li><a href="${esc(o.dashboardUrl)}/app/site" target="_blank" rel="noreferrer">AgentGuard の「守るサイト」画面</a>を見る → 自動で<b>「つながりました」</b>に変われば完了です（所有確認も自動で終わります）</li>
</ol>

<h2>うまくいかないとき</h2>
<ul>
  <li>環境変数の名前が <code>AGENTGUARD_KEY</code>（すべて大文字）になっているか</li>
  <li>キーを入れたあと、公開し直したか（Vercel・Cloud Run は、環境変数を変えたら公開し直しが必要）</li>
  <li>ファイル名（<code>${i.fileName}</code>）と置き場所（${esc(i.place)}）が合っているか</li>
  ${i.addLines ? `<li>書き足した行が、${esc(i.addWhere ?? "")}にあるか</li>` : ""}
  <li>それでもだめなら、このフォルダをサイトを作った人に渡して見てもらってください</li>
</ul>

<h2>大事な注意</h2>
<ul>
  <li><b>接続キーは秘密です。</b><code>AGENTGUARD_KEY.txt</code> は人に見せたり、GitHub に上げたりしないでください。環境変数に入れ終わったら消してかまいません。</li>
  <li>キーをなくしたり、もれてしまったときは、AgentGuard の画面で「キーをなくした・作り直す」を押すと、古いキーはすぐ使えなくなります。</li>
  <li>（任意）環境変数 <code>AGENTGUARD_FAIL_CLOSED=true</code> も足すと、AgentGuard に確認できないときもアクセスを止めます（そのぶん AgentGuard が止まるとサイトも止まります）。</li>
</ul>
</main></body></html>
`;
}

export function buildSetupKit(o: KitOptions): { name: string; files: { path: string; text: string }[] } {
  const root = "agentguard-setup";
  return {
    name: `agentguard-setup-${o.siteHost.split(".")[0]}.zip`,
    files: [
      { path: `${root}/READ_ME_FIRST.html`, text: guideHtml(o) },
      { path: `${root}/files_for_your_site/${INSTALL[o.kind].fileName}`, text: o.snippet },
      { path: `${root}/AGENTGUARD_KEY.txt`, text: keyText(o.key) },
    ],
  };
}

/** Build the setup folder and save it as a ZIP in the browser's Downloads. */
export function downloadSetupKit(o: KitOptions) {
  const kit = buildSetupKit(o);
  const bytes = zipFiles(kit.files);
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = kit.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
