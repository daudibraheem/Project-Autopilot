/**
 * Budget router: easy → WORKER_MODEL, hard → HARD_WORKER_MODEL; verifier = VERIFIER_MODEL.
 * Throws if verifier == worker for a job ("never let AI grade its own homework").
 */
import { type AutopilotConfig, getConfig } from "../config";
import { LlmConfigError } from "./types";

export interface Route {
  provider: AutopilotConfig["provider"];
  workerModel: string;
  verifierModel: string;
  reason: string;
}

export function routeModels(difficulty: "easy" | "hard", cfg: AutopilotConfig = getConfig()): Route {
  let workerModel: string;
  let verifierModel: string;
  if (cfg.provider === "openai") {
    workerModel = cfg.openaiWorkerModel;
    verifierModel = cfg.openaiVerifierModel;
  } else {
    workerModel = difficulty === "hard" ? cfg.hardWorkerModel : cfg.workerModel;
    verifierModel = cfg.verifierModel;
  }
  if (!workerModel || !verifierModel) throw new LlmConfigError("Worker and verifier models must be configured");
  if (workerModel === verifierModel) {
    throw new LlmConfigError(
      `Config error: verifier model (${verifierModel}) must differ from the worker model for a ${difficulty} job. ` +
        "Never let AI grade its own homework: set VERIFIER_MODEL to a different model.",
    );
  }
  return {
    provider: cfg.provider,
    workerModel,
    verifierModel,
    reason: difficulty === "hard" ? "hard contract → HARD_WORKER_MODEL" : "easy contract → WORKER_MODEL (cheap routine model)",
  };
}
