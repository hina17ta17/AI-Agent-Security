import type { Timestamp } from "firebase/firestore";

const JST_TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const JST_DATETIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
});

export const USD_TO_JPY = 150; // display-only conversion, shown next to every yen figure

export function toDate(t?: Timestamp | Date | string | null): Date | null {
  if (!t) return null;
  if (t instanceof Date) return t;
  if (typeof t === "string") return new Date(t);
  return t.toDate();
}

export const timeJst = (t?: Timestamp | Date | string | null) => {
  const d = toDate(t);
  return d ? JST_TIME.format(d) : "—";
};

export const dateTimeJst = (t?: Timestamp | Date | string | null) => {
  const d = toDate(t);
  return d ? JST_DATETIME.format(d) : "—";
};

export function ms(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return value < 1 ? value.toFixed(2) : value < 10 ? value.toFixed(1) : Math.round(value).toString();
}

export function seconds(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(1);
}

export function yen(usd?: number | null): string {
  if (usd === null || usd === undefined) return "—";
  const jpy = usd * USD_TO_JPY;
  return jpy < 0.1 ? "0.1円未満" : `約${jpy < 10 ? jpy.toFixed(1) : Math.round(jpy)}円`;
}

export function remaining(until: Date | null, now: number): string {
  if (!until) return "—";
  const sec = Math.max(0, Math.round((until.getTime() - now) / 1000));
  if (sec >= 3600) return `あと${Math.floor(sec / 3600)}時間${Math.floor((sec % 3600) / 60)}分`;
  if (sec >= 60) return `あと${Math.floor(sec / 60)}分`;
  return `あと${sec}秒`;
}

export function ago(t: Timestamp | Date | null | undefined, now: number): string {
  const d = toDate(t);
  if (!d) return "";
  const sec = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  return `${Math.floor(sec / 86400)}日前`;
}

export const ATTACK_LABEL: Record<string, string> = {
  sqli: "SQLインジェクション",
  xss: "XSS",
  path_traversal: "パストラバーサル",
  cmd_injection: "OSコマンド実行",
  prompt_injection: "AIをだます攻撃",
  recon: "偵察",
  benign: "誤検知の可能性",
  other: "その他の攻撃",
};

export const SEVERITY = {
  low: { label: "低", tone: "safe" },
  medium: { label: "中", tone: "warn" },
  high: { label: "高", tone: "danger" },
  critical: { label: "重大", tone: "danger" },
} as const;

export const ACTOR_LABEL: Record<string, string> = {
  "agent:mamoru": "マモル",
  "system:policy": "自動ルール",
  "system:fallback": "自動ルール（AI不使用）",
  "system:wave": "攻撃の波（ルール）",
  user: "あなた",
  owner: "管理者",
  system: "システム",
};

/** Every action written to tenants/{uid}/audit, by the AI team, the rules or a person. */
export const AUDIT_ACTION: Record<string, string> = {
  block_ip: "IPをブロック",
  watch_ip: "監視リストに追加",
  request_isolation: "サイト停止の承認を依頼",
  incident_closed: "対応を完了",
  approve_isolation: "サイト停止を承認",
  reject_isolation: "サイト停止を却下",
  unblock_ip: "ブロックを解除",
  restore_site: "メンテナンスを解除",
  register_site: "守るサイトを登録",
  verify_site: "サイトの所有を確認",
  remove_site: "サイトの登録をやめる",
  rotate_connection_key: "接続キーを作り直す",
  update_allowlist: "許可リストを更新",
  register_api_key: "APIキーを登録",
  delete_api_key: "APIキーを削除",
  switch_ai_mode: "AIの実行モードを変更",
  set_byok_limit: "自分のキーの1日の上限を変更",
  become_self_owner: "AgentGuard の管理者になった",
  confirm_sign_in: "ログインを本人と確認",
  sign_out_everywhere: "すべての端末からログアウト",
  delete_history: "攻撃の記録を削除",
};

export const AUDIT_RESULT: Record<string, string> = {
  blocked: "ブロックしました",
  watching: "監視中",
  refused: "ルールにより拒否",
  pending_human_approval: "人の承認待ち",
  resolved: "解決",
  awaiting_approval: "承認待ちで完了",
  fallback: "ルールで対処して完了",
  site_in_maintenance: "サイトを一時停止",
  site_normal: "通常に戻しました",
  rejected: "却下",
  unblocked: "解除しました",
  pending_verification: "所有の確認待ち",
  verified: "確認できました",
  removed: "やめました",
  rotated: "作り直しました",
  ok: "完了",
  encrypted_and_stored: "暗号化して保存",
  deleted: "削除しました",
  acknowledged: "確認しました",
  all_sessions_revoked: "全端末をログアウト",
};
