import { Workspace } from "@/components/workspace/workspace";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace runId={id} />;
}
