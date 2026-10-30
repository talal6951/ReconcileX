"use client";

import { useSyncExternalStore } from "react";

/**
 * Reviewer display name, kept per browser. There is no authentication in local
 * mode; the name is recorded on every decision and audit event as entered.
 */
const KEY = "reconcilex.reviewer";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setReviewer(name: string) {
  try {
    localStorage.setItem(KEY, name.trim().slice(0, 80));
  } catch {
    /* storage unavailable: name lives only for this page */
  }
  listeners.forEach((l) => l());
}

export function useReviewer(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "",
  );
}
