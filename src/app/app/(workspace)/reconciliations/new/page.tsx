import { NewRun } from "@/components/new-run";
import { PageHeader } from "@/components/ui";
import { requireWorkspacePage } from "@/server/session";

export const metadata = { title: "New reconciliation" };
export const dynamic = "force-dynamic";

export default async function NewReconciliation() {
  await requireWorkspacePage();
  return (
    <>
      <PageHeader
        eyebrow="New reconciliation"
        title="Import bank and ledger data"
        description="Map columns, validate every row, then reconcile. Files are parsed in your browser for preview and re-validated on the server; any invalid row blocks the import rather than being silently skipped."
      />
      <NewRun />
    </>
  );
}
