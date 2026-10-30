"use client";

import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser auth client. Same-origin; cookies are httpOnly and never readable here. */
export const authClient = createAuthClient({ plugins: [organizationClient()] });
