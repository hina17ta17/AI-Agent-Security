> **このファイルについて**：「守るサイト」の画面でダウンロードするフォルダ（`agentguard-setup`）に入っている指示書と同じものです（RGB：Express・Cloud Run 用）。
> Claude Code に実際に使わせるときは、キーを保存したフォルダ（`.agentguard`）がいっしょに必要です。ダウンロードしたフォルダの中の `CLAUDE_CODE_SETUP.md` を使ってください。

# AgentGuard につなぐ作業の指示書（Claude Code など AI アシスタント向け）

> **人が読むところ**
> 1. この `agentguard-setup` フォルダを、サイトのフォルダ（`package.json` があるフォルダ）の中に置きます。
> 2. そのフォルダで Claude Code を開いて、次のように頼みます。
>
>    「agentguard-setup/CLAUDE_CODE_SETUP.md を読んで、その手順でこのサイトを AgentGuard につないでください。」
>
> 3. GitHub に送る（push）・公開する（デプロイ）前に、Claude Code が確認を聞いてきます。内容を見て OK してください。

---

以下は Claude Code への指示です。

## 目的

このリポジトリのサイトを AgentGuard（WAF と AI エージェントでサイトを守るサービス）につなぐ。サイトの処理より先に動くプログラムを1つ置き、届いたアクセスを AgentGuard に検査させる。攻撃と判断されたアクセスは 403 で止まり、サイトのコードには届かない。

| 項目 | 値 |
|---|---|
| 守るサイト | https://rgb-1032914465512.asia-northeast1.run.app |
| サイトの種類 | Express（Node.js） |
| 公開しているところ | Cloud Run（サービス `rgb`・リージョン `asia-northeast1`） |
| 置くプログラム | `agentguard-setup/files_for_your_site/agentguard.cjs` |
| キーを保存したフォルダ | `agentguard-setup/files_for_your_site/.agentguard/` |
| AgentGuard の画面 | https://dashboard-1032914465512.asia-northeast1.run.app/app/site |
| 確認用のパス | `/.well-known/agentguard-verify.txt` |

## 必ず守ること

1. **接続キーを表示しない。** `.agentguard/.settings`、`for_vercel_settings.txt`、`READ_ME_FIRST.html` の中身を cat などで表示したり、ログ・チャット・コミットメッセージ・コードに書いたりしない。キーが必要なときは、下の「キーの取り出し方」のように、表示せずにコマンドへ直接渡す。
2. **`.agentguard/` を git に入れない。** 中の `.gitignore`（中身は `*`）が防いでいる。このファイルを消さない。`git add -f` を使わない。
3. **プログラムの中身を書きかえない。** 例外は、Next.js のバージョンに合わせた名前の変更と設定の追加、すでにある proxy / middleware と1つにまとめるときだけ。
4. **攻撃のテストをしない。** 攻撃の形をした文字列を、このサイトにもほかのサイトにも送らない。確かめるのはふつうのアクセスだけ。AI チームの動きは、AgentGuard の画面の「攻撃シミュレーター」で見られる（本物のサイトには何も送らない）。
5. **外に出る操作の前に、ユーザーに確認する。** git push、デプロイ、環境変数の変更など。
6. **公開の前に、`agentguard-setup/` をサイトのフォルダの外へ移す**（ユーザーに確認して）。このフォルダにもキーが入っている。git には入らない（フォルダの中の `.gitignore`）が、`gcloud run deploy --source .` などではいっしょにアップロードされてしまう。

## このプログラムがすること（ユーザーに説明するとき用）

- サイトに届いたリクエストごとに、メソッド・パス・クエリ・フォームや JSON の中身・User-Agent・Referer・接続元 IP を、AgentGuard に HTTPS で送る。答えが `block` なら 403 を返す。パスワードやトークンらしい欄は、伏せ字にして送る（攻撃の形をした値だけは、検査のためそのまま送る）。
- AgentGuard に 2 秒以内に確認できないときは、サイトを止めないように、そのまま通す（環境変数 `AGENTGUARD_FAIL_CLOSED=true` なら、503 で止める）。
- `/.well-known/agentguard-verify.txt?challenge=…` には、キーから作った HMAC の答え（64 文字の 16 進数）を返す。キーそのものは外に出ない。AgentGuard はこれで「このサイトの持ち主がつないだ」ことを確かめる。
- `/.agentguard` と `/agentguard-setup` を含むパスには、いつも 404 を返す。
- キーは、環境変数 `AGENTGUARD_KEY` があればそれを、なければ `.agentguard/.settings` を使う。

## 手順

### 1. 前もって確かめる

