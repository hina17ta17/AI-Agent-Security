# AgentGuard 設計書

> 第5回 Agentic AI Hackathon with Google Cloud 提出用。締切 2026-10-15 23:59。
> この文書は開発の前提をまとめたもの。提出用の README・構成図はここから作る。

## 1. コンセプト

普段は軽量なWAFが静かに見張り、攻撃が来た瞬間だけAIエージェントのチームが出動して、解析・防御・報告まで自律的に行うセキュリティ防衛プラットフォーム。

- **誰でも使える**：自分の Gemini API キーをダッシュボードに入れるだけで使える（BYOK）。キーは入力後に二度と表示されず、開発者も見られない。
- **使えるAI（大会テーマ）**：AIへの攻撃（プロンプトインジェクション）にも耐え、AIができる操作を制限し、すべての行動を記録する。

### 審査基準との対応

| 審査基準 | このシステムでの答え |
|---|---|
| 課題の新規性・有効性 | セキュリティ担当者がいない小規模事業者や個人開発者でも、攻撃に即応できる。説明はやさしい日本語で行う |
| 自律性・エージェントらしさ | 攻撃を検知して自動で起動し、AIが判断して防御を実行する。重大な操作だけ人の承認を待つ。思考ログとトレースで可視化する |
| 実装品質・拡張性 | Cloud Run・Pub/Sub によるイベント駆動で、普段のコストはほぼゼロ。マルチテナント、KMS暗号化、1インシデントあたりのAIコストを表示する |

## 2. 全体構成

```
                 ┌──────────────── Firebase Authentication（Googleログイン / メール）
                 ▼
[ダッシュボード Next.js / Cloud Run: dashboard]
   │  ├ APIキー登録（KMSで暗号化のみ可能）
   │  ├ 攻撃シミュレータ（自分のデモサイトだけに送る）
   │  └ 承認ボタン（人の承認が必要な操作）
   │          ▲ Firestore onSnapshot でリアルタイム表示
   ▼          │
[守られる側のデモサイト + 軽量WAF / Cloud Run: target]
   │ 不正リクエストはその場で403（数ミリ秒）。ブロックリストも参照
   │ 検知したら Pub/Sub へイベントを送る
   ▼
[Pub/Sub: security-events] ──push（OIDC認証）──▶ [AIエージェント ADK / Cloud Run: agent]
                                                  ├ ① 前処理（コード）：切り詰め・無害化
                                                  ├ ② Model Armor：攻撃文にAI向けの罠がないか検査
                                                  ├ ③ シラベ（解析）  ─┐
                                                  ├ ④ マモル（防御）   ├ Gemini 3.8 Flash
                                                  └ ⑤ ツタエ（報告）  ─┘
                         [Firestore] ◀── インシデント・思考ログ・ブロックリスト・監査ログ
                         [Cloud KMS] ◀── テナントのAPIキーを復号（agent だけが可能）
                         [Cloud Trace / Logging] ◀── 全処理のトレース
```

- リージョンは `asia-northeast1`（東京）。Gemini は `global`、Model Armor は日本語の検出に対応している `us`（東京リージョンは多言語検出に非対応）
- Cloud Run はリクエストがない間はインスタンス0台まで縮むため、普段のコストはほぼゼロ

## 3. 処理の流れと「本当の」時間

| フェーズ | 何が起きるか | 担当 | 目安 |
|---|---|---|---|
| ① 平常 | 画面は緑「平常運転中」。WAFが見張っている | target | — |
| ② 検知・初動遮断 | WAFのルールに当たったリクエストを即403で止め、イベントを送る | target（コード） | **数ms** |
| ③ 出動 | 画面が赤になり、通知音が鳴る。「AIチーム出動！」 | dashboard | 〜0.5秒 |
| ④ 解析 | シラベが攻撃の種類・確信度・根拠を出し、思考の要約を実況する | agent | 3〜5秒 |
| ⑤ 防御 | マモルが判断し、IPブロックなどを実行する（許可された操作のみ） | agent | 3〜5秒 |
| ⑥ 報告・復旧 | ツタエが報告書を書き、画面が緑に戻る。所要時間とAIコストを表示する | agent | 防御後に実施 |

