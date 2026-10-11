"use client";

import { useEffect, useRef, useState } from "react";

import { ApprovalBanner } from "@/components/approval-banner";
import { AttackSimulator } from "@/components/attack-simulator";
import { BlocklistCard } from "@/components/blocklist-card";
import { IncidentList } from "@/components/incident-list";
import { IncidentTabs } from "@/components/incident-tabs";
import { LiveFeed } from "@/components/live-feed";
import { Metrics } from "@/components/metrics";
import { ReportCard } from "@/components/report";
import { StatusHero } from "@/components/status-hero";
import { moodsFor, TeamPanel } from "@/components/team-panel";
import { WaveCard } from "@/components/wave-card";
import { concurrentIncidents, liveStatus, waveVisible } from "@/lib/activity";
import { useSession } from "@/lib/auth-context";
import {
  useBlocklist,
  useCampaign,
  useIncident,
  useIncidents,
  useNow,
  usePendingApprovals,
  useSteps,
  useTenant,
  useUsageToday,
} from "@/lib/hooks";
import { chime } from "@/lib/sound";

export default function DashboardPage() {
  const { siteUrl } = useSession();
  const tenant = useTenant().data;
  const incidents = useIncidents(20).data;
  const now = useNow(5000); // only for staleness (minutes), so a slow tick is enough
  const { status, activeIds } = liveStatus(tenant, now);
  // A tab chosen by the viewer stays on screen; otherwise follow the newest investigation.
  const [pinned, setPinned] = useState<string | null>(null);
  const focusId = pinned ?? tenant?.activeIncidentId ?? incidents[0]?.id ?? null;
  const incident = useIncident(focusId).data;
  const steps = useSteps(focusId).data;
  const blocklist = useBlocklist().data;
  const approvals = usePendingApprovals().data;
  const usage = useUsageToday();
  const wave = useCampaign(tenant?.campaignId ?? null).data;
  const tabs = concurrentIncidents(incidents, activeIds, now);
  // "Live" belongs to the incident on screen: another one may still be running after it finished.
  const live = status === "responding" && incident?.status === "analyzing";
  // First defensive action (Mamoru's block/watch, or the rule fallback): the defense time stops here.
  const defendedAt = steps.find((s) => s.kind === "action")?.at ?? null;

  // Sound cues on status transitions (not on first load). The status stays "responding" until
  // every concurrent investigation has finished, so a burst of attacks rings only once.
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previous.current && previous.current !== status) {
      if (status === "responding") chime("alert");
      else if (previous.current === "responding") chime("resolved");
    }
    previous.current = tenant ? status : undefined;
  }, [status, tenant]);

  return (
    <div className="space-y-5">
      <ApprovalBanner approvals={approvals} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <StatusHero tenant={tenant} incident={incident} siteUrl={siteUrl} defendedAt={defendedAt} />
          {waveVisible(wave, now) && <WaveCard wave={wave} />}
          {tabs.length >= 2 && (
            <IncidentTabs
              incidents={tabs}
              running={tabs.filter((i) => activeIds.includes(i.id)).length}
              focusId={focusId}
              pinned={pinned !== null}
              onSelect={setPinned}
              onAuto={() => setPinned(null)}
            />
          )}
          <TeamPanel moods={moodsFor(incident, steps, live)} />
          <LiveFeed incident={incident} steps={steps} live={live} />
          {incident && <ReportCard markdown={incident.report?.markdown} pending={incident.status === "analyzing"} />}
        </div>
        <div className="min-w-0 space-y-5">
          <AttackSimulator />
          <Metrics latest={incidents[0] ?? null} incidents={incidents} blocklist={blocklist} usage={usage} aiMode={tenant?.aiMode} />
          <BlocklistCard entries={blocklist} />
        </div>
      </div>
      <IncidentList incidents={incidents} />
    </div>
  );
}
