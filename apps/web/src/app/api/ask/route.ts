import { askAutopilot } from "@autopilot/core/sprint/ask";
import { aliasMapForUi } from "@autopilot/core/sprint/pseudonym";
import { body, handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = (req: Request) =>
  handle(async () => {
    const { question } = await body<{ question?: string }>(req);
    if (!question?.trim()) throw new Error("Question is required");
    return { ...(await askAutopilot(question)), people: await aliasMapForUi() };
  });
