/**
 * The "setup folder" a site owner downloads: one ZIP with everything needed to connect a site,
 * laid out the way it is used, plus a step-by-step guide page that says exactly where each piece
 * goes for this site's framework and hosting.
 *
 *   agentguard-setup/
 *   ├─ READ_ME_FIRST.html                  the guide (open it in a browser; not deployed)
 *   ├─ files_for_your_site/                everything in here is copied into the site's folder
 *   │  ├─ <file>                           the program (deployed and pushed with the site)
 *   │  └─ .agentguard/                     the saved key: deployed with the site, never pushed
 *   │     ├─ .gitignore                    "*": git never sends this folder to GitHub
 *   │     └─ .settings                     the key, written so it is not readable at a glance
 *   ├─ CLAUDE_CODE_SETUP.md                the same steps written for an AI assistant (Claude Code)
 *   ├─ .gitignore                          "*": the kit itself is never pushed, even inside the site
 *   └─ for_vercel_settings.txt             Vercel only: the key to paste into Vercel's settings
 *
 * The key is saved from the start, so a site deployed from its folder (Cloud Run with gcloud, own
 * PC, most servers) needs no environment variable at all. A site built from GitHub (Vercel) never
 * receives the folder, by design, so only there the key also goes into the hosting's settings.
 * File names are ASCII on purpose: some unzip tools garble non-ASCII names. The guide is Japanese.
 */

import { encodeSavedKey, INSTALL, KIT_DIR, SAVED_DIR, SAVED_FILE, type ServerFramework } from "./site-snippets";

export type Host = "vercel" | "cloudrun" | "other";

/*
 * Wording: short sentences, everyday words. A technical word is used only with its meaning beside it
 * the first time: 秘密の設定（環境変数）, GitHub に送る（push）, リポジトリ（サイトのファイルの保管場所）.
 */

/**
 * The key step, per hosting service. `needsKey`: the saved-key folder does not reach the server
 * (built from GitHub), so the key also goes into the hosting's secret settings. Otherwise there is
 * nothing to do, and `keySteps` are only for the less common case named in `keyNote`.
 */
export const HOSTS: { id: Host; label: string; needsKey: boolean; keyIntro: string; keySteps: string[]; keyNote: string }[] = [
  {
    id: "vercel", label: "Vercel", needsKey: true,
    keyIntro: "Vercel は、GitHub にあるファイルからサイトを作ります。キーを保存した .agentguard フォルダは、GitHub に送らないようにしてあるので、Vercel には届きません。なので Vercel だけは、キーを Vercel の設定にも入れます。",
    keySteps: [
      "vercel.com を開いてログインし、このサイトのプロジェクトをクリックします。",
      "上のメニューの「Settings」を押し、左のメニューから「Environment Variables」を選びます。",
      "「Key」に AGENTGUARD_KEY、「Value」に接続キー（agk_ ではじまる文字）を貼り、「Save」を押します。",
    ],
    keyNote: "ここで入れたキーは、次にサイトを更新したときから使われます（更新は次の手順でします）。",
  },
  {
    id: "cloudrun", label: "Cloud Run", needsKey: false,
    keyIntro: "何もしなくて大丈夫です。キーは .agentguard フォルダに保存してあります。次の手順でサイトを公開するとき（gcloud run deploy）に、プログラムといっしょに Cloud Run に届きます。",
    keySteps: [
      "「Cloud Shell を開く」を押します。Google Cloud の画面の下に、文字を打ちこむ黒い画面が出てきます（サイトのプロジェクトが選ばれているか確認してください）。",
      "下の1行をコピーして、その黒い画面に貼り付け、Enter キーを押します。1〜2分で終わります。",
    ],
    keyNote: "Cloud Run を GitHub と自動でつないでいる（GitHub に送ると自動で更新される）ときだけ、.agentguard フォルダが届かないので、この1行でキーを入れます。",
  },
  {
    id: "other", label: "それ以外・自分のPC", needsKey: false,
    keyIntro: "何もしなくて大丈夫です。キーは .agentguard フォルダに保存してあり、プログラムが自分で読みこみます。起動のしかたも、いつもどおりで大丈夫です。",
    keySteps: [
      "サーバーの管理画面などで、秘密の設定（環境変数）に AGENTGUARD_KEY という名前で接続キーを入れます。",
      "サイトを起動しなおします。",
    ],
    keyNote: "レンタルサーバーなどで「.」ではじまるフォルダを上げられないときや、GitHub から公開するサーバーのときだけ、こうします。",
  },
];

/** Starting the site on your own PC: the usual command, since the key is read from the saved folder. */
export const LOCAL_START: Record<ServerFramework, string> = {
  next: "npm run dev",
  express: "node server.js",
  fastapi: "uvicorn main:app",
};

/** One way of updating the site (GitHub Desktop, VS Code, commands …). */
export type PublishWay = { name: string; steps: string[]; code?: string };

/**
 * Updating the site so the new files take effect ("where do I push?"), per hosting.
 * `where` says what is updated; the first way is the most common one.
 */
