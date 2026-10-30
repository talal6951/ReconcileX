import { Workspace } from "@/components/workspace/workspace";
import { requireWorkspacePage } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  // Defense in depth: the layout also guards, but layouts are not re-run on every client navigation.
  await requireWorkspacePage();
  const { id } = await params;
  return <Workspace runId={id} />;
}
