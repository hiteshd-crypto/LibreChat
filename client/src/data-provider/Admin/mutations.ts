import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import type { TAdminRole } from 'librechat-data-provider';

export const useCreateRole = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { name: string; description?: string; parentRole?: string | null }
> => {
  const queryClient = useQueryClient();
  return useMutation((body) => dataService.createAdminRole(body), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useUpdateRole = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { roleKey: string; updates: { name?: string; description?: string } }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ roleKey, updates }) => dataService.updateAdminRole(roleKey, updates), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useSetRoleParent = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  { roleKey: string; parentRole: string | null }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ roleKey, parentRole }) => dataService.setAdminRoleParent(roleKey, parentRole),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminRoles]);
        queryClient.invalidateQueries([QueryKeys.myHierarchy]);
      },
    },
  );
};

export const useSetUserRole = (): UseMutationResult<
  { success: true },
  Error,
  { userId: string; role: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ userId, role }) => dataService.setAdminUserRole(userId, role), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminUsers]);
      queryClient.invalidateQueries([QueryKeys.adminUserSearch]);
      queryClient.invalidateQueries([QueryKeys.user]);
    },
  });
};

export const useDeleteRole = (): UseMutationResult<
  { success: true },
  Error,
  { roleKey: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ roleKey }) => dataService.deleteAdminRole(roleKey), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminRoles]),
  });
};

export const useAddRoleMember = (): UseMutationResult<
  { success: true },
  Error,
  { roleKey: string; userId: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ roleKey, userId }) => dataService.addAdminRoleMember(roleKey, userId), {
    onSuccess: (_data, { roleKey }) => {
      queryClient.invalidateQueries([QueryKeys.adminRoleMembers, roleKey]);
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
  { roleKey: string; userId: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ roleKey, userId }) => dataService.removeAdminRoleMember(roleKey, userId), {
    onSuccess: (_data, { roleKey }) => {
      queryClient.invalidateQueries([QueryKeys.adminRoleMembers, roleKey]);
      queryClient.invalidateQueries([QueryKeys.adminUsers]);
      queryClient.invalidateQueries([QueryKeys.user]);
    },
  });
};
