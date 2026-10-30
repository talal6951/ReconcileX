import { Suspense } from "react";
import { SignInForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
