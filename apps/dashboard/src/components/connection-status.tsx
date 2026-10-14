"use client";

import { CircleCheck, CircleDashed } from "lucide-react";

import { ago, toDate } from "@/lib/format";
import { useNow, useTenant } from "@/lib/hooks";

import { cx } from "./ui";

const ALIVE_MS = 15 * 60_000;

/**
 * "Is my site actually talking to AgentGuard?" The target records the time of the latest report
 * from the registered site (at most once a minute), and this shows it live.
 */
export function ConnectionStatus() {
  const tenant = useTenant().data;
  const now = useNow(5000);
  const last = toDate(tenant?.siteLastReportAt);
  const alive = last !== null && now - last.getTime() < ALIVE_MS;
  return (
    <div role="status" className={cx("flex items-start gap-2 rounded-xl px-3 py-2 text-xs",
      alive ? "bg-safe/10 text-emerald-800" : "bg-slate-100 text-muted")}>
      {alive ? <CircleCheck size={15} className="mt-0.5 shrink-0" /> : <CircleDashed size={15} className="mt-0.5 shrink-0" />}
      <span>
        {alive
          ? <>サイトとつながっています（最後の合図：{ago(last, now)}）。アクセスを AgentGuard が見張っています。</>
          : last
            ? <>しばらく合図が届いていません（最後の合図：{ago(last, now)}）。サイトにアクセスがあれば、ここが緑になります。</>
            : <>サイトからの合図は、まだ届いていません。キーとファイルを入れてサイトを更新したあと、サイトをブラウザで1回開くと、ここが緑になります。</>}
      </span>
    </div>
  );
}
