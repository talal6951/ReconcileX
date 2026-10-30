"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";

/** Only same-app relative paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/app") || next.startsWith("//") || next.includes("\\")) return routes.app;
  return next;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  );
}

const inputCls = "input h-10 text-[14px]";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    if (error) {
      // Same message for unknown email and wrong password (no account enumeration).
      setError(error.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Incorrect email or password.");
      setBusy(false);
      return;
    }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="mt-1.5 text-[14px] text-ink-3">Sign in to your Reconcile X workspace.</p>
      </div>
      <Field label="Work email">
        <input className={inputCls} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}
      <button className="btn btn-primary h-10 w-full justify-center text-[14px]" disabled={busy || !email || !password}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
      </button>
      <p className="text-center text-[13px] text-ink-3">
        New to Reconcile X?{" "}
        <Link href={routes.signUp} className="font-semibold text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = password.length > 0 && password.length < 10;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters for your password.");
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
    if (error) {
      setError(error.status === 429 ? "Too many attempts. Please wait a minute and try again." : error.message || "Could not create the account.");
      setBusy(false);
      return;
    }
    router.replace(`${routes.onboarding}${demo ? "?demo=1" : ""}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">{demo ? "Try Reconcile X" : "Create your account"}</h1>
        <p className="mt-1.5 text-[14px] text-ink-3">
          {demo ? "Create an account and we’ll load a synthetic demo dataset into your private workspace." : "Set up a secure workspace for your finance team."}
        </p>
      </div>
      <Field label="Full name">
        <input className={inputCls} autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Work email">
        <input className={inputCls} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" hint={tooShort ? "At least 10 characters" : "At least 10 characters. Use a password manager."}>
        <input className={inputCls} type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}
      <button className="btn btn-primary h-10 w-full justify-center text-[14px]" disabled={busy || !name.trim() || !email || password.length < 10}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create account
      </button>
      <p className="text-center text-[13px] text-ink-3">
        Already have an account?{" "}
        <Link href={routes.signIn} className="font-semibold text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