- git の中か：`git rev-parse --is-inside-work-tree`。`git status --short` で、ほかの変更がないかも見る（あればユーザーに伝える）。
- サイトの種類が本当に Express（Node.js） か（`package.json` の dependencies に `express` がある）。ちがうときは作業を止めて、ユーザーに「AgentGuard の画面のステップ1で種類を選びなおして、フォルダをダウンロードしなおしてください」と伝える。
- Node.js が 18 以上か（`node --version`）。プログラムは `fetch` を使う。
- すでに AgentGuard のコードが入っていないか（前に手で入れた `AGENTGUARD_KEY` を読むコードや、`agentguard-verify` のルートなど）：
  ```bash
  grep -rn -e AGENTGUARD -e agentguard-verify . --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.git --exclude-dir=agentguard-setup
  ```
  見つかったら、守る処理が2重にならないように、ユーザーに確認してから古いほうを外して、この新しいファイル1つにまとめる。

### 2. ファイルを置く

1. `express()` を呼んでいるファイル（サーバーの入口）を探す：
   ```bash
   grep -rn "express()" --include=*.js --include=*.cjs --include=*.mjs --include=*.ts . | grep -v node_modules
   ```
2. `files_for_your_site/agentguard.cjs` を、そのファイルと同じフォルダに置く。
3. `files_for_your_site/.agentguard/` を、中の `.gitignore` と `.settings` ごと、同じフォルダに置く（`package.json` のフォルダでもよい。プログラムは、自分のフォルダと、起動したときのフォルダの両方を探す）。

### 3. 書き足す

1行だけ書き足す。
- 場所：`app.use(express.json())` / `app.use(express.urlencoded(...))` の**すぐ下**。ルート（`app.get` など）、`app.use(router)`、`express.static` より**上**。body を読む設定がなければ `const app = express();` のすぐ下。
- CommonJS（`require` で書かれている）：
  ```js
  require("./agentguard.cjs")(app);
  ```
- ES Modules（`package.json` に `"type": "module"`、または `import` で書かれている）：ファイルの先頭の import に `import agentguard from "./agentguard.cjs";` を足し、上の場所に `agentguard(app);` を書く。
- TypeScript をビルドして動かしているときは、実行される JS から `agentguard.cjs` が見えるようにする（ビルド先にコピーされないなら、`package.json` のフォルダに置いて `require(require("node:path").join(process.cwd(), "agentguard.cjs"))(app);`）。
- 書き足したあとの例：
  ```js
  const app = express();
  app.use(express.json());
  require("./agentguard.cjs")(app);   // ← この1行を足す
  
  app.get("/", (req, res) => { ... });
  ```

### 4. 接続キー

**ふつうは何もしない。** `gcloud run deploy --source .` で公開すると、`.agentguard/` もいっしょに届き、プログラムが読む。次だけ確かめる：
- `.gcloudignore` があるなら、`.agentguard` や「.」ではじまるファイルを除外していないか（手順6の `gcloud meta list-files-for-upload .` で確かめられる）。
- `Dockerfile` で動かしているなら、`COPY` でプログラムと `.agentguard/` がイメージに入るか（`COPY . .` なら大丈夫）。`.dockerignore` で除外していないか。
- **GitHub から自動でデプロイしている**（Cloud Build のトリガー・継続的デプロイ）ときだけは `.agentguard/` が届かないので、環境変数に入れる（ユーザーに確認してから。表示しないで渡す）：
  ```bash
  gcloud run services update rgb --region asia-northeast1 --update-env-vars "AGENTGUARD_KEY=$(node -e 'const p="agentguard",l=require("fs").readFileSync(".agentguard/.settings","utf8").split("\n").find(x=>x.startsWith("v1:"));process.stdout.write(Buffer.from(Buffer.from(l.slice(3).trim(),"base64").map((b,i)=>b^p.charCodeAt(i%p.length))).toString())')"
  ```

### 5. 手元で確かめる

1. 環境変数 `AGENTGUARD_KEY` を設定しないで、いつもの方法で起動する（保存したキーが読めることを確かめるため）。例：`node server.js`（このプロジェクトの起動方法がちがえば、それに合わせる）。下の `3000` は、このサイトのポートに合わせる。
2. 確認用の答え（64 文字の 16 進数が返れば、プログラムが動いていて、キーも読めている）：
   ```bash
   curl -s "http://localhost:3000/.well-known/agentguard-verify.txt?challenge=check"
   ```
3. キーのフォルダが外から見えないか（404 ならよい）：
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/.agentguard/.settings"
   ```
4. ふつうのページ（今までと同じ結果ならよい）：
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/"
   ```
5. git に入らないか（`git status` に `.agentguard` と `agentguard-setup` が出ず、`check-ignore` が `.agentguard/.gitignore` を理由に出せばよい）：
   ```bash
   git status --short
   git check-ignore -v <置いたフォルダ>/.agentguard/.settings
   ```
6. 確かめ終わったら、起動したサーバーを止める。

