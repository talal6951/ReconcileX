import { Suspense } from "react";
import { SignUpForm } from "@/components/auth-forms";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
