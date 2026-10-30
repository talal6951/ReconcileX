import { ImportWizard } from "@/components/imports/import-wizard";
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
        description="Upload a bank statement and a ledger export (CSV, Excel or text-based PDF). Review every extracted transaction, resolve flagged rows, and confirm — nothing is saved until you do."
      />
      <ImportWizard />
    </>
  );
}
