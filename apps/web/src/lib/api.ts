import { NextResponse } from "next/server";

/** Wrap a route handler: JSON out, errors as { error } with a 4xx/5xx. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    const err = e as Error;
    const client = ["ApprovalError", "KillSwitchError", "ZodError"].includes(err.name) || /required|not found|already|green|cap reached|Kill switch/i.test(err.message);
    console.error("[api]", err.message);
    return NextResponse.json({ error: err.message }, { status: client ? 400 : 500 });
  }
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
