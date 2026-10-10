import type { Timestamp } from "firebase/firestore";

import { ms, seconds, toDate } from "@/lib/format";
import type { Incident } from "@/lib/types";

import { type Member, Mascot } from "./mascots";

const PHASES: { key: keyof NonNullable<Incident["timings"]>; member: Member; label: string }[] = [
  { key: "guardAt", member: "bannin", label: "番人の検査" },
  { key: "verdictAt", member: "shirabe", label: "シラベの判定" },
  { key: "actionAt", member: "mamoru", label: "マモルの防御" },
  { key: "reportAt", member: "tsutae", label: "ツタエの報告" },
];

/** Real elapsed times from the moment Mihari received the request. */
export function TimelineBar({ incident }: { incident: Incident }) {
  const t = incident.timings ?? {};
  const start = toDate(t.receivedAt)?.getTime();
  const at = (k: keyof typeof t) => {
    const d = toDate(t[k] as Timestamp | undefined);
    return start && d ? (d.getTime() - start) / 1000 : null;
  };
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <li className="rounded-2xl border border-line bg-white p-3">
        <div className="flex items-center gap-2">
          <Mascot member="mihari" size={28} mood="happy" />
          <span className="text-xs font-semibold text-muted">ミハリの遮断</span>
        </div>
        <div className="mt-1 font-mono text-lg font-bold text-brand tabular-nums">{ms(t.wafRuleMs)}<span className="text-xs text-muted"> ms</span></div>
      </li>
      {PHASES.map((p) => {
        const v = at(p.key);
        return (
          <li key={p.key} className="rounded-2xl border border-line bg-white p-3">
            <div className="flex items-center gap-2">
              <Mascot member={p.member} size={28} mood={v === null ? "idle" : "happy"} />
              <span className="text-xs font-semibold text-muted">{p.label}</span>
            </div>
            <div className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">
              {v === null ? "—" : `+${seconds(v)}`}<span className="text-xs text-muted"> 秒</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