4 のアクセスで AgentGuard に最初の報告が届き、AgentGuard の画面が「つながりました」に変わることがある。まだ公開していないので、「あなたのサイトだと確かめられませんでした」と出てもよい（手順7のあとで「もう一度確かめる」を押せばよい）。

### 6. 公開する（ユーザーの確認のあと）

1. `agentguard-setup/` をサイトのフォルダの外へ移す（ユーザーに確認して。キーが入っている）。
2. プロジェクトが合っているか：`gcloud config get-value project`（分からなければユーザーに確認）
3. アップロードされるファイルに `.agentguard/.settings` が入っていて、`agentguard-setup` が入っていないか：
   ```bash
   gcloud meta list-files-for-upload .
   ```
4. 公開する：
   ```bash
   gcloud run deploy rgb --source . --region asia-northeast1
   ```
5. GitHub も使っているなら、置いたプログラムと書き足したファイルをコミットして push しておく（`.agentguard` は自動で除外される）。

### 7. 公開したあとに確かめる

```bash
# 64 文字の 16 進数が返ればよい
curl -s "https://rgb-1032914465512.asia-northeast1.run.app/.well-known/agentguard-verify.txt?challenge=check"
# 404 ならよい
curl -s -o /dev/null -w "%{http_code}\n" "https://rgb-1032914465512.asia-northeast1.run.app/.agentguard/.settings"
# 今までと同じ（200 など）ならよい
curl -s -o /dev/null -w "%{http_code}\n" "https://rgb-1032914465512.asia-northeast1.run.app"
```

そのあと、ユーザーに AgentGuard の画面（https://dashboard-1032914465512.asia-northeast1.run.app/app/site）を開いてもらい、「つながりました」になったか見てもらう。「あなたのサイトだと確かめられませんでした」と出ていたら、「もう一度確かめる」を押してもらう。

## キーの取り出し方（環境変数に入れるときだけ）

`.agentguard/.settings` のキーは、見ただけでは分からない形（固定の文字列 `agentguard` との XOR を base64 にしたもの）で保存してある。環境変数に入れるときは、**表示せずに**、取り出した結果をそのままコマンドに渡す（bash。`.agentguard` があるフォルダで実行）。

- Node.js：
  ```bash
  node -e 'const p="agentguard",l=require("fs").readFileSync(".agentguard/.settings","utf8").split("\n").find(x=>x.startsWith("v1:"));process.stdout.write(Buffer.from(Buffer.from(l.slice(3).trim(),"base64").map((b,i)=>b^p.charCodeAt(i%p.length))).toString())'
  ```
- Python：
  ```bash
  python -c 'import base64;p=b"agentguard";l=next(x for x in open(".agentguard/.settings",encoding="utf-8") if x.startswith("v1:"));r=base64.b64decode(l[3:].strip());print(bytes(b^p[i%len(p)] for i,b in enumerate(r)).decode(),end="")'
  ```
- 使い方の例：`--update-env-vars "AGENTGUARD_KEY=$(上のコマンド)"`。この結果を echo したり、ファイルに保存したりしない。

## うまくいかないとき

| 症状 | 見るところ |
|---|---|
| 確認用のパスで、サイトのページや 404 が返る | プログラムが動いていない。Next.js：ファイルの場所（`src` の有無）・名前（バージョン）・`config.matcher`。Express：書き足した行が、ルートや `express.static` より上にあるか。FastAPI：`protect(app)` を、実際に動く `app` に呼んでいるか。 |
| 手元では 64 文字が返るのに、公開したあとは返らない | プログラムかキーが、公開先に届いていない。Vercel：環境変数 `AGENTGUARD_KEY` を入れたあとにデプロイしたか。Cloud Run：`gcloud meta list-files-for-upload .` に `.agentguard/.settings` があるか、`Dockerfile` の `COPY` と `.dockerignore`。 |
| ページに「安全のため、一時的にアクセスを止めています」と出る | `AGENTGUARD_FAIL_CLOSED=true` が設定されていて、AgentGuard に確認できていない（キーがちがう・通信できない）。 |
| ふつうのページに「AgentGuard がこのアクセスを止めました」と出る | 誤検知の可能性。プログラムを外したり書きかえたりせず、止まった URL と時刻をユーザーに伝える。 |
| キーを作り直した | 古いキーはもう使えない。ユーザーにフォルダをダウンロードしなおしてもらい、`.agentguard/` を入れかえる（環境変数にも入れていたら、それも入れかえる）。 |

## 終わったら、ユーザーに報告すること

- 置いたファイルと、書き足した行（ファイル名と場所）
- 手順5と手順7の結果（通ったもの・通らなかったもの）
- ユーザーにやってもらうこと（例：Vercel の環境変数、AgentGuard の画面で「つながりました」になったかの確認、`agentguard-setup/` の保管か削除）