export function publishGuide(host: Host, kind: ServerFramework, siteHost: string): {
  intro: string; where: string; ways: PublishWay[]; done: string; notes: string[];
} {
  const file = INSTALL[kind].fileName;
  if (host === "vercel") {
    return {
      intro: "Vercel は、GitHub にあるサイトのファイルが変わると、自動でサイトを更新してくれます。なので、変えたファイルを GitHub に送る（push する）だけです。",
      where: "送り先は、Vercel とつながっている GitHub のリポジトリ（サイトのファイルの保管場所）の main ブランチです。どのリポジトリか分からないときは、Vercel のプロジェクト →「Settings」→「Git」に書いてあります。",
      ways: [
        { name: "GitHub Desktop を使っている場合", steps: [
          "GitHub Desktop を開き、左上の「Current repository」がこのサイトになっているか確認します。",
          `左の一覧に、追加したファイル（${file}）が出ていることを確認します。.agentguard フォルダは出てきませんが、それで正しいです（GitHub に送らないようにしてあるためです）。`,
          "左下の「Summary」に「AgentGuard を追加」と書き、「Commit to main」を押します。",
          "上の「Push origin」を押します。これで GitHub に送られます。",
        ] },
        { name: "VS Code を使っている場合", steps: [
          "左の、枝分かれのようなマーク（ソース管理）を押します。",
          "上の入力欄に「AgentGuard を追加」と書き、「コミット」（✓）を押します。",
          "「変更の同期」（または「同期」）を押します。これで GitHub に送られます。",
        ] },
        { name: "コマンドを使う場合", steps: ["サイトのフォルダで、次の3行を1行ずつ実行します（.agentguard フォルダは、自動で送られないようになっています）。"],
          code: 'git add .\ngit commit -m "AgentGuard を追加"\ngit push' },
        { name: "GitHub を使っていない場合", steps: ["サイトのフォルダで、次の1行を実行すると更新できます。"], code: "npx vercel --prod" },
      ],
      done: "送ったあと、Vercel のプロジェクトの「Deployments」に新しい行が出て、1〜2分で「Ready」になれば更新は終わりです。",
      notes: ["キーだけを入れなおしたときは、ファイルを送らなくても、「Deployments」→ いちばん上の行の「…」→「Redeploy」で更新できます。"],
    };
  }
  if (host === "cloudrun") {
    const run = cloudRunService(siteHost);
    const service = run?.service ?? "サービス名";
    const region = run?.region ?? "リージョン";
    return {
      intro: "Cloud Run は、ふつうは GitHub に送るだけでは更新されません。サイトを最初に公開したときと同じように、サイトのフォルダからもう一度公開します。このとき、プログラムとキーのフォルダ（.agentguard）が、いっしょに Cloud Run に届きます。",
      where: `更新するのは、Cloud Run のサービス「${service}」です。サイトのファイルがあるところ（自分のPC、または Cloud Shell）から公開します。`,
      ways: [
        { name: "コマンドで公開している場合（いちばん多い方法）", steps: [
          "ターミナル（文字を打ちこむ黒い画面）を開き、cd コマンドでサイトのフォルダに移動します（例：cd Desktop/my-site）。",
          "次の1行を実行します。数分で終わります。",
        ], code: `gcloud run deploy ${service} --source . --region ${region}` },
        { name: "GitHub と自動でつないでいる場合", steps: [
          "Cloud Run を GitHub と自動でつないでいる（継続的デプロイを設定した）場合は、Vercel と同じように GitHub に送る（push する）だけで更新されます。",
          "このときは .agentguard フォルダが Cloud Run に届かないので、ひとつ前の手順の「GitHub と自動でつないでいるとき」の1行で、キーも入れておいてください。",
        ], code: 'git add .\ngit commit -m "AgentGuard を追加"\ngit push' },
      ],
      done: "「Service URL: https://…」と表示されたら、更新は終わりです。",
      notes: [],
    };
  }
  return {
    intro: "自分のPCで動かしている場合は、GitHub に送る必要はありません。サイトをいちど止めて、もう一度起動するだけです。",
    where: "更新するのは、いまサイトを動かしているターミナル（文字を打ちこむ黒い画面）です。",
    ways: [
      { name: "自分のPCで動かしている場合", steps: [
        "サイトを動かしている黒い画面で、Ctrl キーを押しながら C を押して、いったん止めます。",
        "いつもと同じ方法で、もう一度起動します。たとえば次の1行です。",
      ], code: LOCAL_START[kind] },
      { name: "レンタルサーバーなど、ほかのサーバーの場合", steps: [
        `いつもサイトのファイルを上げている方法で、${file} と .agentguard フォルダも上げます。`,
        "サイトを再起動します。分からないときは、サーバーの会社の説明を見てください。",
      ] },
    ],
    done: "起動したら、ブラウザでサイトを開いてみてください。",
    notes: ["キーは .agentguard フォルダから自動で読みこむので、起動のしかたを変える必要はありません。"],
  };
}

/** What runs when the site is deployed, and with which tool: the answer to "which one is the program?". */
export function deployTool(host: Host, kind: ServerFramework): string {
  const file = INSTALL[kind].fileName;
  if (host === "vercel") return `GitHub Desktop などで GitHub に送る（push する）と、Vercel が自動でサイトを作りなおします。そのとき ${file} も、いっしょにサイトに入ります。`;
  if (host === "cloudrun") return `サイトのフォルダで gcloud run deploy の1行を実行すると、${file} と .agentguard フォルダが Cloud Run に届き、サイトといっしょに動きます。`;
  return `いつもの起動のしかた（${LOCAL_START[kind]} など）で、${file} もいっしょに動きます。`;
}

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
  key: string | null; // shown only right after it is issued; null -> no saved key, the guide says how to get one
  snippet: string;
  dashboardUrl: string;
  basePath?: string; // the site's path under its host ("" for the whole host)
};

