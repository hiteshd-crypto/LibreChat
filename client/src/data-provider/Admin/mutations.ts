import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import type { TAdminRole } from 'librechat-data-provider';

export const useCreateRole = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { name: string; description?: string }
> => {
  const queryClient = useQueryClient();
  return useMutation((body) => dataService.createAdminRole(body), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useUpdateRole = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { name: string; updates: { name?: string; description?: string } }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ name, updates }) => dataService.updateAdminRole(name, updates), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useDeleteRole = (): UseMutationResult<{ success: true }, Error, { name: string }> => {
  const queryClient = useQueryClient();
  return useMutation(({ name }) => dataService.deleteAdminRole(name), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useAddRoleMember = (): UseMutationResult<
  { success: true },
  Error,
  { roleName: string; userId: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ roleName, userId }) => dataService.addAdminRoleMember(roleName, userId), {
    onSuccess: (_data, { roleName }) => {
      queryClient.invalidateQueries([QueryKeys.adminRoleMembers, roleName]);
      queryClient.invalidateQueries([QueryKeys.adminUsers]);
      // Refetch the current user — if they just changed their own role, the
      // admin route guard re-evaluates and redirects out.
      queryClient.invalidateQueries([QueryKeys.user]);
    },
  });
};

export const useRemoveRoleMember = (): UseMutationResult<
  { success: true },
  Error,
  { roleName: string; userId: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ roleName, userId }) => dataService.removeAdminRoleMember(roleName, userId),
    {
      onSuccess: (_data, { roleName }) => {
        queryClient.invalidateQueries([QueryKeys.adminRoleMembers, roleName]);
        queryClient.invalidateQueries([QueryKeys.adminUsers]);
        queryClient.invalidateQueries([QueryKeys.user]);
      },
    },
  );
};
