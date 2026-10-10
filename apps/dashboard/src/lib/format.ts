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
  user: "あなた",
  system: "システム",
};