const KIND_LABEL: Record<ServerFramework, string> = { next: "Next.js", express: "Express（Node.js）", fastapi: "FastAPI（Python）" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const VERCEL_FILE = "for_vercel_settings.txt";

function vercelKeyText(key: string): string {
  return [
    "このファイルは、Vercel の設定にキーを貼るときだけ使います。サイトのフォルダには入れません。",
    "貼り終わったら、消してしまって大丈夫です（人に見せてはいけない合言葉です）。",
    "やり方は READ_ME_FIRST.html の手順3に書いてあります。",
    "",
    "Key（名前）に貼るもの：",
    "AGENTGUARD_KEY",
    "",
    "Value（値）に貼るもの：",
    key,
    "",
  ].join("\n");
}

const list = (items: string[]) => `<ol>${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;

function keySection(o: KitOptions): string {
  const h = HOSTS.find((x) => x.id === o.host)!;
  if (o.host === "vercel") {
    return `<p>${esc(h.keyIntro)}</p>
      <div class="box"><h4>Vercel の設定にキーを入れる</h4>${list(h.keySteps)}
        <p class="muted">貼るキーは、このフォルダの <code>${VERCEL_FILE}</code> に入っています。</p>
        <p class="muted">${esc(h.keyNote)}</p></div>`;
  }
  const steps = o.host === "cloudrun"
    ? `<ol><li><a href="https://console.cloud.google.com/run?cloudshell=true" target="_blank" rel="noreferrer">Cloud Shell を開く</a>を押します。${esc(h.keySteps[0].replace("「Cloud Shell を開く」を押します。", ""))}</li><li>${esc(h.keySteps[1])}</li></ol>
       <pre>${esc(cloudRunCommand(o.siteHost, o.key))}</pre>`
    : list(h.keySteps);
  return `<div class="box"><h4>この手順は、とばして大丈夫です</h4><p>${esc(h.keyIntro)}</p></div>
    <details><summary>${o.host === "cloudrun" ? "GitHub と自動でつないでいるとき" : "「.」ではじまるフォルダを上げられないとき"}</summary>
      <p class="muted">${esc(h.keyNote)}</p>${steps}</details>`;
}

function publishSection(o: KitOptions): string {
  const g = publishGuide(o.host, o.kind, o.siteHost);
  const way = (w: PublishWay) => `${list(w.steps)}${w.code ? `<pre>${esc(w.code)}</pre>` : ""}`;
  return `<p>${esc(g.intro)}</p>
    <p class="muted">${esc(g.where)}</p>
    ${g.ways.map((w, i) => i === 0
      ? `<div class="box"><h4>${esc(w.name)}</h4>${way(w)}</div>`
      : `<details><summary>${esc(w.name)}</summary>${way(w)}</details>`).join("\n")}
    <p>${esc(g.done)}</p>
    ${g.notes.map((n) => `<p class="muted">${esc(n)}</p>`).join("")}`;
}

export function guideHtml(o: KitOptions): string {
  const i = INSTALL[o.kind];
  const host = HOSTS.find((h) => h.id === o.host)!;
  const siteFolder = o.kind === "fastapi" ? "main.py" : "package.json";
  const vercel = o.host === "vercel" && o.key !== null;
  const step2 = i.addLines
    ? `<p>${esc(i.addWhere ?? "")}に、次の${i.addLines.includes("\n") ? "2行" : "1行"}を書き足して、保存します。</p><pre>${esc(i.addLines)}</pre>
       <p class="muted">書き足したあとは、たとえばこんな感じになります：</p><pre>${esc(i.context ?? "")}</pre>`
    : `<p>Next.js は、ファイルを置くだけで大丈夫です。<b>この手順はとばしてください。</b></p>`;
  const nextNotes = o.kind === "next"
    ? `<ul class="muted"><li>サイトのフォルダに <code>src</code> というフォルダがあって、その中に <code>app</code> がある場合は、<code>${i.fileName}</code> だけを <code>src</code> の中に移します（<code>.agentguard</code> は <code>package.json</code> のとなりのままです）。</li>
       <li>Next.js のバージョンが15以前のときは、ファイルの名前を <code>middleware.ts</code> に変えてください。このバージョンでは保存したキーのフォルダを読めないので、キーを秘密の設定（環境変数）<code>AGENTGUARD_KEY</code> にも入れてください。</li>
       <li>すでに同じ名前のファイルがあるときは、上書きしないで、サイトを作った人に相談してください（2つの中身をまとめる必要があります）。</li></ul>`
    : "";
  const noKey = o.key === null
    ? `<p class="warn"><b>このセットには、接続キーが入っていません。</b>キーは作ったときに1回しか見られないためです。AgentGuard の「守るサイト」の画面で「キーをなくした・作り直す」を押して新しいキーを出してから、もう一度ダウンロードしてください。</p>`
    : "";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentGuard 設定セット — はじめにお読みください</title>
<style>
  body{margin:0;background:#f6f7fb;color:#1e293b;font:15px/1.8 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif}
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
  dt{font-weight:700;margin-top:8px} dd{margin:0 0 0 1em;color:#475569;font-size:14px}
</style></head><body><main>
<h1>AgentGuard 設定セット</h1>
<p class="muted">はじめにお読みください。上から順番に進めれば、5分くらいで終わります。分からない言葉は、いちばん下の「ことばの説明」を見てください。</p>
<div class="card">
  <table>
    <tr><th>守るサイト</th><td>${esc(o.siteUrl)}</td></tr>
    <tr><th>サイトの種類</th><td>${KIND_LABEL[o.kind]}</td></tr>
    <tr><th>公開しているところ</th><td>${esc(host.label)}</td></tr>
  </table>
</div>
${noKey}

<h2>このフォルダに入っているもの</h2>
<div class="card"><table>
  <tr><th>ファイル</th><th>なに？</th><th>サイトといっしょに公開する？</th></tr>
  <tr><td><code>READ_ME_FIRST.html</code></td><td>このページ（やり方の説明）</td><td>しない（読むだけ）</td></tr>
  <tr><td><code>files_for_your_site/${i.fileName}</code></td><td><b>プログラム</b>。サイトに届いたアクセスを、サイトの処理より先に AgentGuard に見せて、攻撃なら止めます</td><td><b>する</b>（GitHub にも送ります）</td></tr>
  ${o.key !== null ? `<tr><td><code>files_for_your_site/${SAVED_DIR}/</code></td><td>接続キー（人に見せてはいけない合言葉）を保存したフォルダ。プログラムが自分で読みこみます</td><td><b>する</b>（サーバーには届きます。でも GitHub には送られず、サイトを見る人にも見えません）</td></tr>` : ""}
  ${vercel ? `<tr><td><code>${VERCEL_FILE}</code></td><td>Vercel の設定に貼るキー</td><td>しない（手順3で使ったら、消して大丈夫）</td></tr>` : ""}
  <tr><td><code>${AI_GUIDE}</code></td><td>Claude Code（AI）にやってもらうときの指示書</td><td>しない</td></tr>
</table></div>
<div class="box"><h4>Claude Code（AI）にやってもらうこともできます</h4>
  <ol><li>この <code>${KIT_DIR}</code> フォルダを、サイトのフォルダの中に入れます。</li>
    <li>サイトのフォルダで Claude Code を開き、次の文を貼り付けます。</li></ol>
  <pre>${esc(AI_PROMPT)}</pre>
  <p class="muted">GitHub に送る（push）・公開する（デプロイ）前に、Claude Code が確認を聞いてきます。内容を見て OK してください。終わったら、手順5で「つながりました」になったか見てください。</p>
</div>
<div class="box"><h4>公開する（デプロイする）とき、動くプログラムはどれ？</h4>
  <p>サーバーの上で動くのは <code>${i.fileName}</code> だけです。サイトに届いたアクセスを、サイトの処理より先に受けとって、AgentGuard に見せます。接続キーは、このプログラムが <code>${SAVED_DIR}</code> フォルダから自分で読みこみます${vercel ? "（Vercel では、Vercel の設定に入れたキーを使います）" : ""}。</p>
  <p class="muted">${esc(deployTool(o.host, o.kind))}</p>
</div>

<h2><span class="n">1</span>ファイルを、サイトのフォルダに入れる</h2>
<p><code>files_for_your_site</code> フォルダを開いて、中にある<b>${o.key !== null ? "2つ" : "ファイル"}</b>（<code>${i.fileName}</code>${o.key !== null ? ` と <code>${SAVED_DIR}</code> フォルダ` : ""}）を、<b>サイトのフォルダ</b>にコピーします。</p>
<p class="muted">「サイトのフォルダ」とは、<code>${siteFolder}</code> というファイルが入っているフォルダのことです。VS Code などでサイトを開いたとき、いちばん上に出てくるフォルダであることが多いです。</p>
<p>入れたあとは、こんな形になります：</p>
<pre class="tree">${esc(i.tree)}</pre>
${o.key !== null ? `<p class="muted">Mac では、「.」ではじまるフォルダ（<code>${SAVED_DIR}</code>）は、ふつうは見えません。Finder で Command ＋ Shift ＋ .（ピリオド）を押すと見えるようになります。</p>` : ""}
${nextNotes}

<h2><span class="n">2</span>${i.addLines ? "1〜2行だけ書き足す" : "書き足しはありません（Next.js）"}</h2>
${step2}

<h2><span class="n">3</span>接続キー${host.needsKey ? "を、Vercel の設定にも入れる" : "（何もしなくて大丈夫）"}</h2>
${keySection(o)}

<h2><span class="n">4</span>サイトを更新する（GitHub に送る・もう一度公開する）</h2>
${publishSection(o)}

<h2><span class="n">5</span>つながったか見てみる</h2>
<ol>
  <li>更新が終わったら、<a href="${esc(o.siteUrl)}" target="_blank" rel="noreferrer">あなたのサイト</a>をブラウザで1回開きます。</li>
  <li><a href="${esc(o.dashboardUrl)}/app/site" target="_blank" rel="noreferrer">AgentGuard の「守るサイト」の画面</a>を開きます。自動で<b>「つながりました」</b>に変われば、すべて終わりです。あなたのサイトかどうかの確認も、自動で終わります。</li>
</ol>

<h2>うまくいかないとき</h2>
<ul>
  <li><code>${SAVED_DIR}</code> フォルダも、サイトのフォルダに入っていますか？（Mac では見えないことがあります。手順1を見てください）</li>
  ${host.needsKey ? `<li>Vercel の設定の名前が <code>AGENTGUARD_KEY</code>（すべて大文字）になっていますか？　キーを入れたあとに、サイトを更新しましたか？</li>` : ""}
  <li>ファイルの名前（<code>${i.fileName}</code>）と、置いた場所（${esc(i.place)}）は合っていますか？</li>
  ${i.addLines ? `<li>書き足した行は、${esc(i.addWhere ?? "")}にありますか？</li>` : ""}
  <li>キーを作り直したときは、このフォルダをもう一度ダウンロードして、<code>${SAVED_DIR}</code> フォルダを新しいものに入れかえてください。</li>
  <li>それでもだめなときは、このフォルダを、サイトを作った人に渡して見てもらってください。</li>
</ul>

<h2>大事なこと</h2>
<ul>
  <li><b><code>${SAVED_DIR}</code> フォルダには、接続キー（人に見せてはいけない合言葉）が入っています。</b>人に渡したり、どこかに上げたりしないでください。</li>
  <li>このフォルダの中には <code>.gitignore</code> というファイルが入っていて、GitHub には送られないようになっています（このファイルは消さないでください）。また、プログラムが、サイトを見る人からこのフォルダを見えないようにしています。</li>
  <li>キーは、見ただけでは分からない形で保存してあります。ただし暗号ではないので、上の2つのしくみ（GitHub に送らない・サイトを見る人に見せない）で守っています。</li>
  <li>キーをなくしたときや、人に見られてしまったときは、AgentGuard の画面の「キーをなくした・作り直す」を押してください。古いキーはすぐに使えなくなります。</li>
  <li>この <code>${KIT_DIR}</code> フォルダにも <code>.gitignore</code> が入っているので、サイトのフォルダの中に置いても GitHub には送られません。ただし、Cloud Run などに公開する（デプロイする）前には、サイトのフォルダの外に出してください（キーが入っているためです）。</li>
  <li>（使わなくても大丈夫）秘密の設定に <code>AGENTGUARD_FAIL_CLOSED=true</code> も足すと、AgentGuard と連絡がとれないときもアクセスを止めて、より安全にできます。そのかわり、AgentGuard が止まっているあいだは、サイトも見られなくなります。</li>
</ul>

<h2>ことばの説明</h2>
<dl>
  <dt>プログラム</dt><dd>サーバーの上で動く、サイトのしくみです。ここでは <code>${i.fileName}</code> が、サイトと AgentGuard をつなぐプログラムです。</dd>
  <dt>秘密の設定（環境変数）</dt><dd>サイトのファイルとは別に、公開しているところ（Vercel など）に保存しておく設定です。ファイルの中に書かないので、人に見られません。</dd>
  <dt>.gitignore</dt><dd>「このファイルは GitHub に送らない」と決めておくためのファイルです。</dd>
  <dt>GitHub・リポジトリ</dt><dd>GitHub は、サイトのファイルを保管しておくサービスです。1つのサイトのファイルの保管場所を「リポジトリ」と呼びます。</dd>
  <dt>push（プッシュ）</dt><dd>自分のPCで変えたファイルを、GitHub に送ることです。Vercel は、送られたのを見て自動でサイトを更新します。</dd>
  <dt>コミット</dt><dd>「ここまで変えました」と記録することです。push の前にします。</dd>
  <dt>デプロイ</dt><dd>サイトを公開すること（もう一度公開して更新すること）です。</dd>
  <dt>ターミナル・Cloud Shell</dt><dd>文字でコマンドを打ちこむ黒い画面です。Cloud Shell は、Google Cloud の画面の中で使えるターミナルです。</dd>
</dl>
</main></body></html>
`;
}

