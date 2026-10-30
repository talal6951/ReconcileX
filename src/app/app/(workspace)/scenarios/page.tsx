import { ScenarioLab } from "@/components/scenario-lab";
import { PageHeader } from "@/components/ui";
import { requireWorkspacePage } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scenario Lab" };

export default async function ScenariosPage() {
  await requireWorkspacePage();
  return (
    <>
      <PageHeader
        eyebrow="Scenario Lab"
        title="What happens to cash if customers pay later?"
        description="Move the sliders to see how payment delays, revenue and expenses change your cash over the next 12 months — with the uncertainty shown, not hidden."
      />
      <ScenarioLab />
    </>
  );
}