> 実測（2026-10-11、自宅PCから `gemini-3.8-flash` / global）：thinking LOW で 3.5〜5.5秒、MEDIUM で 9.5秒。初回だけ認証の準備に約18秒かかる。
> → 全エージェントを LOW にする。シラベは `gemini-3.5-flash-lite` との比較も検討する。Cloud Run（東京）からも計測し直す。

- 画面には「**初動遮断：○ms**（WAF）」と「**AI対処完了：○秒**（AI）」を分けて表示する。架空の数字は出さない
- 報告は防御が終わってから作るので、防御完了までに必要なAI呼び出しは2回で済む
- AIを常駐させない（イベントが来たときだけ起動）。コールドスタートの対策は、デモのときだけ最小インスタンス数を1にする

## 4. AIエージェント設計（ADK 2.x / Python）

| エージェント | 役割 | 出力 | 使えるツール |
|---|---|---|---|
| **シラベ**（解析） | 攻撃の種類・確信度・根拠・重大度を判定 | 構造化JSON（`response_schema`） | なし（またはIPの過去履歴を読むだけ） |
| **マモル**（防御） | 判定をもとに防御を選んで実行 | ツール呼び出し | `block_ip` / `watch_ip` / `request_isolation`（承認制） |
| **ツタエ**（報告） | 非専門家にもわかる日本語の報告書を作成 | Markdown | なし |

- 構成：`SequentialAgent[シラベ → マモル] → ツタエ`。時間があれば、シラベを `ParallelAgent`（攻撃文の解析と、IP履歴・頻度の解析）に拡張する
- 思考の実況：Gemini の thought summaries（`include_thoughts=True`）を、コールバックで Firestore の `steps` に書き込む
- thinking level：すべて LOW（MEDIUM は実測で約2倍遅かった）。最初のアクセスが遅くならないよう、起動時に1回だけ呼び出して準備を済ませておく
- テナントID・サイトIDはサーバー側の状態から取り、**LLMの引数からは受け取らない**（AIが他のテナントを操作できないようにするため）

## 5. APIキー（BYOK）の扱い ★重要

### 方針
1. キーは **ダッシュボードで1回入力するだけ**。画面に表示されるのは `●●●●●●●●a1B2`（末尾4文字）と「検証済み」だけで、「表示」ボタンは作らない
2. サーバーは受け取ったキーを **すぐ検証**し（モデル一覧の取得など軽い呼び出し）、**Cloud KMS で暗号化**して保存する。平文はどこにも保存しない
3. **暗号化できるのは dashboard だけ、復号できるのは agent だけ**。開発者や Claude（claude-dev）は復号権限を持たない
4. 暗号化のときに `AAD = "tenant:{uid}"` を付ける。暗号文を別のテナントにコピーしても復号できない
5. agent はインシデントの処理中だけメモリ上で復号し、`genai.Client(api_key=...)` → `Gemini(model=..., client=client)` で**実行ごとに専用のクライアント**を作る
   - 注意：ADK はデフォルトだとプロセス全体の環境変数からキーを読む。同時に処理していると別のテナントのキーが混ざる危険があるので、環境変数は使わない
   - 注意：キーを ADK の session state やイベントには入れない（永続化・表示されてしまうため）
6. ログ・トレース・エラーメッセージにキーを出さない（ログ出力時にマスクする処理を入れる）
7. 削除すると暗号文を消す。置き換えは上書き