// ----------------------------------------------------------------------------- the guide for an AI assistant

/** The same setup written for Claude Code (or another coding assistant) working in the site's folder. */
export const AI_GUIDE = "CLAUDE_CODE_SETUP.md";
export const AI_PROMPT = `${KIT_DIR}/${AI_GUIDE} を読んで、その手順でこのサイトを AgentGuard につないでください。`;

// Read the saved key without showing it, to hand it straight to a command (bash, in the folder that holds .agentguard).
const DECODE_NODE = `node -e 'const p="agentguard",l=require("fs").readFileSync(".agentguard/.settings","utf8").split("\\n").find(x=>x.startsWith("v1:"));process.stdout.write(Buffer.from(Buffer.from(l.slice(3).trim(),"base64").map((b,i)=>b^p.charCodeAt(i%p.length))).toString())'`;
const DECODE_PY = `python -c 'import base64;p=b"agentguard";l=next(x for x in open(".agentguard/.settings",encoding="utf-8") if x.startswith("v1:"));r=base64.b64decode(l[3:].strip());print(bytes(b^p[i%len(p)] for i,b in enumerate(r)).decode(),end="")'`;

function aiSteps(o: KitOptions): { check: string; prereq: string; place: string; add: string } {
  if (o.kind === "next") {
    return {
      check: "`package.json` の dependencies に `next` がある",
      prereq: "`next` のバージョンを確かめる（`package.json`、または `node_modules/next/package.json`）。手順2で使う。",
      place: `1. \`next\` のバージョンで、ファイルの名前を決める。
   - **16 以上**：\`files_for_your_site/proxy.ts\` を \`proxy.ts\` のまま置く。
   - **15.5 以上 16 未満**：\`middleware.ts\` という名前で置き、ファイルの最後の \`config\` に \`runtime: "nodejs"\` を足す（例：\`export const config = { runtime: "nodejs", matcher: [...] };\`）。足さないと保存したキーを読めない。
   - **15.4 以下**：\`middleware.ts\` という名前で置く。このバージョンでは保存したキーを読めないので、手順4で環境変数 \`AGENTGUARD_KEY\` も必ず入れる。
2. 置く場所：\`src/app\` か \`src/pages\` があれば \`src/\` の中、なければ \`package.json\` と同じフォルダ。
3. \`files_for_your_site/.agentguard/\` を、中の \`.gitignore\` と \`.settings\` ごと、**\`package.json\` と同じフォルダ**にコピーする（\`src\` を使っていてもここ。プログラムは起動したときのフォルダから読む）。
4. すでに \`proxy.ts\` か \`middleware.ts\` があるときは、上書きしない。ユーザーに確認してから、1つにまとめる：
   - AgentGuard の処理を先に呼び、それが「通す」以外（403・503・404・確認用の答え）を返したら、それをそのまま返す。見分けやすいように、AgentGuard の関数を「通すときは \`null\` を返す」形に変えてよい（中身の変更はここだけ）。
   - 「通す」ときは、もとの処理を続ける。
   - \`config.matcher\` は、もとの範囲と AgentGuard の範囲（\`/((?!_next/static|_next/image|favicon.ico).*)\`）の両方が入るようにする。`,
      add: "Next.js は書き足しなし。この手順はとばす。",
    };
  }
  if (o.kind === "express") {
    return {
      check: "`package.json` の dependencies に `express` がある",
      prereq: "Node.js が 18 以上か（`node --version`）。プログラムは `fetch` を使う。",
      place: `1. \`express()\` を呼んでいるファイル（サーバーの入口）を探す：
   \`\`\`bash
   grep -rn "express()" --include=*.js --include=*.cjs --include=*.mjs --include=*.ts . | grep -v node_modules
   \`\`\`
2. \`files_for_your_site/agentguard.cjs\` を、そのファイルと同じフォルダに置く。
3. \`files_for_your_site/.agentguard/\` を、中の \`.gitignore\` と \`.settings\` ごと、同じフォルダに置く（\`package.json\` のフォルダでもよい。プログラムは、自分のフォルダと、起動したときのフォルダの両方を探す）。`,
      add: `1行だけ書き足す。
- 場所：\`app.use(express.json())\` / \`app.use(express.urlencoded(...))\` の**すぐ下**。ルート（\`app.get\` など）、\`app.use(router)\`、\`express.static\` より**上**。body を読む設定がなければ \`const app = express();\` のすぐ下。
- CommonJS（\`require\` で書かれている）：
  \`\`\`js
  require("./agentguard.cjs")(app);
  \`\`\`
- ES Modules（\`package.json\` に \`"type": "module"\`、または \`import\` で書かれている）：ファイルの先頭の import に \`import agentguard from "./agentguard.cjs";\` を足し、上の場所に \`agentguard(app);\` を書く。
- TypeScript をビルドして動かしているときは、実行される JS から \`agentguard.cjs\` が見えるようにする（ビルド先にコピーされないなら、\`package.json\` のフォルダに置いて \`require(require("node:path").join(process.cwd(), "agentguard.cjs"))(app);\`）。
- 書き足したあとの例：
  \`\`\`js
${(INSTALL.express.context ?? "").split("\n").map((l) => `  ${l}`).join("\n")}
  \`\`\``,
    };
  }
  return {
    check: "`requirements.txt` か `pyproject.toml` に `fastapi` がある",
    prereq: "`httpx` が依存に入っているか。なければ `requirements.txt`（または `pyproject.toml`）に `httpx` を足して、インストールする（例：`pip install httpx`）。",
    place: `1. \`FastAPI(\` を呼んでいるファイルを探す：
   \`\`\`bash
   grep -rn "FastAPI(" --include=*.py . | grep -v -e "/.venv/" -e "/venv/"
   \`\`\`
2. \`files_for_your_site/agentguard.py\` を、そのファイルと同じフォルダに置く。
3. \`files_for_your_site/.agentguard/\` を、中の \`.gitignore\` と \`.settings\` ごと、同じフォルダに置く（起動するフォルダでもよい。プログラムは両方を探す）。`,
    add: `2行だけ書き足す。
- 場所：\`app = FastAPI(...)\` の**すぐ下**。
  \`\`\`python
  from agentguard import protect
  protect(app)
  \`\`\`
- パッケージの中にあるとき（例：\`uvicorn app.main:app\` で起動）は、プロジェクトの書き方に合わせて \`from .agentguard import protect\` か \`from app.agentguard import protect\` にする。
- 書き足したあとの例：
  \`\`\`python
${(INSTALL.fastapi.context ?? "").split("\n").map((l) => `  ${l}`).join("\n")}
  \`\`\``,
  };
}

