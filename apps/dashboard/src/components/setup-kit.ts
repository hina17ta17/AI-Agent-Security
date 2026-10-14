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
 *   └─ for_vercel_settings.txt             Vercel only: the key to paste into Vercel's settings
 *
 * The key is saved from the start, so a site deployed from its folder (Cloud Run with gcloud, own
 * PC, most servers) needs no environment variable at all. A site built from GitHub (Vercel) never
 * receives the folder, by design, so only there the key also goes into the hosting's settings.
 * File names are ASCII on purpose: some unzip tools garble non-ASCII names. The guide is Japanese.
 */

import { encodeSavedKey, INSTALL, SAVED_DIR, SAVED_FILE, type ServerFramework } from "./site-snippets";

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
       <li>Next.js のバージョンが15より前のときは、ファイルの名前を <code>middleware.ts</code> に変えてください。</li>
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
</table></div>
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
  const root = "agentguard-setup";
  const site = `${root}/files_for_your_site`;
  return {
    name: `agentguard-setup-${o.siteHost.split(".")[0]}.zip`,
    files: [
      { path: `${root}/READ_ME_FIRST.html`, text: guideHtml(o) },
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
