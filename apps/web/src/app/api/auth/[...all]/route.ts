import { auth } from "@nevile/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Better Auth: sign-up/in, email verification, phone codes, sessions (`/api/auth/*`).
export const { GET, POST } = toNextJsHandler(auth);
