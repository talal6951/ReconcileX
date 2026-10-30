"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button className="btn btn-secondary" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> Print / Save PDF
    </button>
  );
}
