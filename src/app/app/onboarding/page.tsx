import { Onboarding } from "@/components/onboarding";
import { Wordmark } from "@/components/site/brand";
import { routes } from "@/lib/routes";
import { requireUserPage } from "@/server/session";

export const metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const session = await requireUserPage();
  const { demo } = await searchParams;
  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex h-16 items-center bg-navy-900 px-6">
        <Wordmark href={routes.home} />
      </header>
      <main className="flex justify-center px-4 py-12 md:py-20">
        <Onboarding userName={session.user.name} demo={demo === "1"} />
      </main>
    </div>
  );
}
