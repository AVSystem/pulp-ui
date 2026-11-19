import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskKeys } from 'src/entities/core/task/queries';
import { MaintenanceClient } from './client';

// Each maintenance task shows up in the task lists once the server has
// accepted it, so lists are read again on success. A request is never
// repeated by itself.
function useMaintenance<TRequest>(start: (request: TRequest) => Promise<void>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: start,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export const useOrphanCleanup = () =>
  useMaintenance(MaintenanceClient.orphanCleanup);

export const useRepair = () => useMaintenance(MaintenanceClient.repair);

export const usePurgeTasks = () => useMaintenance(MaintenanceClient.purgeTasks);