### 誰がキーを見られるか
| 主体 | 平文を見られるか |
|---|---|
| ユーザー本人 | 入力するときだけ（その後はブラウザにも残らない） |
| dashboard（sa-dashboard） | 受け取った瞬間だけ（暗号化はできるが復号はできない） |
| agent（sa-agent） | 処理中だけメモリ上で |
| 開発者・Claude（claude-dev） | **見られない**（KMSの復号権限なし。Firestore には暗号文しかない） |

正直な限界：コードをデプロイできる人は、理論上「キーを外に送るコード」をデプロイできる。対策は、コードレビュー、KMS復号の監査ログ（Data Access ログを有効化）、デプロイ履歴を残すこと。

### 画面に出す注意書き
- 「専用のキーを作り、Gemini API だけに制限することをおすすめします」
- 「無料枠のキーでは、送信内容が Google の改善に使われる場合があります」

### 審査員・お試し用の「デモモード」（採用）
- 審査員はAPIキーを持っていない可能性が高い。提出物でもテストアカウントが必須
- デモモードでは、キーの代わりに当プロジェクトの Gemini（Agent Platform 経由、サービスアカウント認証。300ドルクーポンの対象）を使う
- **回数制限**：1テナントあたり1日10件、全体で1日100件

## 6. マルチテナント・認証

- Firebase Authentication（Googleログイン＋審査員用のメール/パスワード）。テナント = `uid`
- 各テナントに推測しにくい `siteId` を払い出し、デモサイトは `target/s/{siteId}/...` にする
- Firestore セキュリティルール：クライアントは自分のテナントのデータを**読むだけ**。書き込みはすべてサーバー経由。`tenantSecrets` にはクライアントから一切アクセスさせない
- **攻撃シミュレータは自分のデモサイトにしか送れない**（任意のURLを攻撃できる機能は作らない）
- 擬似的な攻撃元IPには、文書用に予約されたアドレス範囲（`203.0.113.0/24`、`198.51.100.0/24`）を使う。実在する人を誤ってブロックしないため
  - target は、dashboard のサービスアカウントの ID トークンが付いたリクエストに限り、擬似IPヘッダ（`X-Demo-Source-IP`）を信用する
- 乱用対策：同じIP・同じ種類の攻撃は1つのインシデントにまとめる。すでにブロック済みのIPはAIを呼ばない。テナントごとにAIの起動回数の上限を設ける

## 7. ガバナンス・セキュリティ（大会テーマの中心）

1. **AIへの攻撃を想定する**：攻撃文は攻撃者が自由に書ける文章なので、そのままLLMに渡すと危険
   - コードで切り詰め（例：2KBまで）、区切り記号で囲み、「信頼できないデータ」と明示してから渡す
   - Model Armor（ADK の `ModelArmorPlugin`）でプロンプトインジェクションと脱獄を検査する
   - 検知したら「**AIをだまそうとする攻撃も検知**」として画面に出す（デモの見せ場。攻撃ボタンも用意する）
2. **AIは守りを固める方向にしか動けない**：ブロック解除や設定を緩める操作はAIのツールに入れない（人だけができる）
3. **ツール側でも強制チェック**：IPの形式、自分の許可リストは除外、ブロック時間は最大24時間、テナントはサーバー側の状態から取る
4. **重大な操作は人の承認制**：`request_isolation`（デモサイトをメンテナンスモードにする）は承認待ちとしてFirestoreに積み、ダッシュボードで承認されたらサーバーが実行する
   - ADK の `require_confirmation` も使えるが、セッションの永続化が必要になるので今回は使わない
5. **監査ログ**：AI・人のすべての操作を `audit` に記録する（誰が、何を、なぜ、結果）
6. **最小権限**：サービスごとに専用のサービスアカウントを用意する（§10）

## 8. 可観測性