function aiKeyStep(o: KitOptions, service: string, region: string): string {
  const oldNext = o.kind === "next"
    ? "\n- Next.js 15.4 以下で `middleware.ts` にしたときは、公開先にかかわらず、環境変数 `AGENTGUARD_KEY` が必要（取り出し方は下の「キーの取り出し方」）。"
    : "";
  if (o.host === "vercel") {
    return `**Vercel は必ず環境変数が必要。** Vercel は GitHub からビルドするので、\`.agentguard/\` は届かない（git に入らないため）。環境変数 \`AGENTGUARD_KEY\` を Production に入れる（Preview も使うなら Preview にも）。
- Vercel CLI でログイン済みで、このフォルダがリンク済み（\`.vercel/project.json\` がある）なら、キーを表示せずに入れられる（bash、サイトのフォルダで）：
  \`\`\`bash
  grep '^agk_' ${KIT_DIR}/${VERCEL_FILE} | tr -d '\\r\\n' | npx vercel env add AGENTGUARD_KEY production
  \`\`\`
- CLI が使えないとき、または上がうまくいかないときは、ユーザーにお願いする：Vercel のプロジェクト →「Settings」→「Environment Variables」で、Key に \`AGENTGUARD_KEY\`、Value に \`${KIT_DIR}/${VERCEL_FILE}\` の \`agk_\` ではじまる行を貼り、「Save」。あなた（AI）はこのファイルを開かない。
- 入れたキーは、次のデプロイから使われる。`;
  }
  if (o.host === "cloudrun") {
    return `**ふつうは何もしない。** \`gcloud run deploy --source .\` で公開すると、\`.agentguard/\` もいっしょに届き、プログラムが読む。次だけ確かめる：
- \`.gcloudignore\` があるなら、\`.agentguard\` や「.」ではじまるファイルを除外していないか（手順6の \`gcloud meta list-files-for-upload .\` で確かめられる）。
- \`Dockerfile\` で動かしているなら、\`COPY\` でプログラムと \`.agentguard/\` がイメージに入るか（\`COPY . .\` なら大丈夫）。\`.dockerignore\` で除外していないか。
- **GitHub から自動でデプロイしている**（Cloud Build のトリガー・継続的デプロイ）ときだけは \`.agentguard/\` が届かないので、環境変数に入れる（ユーザーに確認してから。表示しないで渡す）：
  \`\`\`bash
  gcloud run services update ${service} --region ${region} --update-env-vars "AGENTGUARD_KEY=$(${DECODE_NODE})"
  \`\`\`${oldNext}`;
  }
  return `**何もしない。** プログラムが \`.agentguard/\` から読む。サーバーに上げるとき「.」ではじまるフォルダが上がらない仕組みなら、そのサーバーの環境変数 \`AGENTGUARD_KEY\` に入れる（取り出し方は下の「キーの取り出し方」。ユーザーに確認してから）。${oldNext}`;
}

