import { Workspace } from "@/components/workspace/workspace";
import { requireWorkspacePage } from "@/server/session";

export const dynamic = "force-dynamic";

const TABS = ["review", "matches", "exceptions", "insights"] as const;

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; type?: string }> }) {
  // Defense in depth: the layout also guards, but layouts are not re-run on every client navigation.
  await requireWorkspacePage();
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "review";
  return <Workspace runId={id} initialTab={tab} initialExceptionType={typeof sp.type === "string" ? sp.type.slice(0, 40) : undefined} />;
}