- ADK の OpenTelemetry で Cloud Trace にトレースを出す（`get_gcp_exporters(enable_cloud_tracing=True)`）
- インシデントの画面に traceId と Cloud Trace へのリンクを出す
- 構造化ログ（JSON）には `incident_id` を付ける。秘密情報は出さない
- 1インシデントあたりのトークン数と推定コストを表示する（`usage_metadata` から計算。目安は約0.01ドル/件）
- 平均検知時間・平均対処時間をダッシュボードに出す

## 9. データモデル（Firestore, Native モード）

```
tenants/{uid}
  siteId, aiMode: "byok"|"demo", keyHint: "a1B2", keyStatus: "none"|"valid"|"invalid", keyUpdatedAt
  status: "safe"|"alert"|"responding", activeIncidentId
  settings: { allowlist: [cidr], maxBlockMinutes, requireApprovalFor: ["isolate"] }
tenants/{uid}/incidents/{incidentId}
  status: detected|analyzing|defending|awaiting_approval|resolved|failed
  attack: { ruleId, type, method, path, srcIp, payloadPreview }
  timings: { receivedAt, wafBlockedMs, publishedAt, aiStartedAt, actionAt, resolvedAt }
  verdict: { attackType, confidence, severity, evidence[] }
  guard: { promptInjection: bool, jailbreak: bool }
  actions[], report: { summary, details, recommendations[] }
  traceId, tokenUsage, estCostUsd
tenants/{uid}/incidents/{id}/steps/{stepId}
  agent: system|shirabe|mamoru|tsutae, kind: thought|message|tool_call|tool_result|guard, text, at
tenants/{uid}/blocklist/{ip}      reason, incidentId, createdAt, expiresAt（TTLポリシーで自動削除）
tenants/{uid}/approvals/{id}      action, params, status: pending|approved|rejected, requestedBy, decidedAt
tenants/{uid}/audit/{id}          actor, action, params, result, at
tenantSecrets/{uid}               ciphertext, kmsKeyVersion, createdAt   ← クライアントは一切アクセス不可
sites/{siteId}                    tenantId
usage/{uid}_{yyyymmdd}            incidents, tokens
```

個人情報（メールアドレスなど）は Firestore に保存しない。表示名は Firebase Auth からクライアントで取得する。

## 10. Google Cloud リソースと権限

| リソース | 名前 |
|---|---|
| Cloud Run | `dashboard` / `target` / `agent` |
| Pub/Sub | `security-events`（push → agent `/pubsub`）、`security-events-dlq` |
| Firestore | `(default)`、asia-northeast1 |
| Cloud KMS | keyring `byok` / key `tenant-gemini-key`（90日ごとに自動ローテーション） |
| Model Armor | テンプレート（`us`）：入力用・出力用 |
| Firebase | Authentication |

| サービスアカウント | 主な権限 | 持たない権限 |
|---|---|---|
| `claude-dev`（Claudeの作業用） | Cloud Run 管理、ソースデプロイ、Pub/Sub、Firestore、Rules、Model Armor 管理、Agent Platform 利用、ログ・トレース閲覧、実行用SAへの actAs | Owner/Editor、IAM変更、SAの管理・鍵の発行、**KMS**、Secret Manager、APIキー、請求 |
| `sa-dashboard` | Firestore、**KMS暗号化のみ** | KMS復号 |
| `sa-target` | Firestore、Pub/Sub publish | KMS |
| `sa-agent` | Firestore、**KMS復号**、Model Armor 利用、Agent Platform 利用 | KMS暗号化 |
| `sa-pubsub-push` | agent の起動（`run.invoker`。サービス単位で付与） | — |
| `sa-build` | Cloud Run Builder | — |

初期設定は [infra/bootstrap.ps1](../infra/bootstrap.ps1)（本人が自分のアカウントで実行する）。

## 11. ダッシュボードのデザイン方針：明るい × かっこいい × 親しみ

- **トーン**：白を基調にした明るい画面。指令室のようなかっこよさと、キャラクターがいる親しみやすさを両立する
- **配色**（ライトテーマ）

