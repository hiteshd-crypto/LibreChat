import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type { TNotification } from 'librechat-data-provider';

export const useMarkNotificationRead = (): UseMutationResult<TNotification, Error, string> => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.markNotificationRead],
    (id) => dataService.markNotificationRead(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.notifications]);
        queryClient.invalidateQueries([QueryKeys.unreadNotificationCount]);
      },
    },
  );
};
