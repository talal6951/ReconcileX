/**
 * Chart palette. Lives in a plain (non-"use client") module so server components can
 * read the actual values — constants imported from a client module into a server
 * component are client references, not values.
 */
export const SERIES = {
  verified: "#0f8a5f",
  approved: "#3aa57f",
  suggested: "#2458e6",
  review: "#d08a0e",
  rejected: "#c8322f",
  unmatched: "#c3ccdb",
} as const;
