import { orphansCleanupCleanup } from '@pulp-ui/sdk/core/orphans-cleanup';
import { repairPost } from '@pulp-ui/sdk/core/repair';
import { tasksPurge } from '@pulp-ui/sdk/core/tasks';

// What each maintenance task is started with.
interface OrphanCleanupRequest {
  orphan_protection_time: number;
}

interface RepairRequest {
  verify_checksums: boolean;
}

interface PurgeTasksRequest {
  finished_before: string;
  states: string[];
}

// Each call starts one background task on the server and answers when the
// server has accepted it. Nothing of the answer is read: the task shows up in
// the task list. The server decides whether the account may start it.
async function orphanCleanup(request: OrphanCleanupRequest): Promise<void> {
  await orphansCleanupCleanup(request);
}

async function repair(request: RepairRequest): Promise<void> {
  await repairPost(request);
}

async function purgeTasks(request: PurgeTasksRequest): Promise<void> {
  await tasksPurge({
    finished_before: request.finished_before,
    states: request.states as Parameters<typeof tasksPurge>[0]['states'],
  });
}

export const MaintenanceClient = { orphanCleanup, repair, purgeTasks };
export type { OrphanCleanupRequest, PurgeTasksRequest, RepairRequest };
