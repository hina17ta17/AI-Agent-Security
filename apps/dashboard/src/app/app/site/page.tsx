"use client";

import { SiteCard } from "@/components/site-card";

/**
 * Everything about the protected site in one place: register it, connect it step by step, and
 * later check that it is still connected. (Kept out of the settings page, which holds the rest.)
 */
export default function SitePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold">守るサイト</h1>
        <p className="mt-1 text-sm text-muted">
          あなたのサイトを AgentGuard につなぐと、届くアクセスをミハリと AI チームが1件ずつ検査して守ります。
          ここで登録から接続まで、すべて行えます。
        </p>
      </div>
      <SiteCard />
    </div>
  );
}
