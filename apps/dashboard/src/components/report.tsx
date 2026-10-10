// Renders the AI-written report as plain text blocks. Nothing is ever interpreted as HTML,
// so a report can never inject markup or scripts into the dashboard.
import { FileText } from "lucide-react";

import { Card, CardHeader, Empty } from "./ui";

function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

export function ReportBody({ markdown }: { markdown: string }) {
  const blocks: { type: "h" | "p" | "li"; text: string }[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) blocks.push({ type: "h", text: line.replace(/^#{1,6}\s+/, "") });
    else if (/^[-*・]\s/.test(line)) blocks.push({ type: "li", text: line.replace(/^[-*・]\s+/, "") });
    else blocks.push({ type: "p", text: line });
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) =>
        b.type === "h" ? (
          <h3 key={i} className="pt-2 font-display text-[15px] font-bold text-ink first:pt-0">{stripInline(b.text)}</h3>
        ) : b.type === "li" ? (
          <p key={i} className="flex gap-2 text-ink/90"><span className="text-brand">•</span><span>{stripInline(b.text)}</span></p>
        ) : (
          <p key={i} className="text-ink/90">{stripInline(b.text)}</p>
        ),
      )}
    </div>
  );
}

export function ReportCard({ markdown, pending }: { markdown?: string; pending: boolean }) {
  return (
    <Card>
      <CardHeader title="ツタエの報告書" icon={<FileText size={16} className="text-pink-500" />} sub="専門家でなくてもわかる言葉でまとめます" />
      <div className="p-5">
        {markdown ? <ReportBody markdown={markdown} /> : <Empty>{pending ? "ツタエが報告書を書いています…" : "報告書はまだありません"}</Empty>}
      </div>
    </Card>
  );
}