function aiPublishStep(o: KitOptions, service: string, region: string): string {
  const moveOut = `1. \`${KIT_DIR}/\` をサイトのフォルダの外へ移す（ユーザーに確認して。キーが入っている）。`;
  if (o.host === "vercel") {
    return `${moveOut}
2. 置いたプログラムと、書き足したファイルだけを add して、コミットする（\`.agentguard\` は自動で除外される。\`git add -f\` はしない）：
   \`\`\`bash
   git add <置いたプログラム> <書き足したファイル>
   git commit -m "AgentGuard を追加"
   \`\`\`
3. Vercel がデプロイするブランチ（ふつうは \`main\`。Vercel のプロジェクト →「Settings」→「Git」で分かる）に push する：\`git push\`
4. Vercel の「Deployments」で、新しいデプロイが「Ready」になるのを待つ（CLI があれば \`npx vercel ls\` でも見られる）。`;
  }
  if (o.host === "cloudrun") {
    return `${moveOut}
2. プロジェクトが合っているか：\`gcloud config get-value project\`（分からなければユーザーに確認）
3. アップロードされるファイルに \`.agentguard/.settings\` が入っていて、\`${KIT_DIR}\` が入っていないか：
   \`\`\`bash
   gcloud meta list-files-for-upload .
   \`\`\`
4. 公開する：
   \`\`\`bash
   gcloud run deploy ${service} --source . --region ${region}
   \`\`\`
5. GitHub も使っているなら、置いたプログラムと書き足したファイルをコミットして push しておく（\`.agentguard\` は自動で除外される）。`;
  }
  return `${moveOut}
2. 自分の PC：動いているサーバーを止めて、いつもの方法で起動しなおす（例：\`${LOCAL_START[o.kind]}\`）。
3. ほかのサーバー：いつもの方法で、プログラムと \`.agentguard/\` も上げて、再起動する。
4. GitHub も使っているなら、置いたプログラムと書き足したファイルをコミットして push する。`;
}

