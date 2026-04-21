/**
 * CPU-sampling worker. Runs pidtree + pidusage off the main event loop so
 * the window stays responsive when many workspaces are active. Receives an
 * array of root PIDs, responds with { pid → totalTreeCpuPercent }.
 *
 * The worker is deliberately stateless — the main thread owns workspace ID
 * mapping and tier-decision logic. Keeping it that way means the worker
 * can be restarted on crash without losing bookkeeping.
 */
import { parentPort } from "node:worker_threads";
import pidusage from "pidusage";
import pidtree from "pidtree";

interface SampleRequest {
  id: number;
  pids: number[];
}

interface SampleResponse {
  id: number;
  cpuByPid: Record<number, number>;
  errors?: string[];
}

async function measureTreeCpu(rootPid: number): Promise<number> {
  try {
    const pids = await pidtree(rootPid, { root: true });
    if (!Array.isArray(pids) || pids.length === 0) return 0;

    const stats = await pidusage(pids);
    if (stats && typeof stats === "object") {
      return Object.values(stats as Record<string, { cpu?: number }>)
        .map((entry) => Number(entry.cpu) || 0)
        .reduce((total, value) => total + value, 0);
    }
    return 0;
  } catch {
    return 0;
  }
}

if (!parentPort) {
  throw new Error("ActivityWorker must be run as a worker thread");
}

parentPort.on("message", async (request: SampleRequest) => {
  const cpuByPid: Record<number, number> = {};
  await Promise.all(
    request.pids.map(async (pid) => {
      cpuByPid[pid] = await measureTreeCpu(pid);
    }),
  );
  const response: SampleResponse = { id: request.id, cpuByPid };
  parentPort!.postMessage(response);
});
