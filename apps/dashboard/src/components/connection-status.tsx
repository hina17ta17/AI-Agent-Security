"use client";

import { CircleAlert, CircleCheck, CircleDashed, ShieldCheck } from "lucide-react";

import { ago } from "@/lib/format";
import { useNow, useTenant } from "@/lib/hooks";
import { siteReport } from "@/lib/site-link";

import { cx } from "./ui";

/**
 * "Is my site actually talking to AgentGuard?" The WAF records the time of the latest report from the
 * registered site (at most once a minute) and which key sent it; this shows it live.
 */
export function ConnectionStatus() {
  const tenant = useTenant().data;
  const now = useNow(5000);
  const { last, alive, oldKey } = siteReport(tenant, now);
  return (
    <div role="status" className={cx("flex items-start gap-2 rounded-xl px-3 py-2 text-xs",
      alive ? "bg-safe/10 text-emerald-800" : oldKey ? "bg-warn/10 text-amber-800" : last ? "bg-safe/5 text-emerald-800" : "bg-slate-100 text-muted")}>
      {alive ? <CircleCheck size={15} className="mt-0.5 shrink-0" />
        : oldKey ? <CircleAlert size={15} className="mt-0.5 shrink-0" />
          : last ? <ShieldCheck size={15} className="mt-0.5 shrink-0" />
            : <CircleDashed size={15} className="mt-0.5 shrink-0" />}
      <span>
        {alive
          ? <>サイトとつながっています（最後の合図：{ago(last, now)}）。アクセスを AgentGuard が見張っています。</>
          : oldKey
            ? <>サイトから合図は届きましたが、<b>前の接続キーのまま</b>です。前のキーはもう使えません。新しいキーに入れかえて（フォルダをダウンロードしなおして .agentguard を入れかえる、または秘密の設定のキーを入れかえる）、サイトを更新してください。</>
            : last
              ? <>守っています。いまはサイトへのアクセスがないだけです（最後の合図：{ago(last, now)}）。アクセスが来たら、すぐに見張ります。</>
              : <>サイトからの合図は、まだ届いていません。ファイルとキーを入れてサイトを更新したあと、サイトをブラウザで1回開くと、ここが緑になります。</>}
      </span>
    </div>
  );
}