export function aiSetupMd(o: KitOptions): string {
  const i = INSTALL[o.kind];
  const run = cloudRunService(o.siteHost);
  const service = run?.service ?? "<サービス名>";
  const region = run?.region ?? "<リージョン>";
  const base = o.basePath ?? "";
  const origin = new URL(o.siteUrl).origin;
  const verify = `${base}/.well-known/agentguard-verify.txt`;
  const port = o.kind === "fastapi" ? "8000" : "3000";
  const steps = aiSteps(o);
  const hostLabel = HOSTS.find((h) => h.id === o.host)!.label + (o.host === "cloudrun" ? `（サービス \`${service}\`・リージョン \`${region}\`）` : "");
  const keyPath = o.kind === "next" ? ".agentguard/.settings" : "<置いたフォルダ>/.agentguard/.settings";
  return `# AgentGuard につなぐ作業の指示書（Claude Code など AI アシスタント向け）

> **人が読むところ**
> 1. この \`${KIT_DIR}\` フォルダを、サイトのフォルダ（\`${o.kind === "fastapi" ? "main.py" : "package.json"}\` があるフォルダ）の中に置きます。
> 2. そのフォルダで Claude Code を開いて、次のように頼みます。
>
>    「${AI_PROMPT}」
>
> 3. GitHub に送る（push）・公開する（デプロイ）前に、Claude Code が確認を聞いてきます。内容を見て OK してください。

---

以下は Claude Code への指示です。
${o.key === null ? `
> **このセットには接続キーが入っていません。** 作業を始めずに、ユーザーに「AgentGuard の『守るサイト』の画面で『キーをなくした・作り直す』を押してから、フォルダをダウンロードしなおしてください」と伝えて止まる。
` : ""}
## 目的

このリポジトリのサイトを AgentGuard（WAF と AI エージェントでサイトを守るサービス）につなぐ。サイトの処理より先に動くプログラムを1つ置き、届いたアクセスを AgentGuard に検査させる。攻撃と判断されたアクセスは 403 で止まり、サイトのコードには届かない。

| 項目 | 値 |
|---|---|
| 守るサイト | ${o.siteUrl} |
| サイトの種類 | ${KIND_LABEL[o.kind]} |
| 公開しているところ | ${hostLabel} |
| 置くプログラム | \`${KIT_DIR}/files_for_your_site/${i.fileName}\` |
| キーを保存したフォルダ | \`${KIT_DIR}/files_for_your_site/.agentguard/\` |
| AgentGuard の画面 | ${o.dashboardUrl}/app/site |
| 確認用のパス | \`${verify}\` |

## 必ず守ること

1. **接続キーを表示しない。** \`.agentguard/.settings\`、\`${VERCEL_FILE}\`、\`READ_ME_FIRST.html\` の中身を cat などで表示したり、ログ・チャット・コミットメッセージ・コードに書いたりしない。キーが必要なときは、下の「キーの取り出し方」のように、表示せずにコマンドへ直接渡す。
2. **\`.agentguard/\` を git に入れない。** 中の \`.gitignore\`（中身は \`*\`）が防いでいる。このファイルを消さない。\`git add -f\` を使わない。
3. **プログラムの中身を書きかえない。** 例外は、Next.js のバージョンに合わせた名前の変更と設定の追加、すでにある proxy / middleware と1つにまとめるときだけ。
4. **攻撃のテストをしない。** 攻撃の形をした文字列を、このサイトにもほかのサイトにも送らない。確かめるのはふつうのアクセスだけ。AI チームの動きは、AgentGuard の画面の「攻撃シミュレーター」で見られる（本物のサイトには何も送らない）。
5. **外に出る操作の前に、ユーザーに確認する。** git push、デプロイ、環境変数の変更など。
6. **公開の前に、\`${KIT_DIR}/\` をサイトのフォルダの外へ移す**（ユーザーに確認して）。このフォルダにもキーが入っている。git には入らない（フォルダの中の \`.gitignore\`）が、\`gcloud run deploy --source .\` などではいっしょにアップロードされてしまう。

## このプログラムがすること（ユーザーに説明するとき用）

- サイトに届いたリクエストごとに、メソッド・パス・クエリ・フォームや JSON の中身・User-Agent・Referer・接続元 IP を、AgentGuard に HTTPS で送る。答えが \`block\` なら 403 を返す。パスワードやトークンらしい欄は、伏せ字にして送る（攻撃の形をした値だけは、検査のためそのまま送る）。
- AgentGuard に 2 秒以内に確認できないときは、サイトを止めないように、そのまま通す（環境変数 \`AGENTGUARD_FAIL_CLOSED=true\` なら、503 で止める）。
- \`${verify}?challenge=…\` には、キーから作った HMAC の答え（64 文字の 16 進数）を返す。キーそのものは外に出ない。AgentGuard はこれで「このサイトの持ち主がつないだ」ことを確かめる。
- \`/.agentguard\` と \`/${KIT_DIR}\` を含むパスには、いつも 404 を返す。
- キーは、環境変数 \`AGENTGUARD_KEY\` があればそれを、なければ \`.agentguard/.settings\` を使う。

## 手順

### 1. 前もって確かめる

- git の中か：\`git rev-parse --is-inside-work-tree\`。\`git status --short\` で、ほかの変更がないかも見る（あればユーザーに伝える）。
- サイトの種類が本当に ${KIND_LABEL[o.kind]} か（${steps.check}）。ちがうときは作業を止めて、ユーザーに「AgentGuard の画面のステップ1で種類を選びなおして、フォルダをダウンロードしなおしてください」と伝える。
- ${steps.prereq}
- すでに AgentGuard のコードが入っていないか（前に手で入れた \`AGENTGUARD_KEY\` を読むコードや、\`agentguard-verify\` のルートなど）：
  \`\`\`bash
  grep -rn -e AGENTGUARD -e agentguard-verify . --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.git --exclude-dir=${KIT_DIR}
  \`\`\`
  見つかったら、守る処理が2重にならないように、ユーザーに確認してから古いほうを外して、この新しいファイル1つにまとめる。

### 2. ファイルを置く

${steps.place}

### 3. 書き足す

${steps.add}

### 4. 接続キー

${aiKeyStep(o, service, region)}

### 5. 手元で確かめる

1. 環境変数 \`AGENTGUARD_KEY\` を設定しないで、いつもの方法で起動する（保存したキーが読めることを確かめるため）。例：\`${LOCAL_START[o.kind]}\`（このプロジェクトの起動方法がちがえば、それに合わせる）。下の \`${port}\` は、このサイトのポートに合わせる。
2. 確認用の答え（64 文字の 16 進数が返れば、プログラムが動いていて、キーも読めている）：
   \`\`\`bash
   curl -s "http://localhost:${port}${verify}?challenge=check"
   \`\`\`
3. キーのフォルダが外から見えないか（404 ならよい）：
   \`\`\`bash
   curl -s -o /dev/null -w "%{http_code}\\n" "http://localhost:${port}/.agentguard/.settings"
   \`\`\`
4. ふつうのページ（今までと同じ結果ならよい）：
   \`\`\`bash
   curl -s -o /dev/null -w "%{http_code}\\n" "http://localhost:${port}${base}/"
   \`\`\`
5. git に入らないか（\`git status\` に \`.agentguard\` と \`${KIT_DIR}\` が出ず、\`check-ignore\` が \`.agentguard/.gitignore\` を理由に出せばよい）：
   \`\`\`bash
   git status --short
   git check-ignore -v ${keyPath}
   \`\`\`
6. 確かめ終わったら、起動したサーバーを止める。

4 のアクセスで AgentGuard に最初の報告が届き、AgentGuard の画面が「つながりました」に変わることがある。まだ公開していないので、「あなたのサイトだと確かめられませんでした」と出てもよい（手順7のあとで「もう一度確かめる」を押せばよい）。

### 6. 公開する（ユーザーの確認のあと）

${aiPublishStep(o, service, region)}

### 7. 公開したあとに確かめる

\`\`\`bash
# 64 文字の 16 進数が返ればよい
curl -s "${origin}${verify}?challenge=check"
# 404 ならよい
curl -s -o /dev/null -w "%{http_code}\\n" "${origin}/.agentguard/.settings"
# 今までと同じ（200 など）ならよい
curl -s -o /dev/null -w "%{http_code}\\n" "${o.siteUrl}"
\`\`\`

そのあと、ユーザーに AgentGuard の画面（${o.dashboardUrl}/app/site）を開いてもらい、「つながりました」になったか見てもらう。「あなたのサイトだと確かめられませんでした」と出ていたら、「もう一度確かめる」を押してもらう。

## キーの取り出し方（環境変数に入れるときだけ）

\`.agentguard/.settings\` のキーは、見ただけでは分からない形（固定の文字列 \`agentguard\` との XOR を base64 にしたもの）で保存してある。環境変数に入れるときは、**表示せずに**、取り出した結果をそのままコマンドに渡す（bash。\`.agentguard\` があるフォルダで実行）。

- Node.js：
  \`\`\`bash
  ${DECODE_NODE}
  \`\`\`
- Python：
  \`\`\`bash
  ${DECODE_PY}
  \`\`\`
- 使い方の例：\`--update-env-vars "AGENTGUARD_KEY=$(上のコマンド)"\`。この結果を echo したり、ファイルに保存したりしない。

## うまくいかないとき

| 症状 | 見るところ |
|---|---|
| 確認用のパスで、サイトのページや 404 が返る | プログラムが動いていない。Next.js：ファイルの場所（\`src\` の有無）・名前（バージョン）・\`config.matcher\`。Express：書き足した行が、ルートや \`express.static\` より上にあるか。FastAPI：\`protect(app)\` を、実際に動く \`app\` に呼んでいるか。 |
| 手元では 64 文字が返るのに、公開したあとは返らない | プログラムかキーが、公開先に届いていない。Vercel：環境変数 \`AGENTGUARD_KEY\` を入れたあとにデプロイしたか。Cloud Run：\`gcloud meta list-files-for-upload .\` に \`.agentguard/.settings\` があるか、\`Dockerfile\` の \`COPY\` と \`.dockerignore\`。 |
| ページに「安全のため、一時的にアクセスを止めています」と出る | \`AGENTGUARD_FAIL_CLOSED=true\` が設定されていて、AgentGuard に確認できていない（キーがちがう・通信できない）。 |
| ふつうのページに「AgentGuard がこのアクセスを止めました」と出る | 誤検知の可能性。プログラムを外したり書きかえたりせず、止まった URL と時刻をユーザーに伝える。 |
| キーを作り直した | 古いキーはもう使えない。ユーザーにフォルダをダウンロードしなおしてもらい、\`.agentguard/\` を入れかえる（環境変数にも入れていたら、それも入れかえる）。 |

## 終わったら、ユーザーに報告すること

- 置いたファイルと、書き足した行（ファイル名と場所）
- 手順5と手順7の結果（通ったもの・通らなかったもの）
- ユーザーにやってもらうこと（例：Vercel の環境変数、AgentGuard の画面で「つながりました」になったかの確認、\`${KIT_DIR}/\` の保管か削除）
`;
}

