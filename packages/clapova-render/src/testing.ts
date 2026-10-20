import type { EngineRenderConfigInput, EngineRenderJob, ProducerApi } from "./engine.js";

type Step = (job: EngineRenderJob, report: (p: number, code?: string) => void, signal?: AbortSignal) => Promise<void>;

/** Minimal in-memory producer for unit tests. Not exported from the package entry. */
export function fakeProducer(step: Step = async () => {}) {
  const calls: Array<{ config: EngineRenderConfigInput; projectDir: string; outputPath: string }> = [];
  let lastConfig: EngineRenderConfigInput | undefined;
  const api: ProducerApi = {
    createRenderJob(config) {
      lastConfig = config;
      return { id: "job-1", status: "queued", progress: 0, currentStage: "Queued", warnings: [] };
    },
    async executeRenderJob(job, projectDir, outputPath, sink, signal) {
      calls.push({ config: lastConfig!, projectDir, outputPath });
      const report = (p: number, code?: string) => {
        job.progress = p;
        job.stageProgress = code ? { code } : undefined;
        void sink?.(job, code ?? "stage");
      };
      await step(job, report, signal);
      job.status = "complete";
      job.outcome = job.warnings.length > 0 ? "completed_with_warnings" : "completed";
      job.outputPath = outputPath;
      job.duration ??= 2;
      job.totalFrames ??= 60;
    },
  };
  return { api, calls };
}