| 用途 | 色 |
|---|---|
| 背景 / カード | `#F6F8FC` / `#FFFFFF` |
| 文字 / 補助文字 / 線 | `#0F172A` / `#64748B` / `#E2E8F0` |
| ブランド | `#4F46E5` → `#06B6D4`（インディゴからシアンへのグラデーション） |
| 安全 / 解析中 / 危険 | `#10B981`（ミント） / `#F59E0B`（アンバー） / `#F43F5E`（ローズ） |

- **フォント**：見出しは丸みのある「Zen Maru Gothic」、本文は「Noto Sans JP」、IP・ログ・数字は「JetBrains Mono」
- **形**：角丸 16〜20px、やわらかい影、大きめの余白
- **キャラクター**：AIチームの4人にアバター（シンプルな図形のSVG）と名前を付け、状態に合わせて表情・色を変える
  - ミハリ（見張り＝WAF、AIではない）、シラベ（解析）、マモル（防御）、ツタエ（報告）
- **動き**：
  - 平常時は盾のリングがゆっくり呼吸するように光る。攻撃時はローズ色に変わって波紋が出る
  - 思考ログはチャットの吹き出しで流れる。数字はカウントアップする
  - `prefers-reduced-motion` の設定に従う
- **音**：きつくない2音のチャイム（Web Audio）。ミュートできる

### 画面
1. **ログイン / トップ**：キャラクターが並ぶヒーロー画面と「はじめる」ボタン
2. **ダッシュボード**：
   - 状態ヒーロー（盾と、平常運転中／迎撃中の表示）
   - チームパネル
   - ライブ実況
   - 指標カード（初動遮断ms、AI対処秒、ブロック中のIP、今月の推定AIコスト）
   - 攻撃シミュレータ（SQLi / XSS / パストラバーサル / AIをだます攻撃）
   - インシデント一覧と、残り時間付きのブロックリスト
3. **インシデント詳細**：タイムライン、報告書、トレースへのリンク、監査ログ、承認ボタン
4. **設定**：APIキー（マスク表示・置き換え・削除）、モード（BYOK / デモ）、許可リスト

### 技術
- Next.js（App Router, TypeScript）+ Tailwind CSS + lucide-react + motion
- Firebase JS SDK（Auth / Firestore の読み取り）
- バージョンは実装するときに確認する

## 12. 提出時に明記するモック・制約

- 攻撃はデモ用シミュレータから送る。攻撃元IPは文書用アドレス範囲を擬似的に付与している
- 防御の対象は自前のデモサイトで、アプリ層のブロックリストで防いでいる。Cloudflare や Cloud Armor との連携は拡張案（ツール1つの追加で対応できる設計）
- WAFのルールは簡易版（主要な攻撃パターンの正規表現）。OWASP CRS 相当ではない

## 13. スケジュール

| 日付 | 内容 |
|---|---|
| 10/10 | 準備（この文書、GCPの初期設定、Firebase の設定） |
| 10/11 | target（WAF）、Pub/Sub、Firestore。ローカルでエージェントの骨組みを作る |
| 10/12 | エージェント3体、ツール、Model Armor、KMS（BYOK）→ Cloud Run にデプロイ |
| 10/13 | ダッシュボード（デザイン、リアルタイム表示、攻撃ボタン、設定画面） |
| 10/14 | 全体の結合、承認フロー、可観測性、構成図、審査員用アカウント |
| 10/15 | デモ動画、README、**夕方までに提出** |

## 14. 決定事項・未確定事項

- [x] プロダクト名：**AgentGuard**
- [x] プロジェクトID：決定済み。リポジトリには書かず `.env` で渡す
- [x] デモ動画：提出直前に撮影する（10/15）
- [x] 審査員・お試し用のデモモード：**入れる**（Agent Platform 経由、回数制限あり）
- [x] GitHub リポジトリ：`hina17ta17/AI-Agent-Security`