/** The saved-key folder: the key, and a .gitignore so git never sends the folder anywhere. */
function savedKeyFiles(dir: string, key: string): { path: string; text: string }[] {
  return [
    { path: `${dir}/${SAVED_DIR}/.gitignore`,
      text: "# AgentGuard の設定フォルダです。GitHub などに送られないように、このフォルダの中身はすべて送らない設定にしています。\n# このファイルは消さないでください。\n*\n" },
    { path: `${dir}/${SAVED_DIR}/${SAVED_FILE}`,
      text: `# AgentGuard の設定です。書きかえないでください。\n${encodeSavedKey(key)}\n` },
  ];
}

export function buildSetupKit(o: KitOptions): { name: string; files: { path: string; text: string }[] } {
  const root = KIT_DIR;
  const site = `${root}/files_for_your_site`;
  return {
    name: `${KIT_DIR}-${o.siteHost.split(".")[0]}.zip`,
    files: [
      { path: `${root}/READ_ME_FIRST.html`, text: guideHtml(o) },
      { path: `${root}/${AI_GUIDE}`, text: aiSetupMd(o) },
      { path: `${root}/.gitignore`, text: "# AgentGuard の設定セットです（キーが入っています）。GitHub などに送らない設定です。\n*\n" },
      { path: `${site}/${INSTALL[o.kind].fileName}`, text: o.snippet },
      ...(o.key !== null ? savedKeyFiles(site, o.key) : []),
      ...(o.key !== null && o.host === "vercel" ? [{ path: `${root}/${VERCEL_FILE}`, text: vercelKeyText(o.key) }] : []),
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
