import axios from 'axios';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TAdminRole,
  TDepartment,
  TCreateDepartmentBody,
  TRenameDepartmentBody,
  TSetDepartmentHeadBody,
  TAdminUserBalance,
  TAdminUserBalanceConflict,
  TAdminUserBalanceUpdateBody,
  TAdminPricingCreateBody,
  TAdminPricingUpdateBody,
  TAdminPricingDeleteResponse,
  TAdminPricingMutationResponse,
} from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';

export const useCreateRole = (): UseMutationResult<
  { role: TAdminRole },
  Error,
  {
    name: string;
    description?: string;
    parentRole?: string | null;
    /** Only valid for a top-level create — claims an empty department's root role. */
    departmentId?: string;
  }
> => {
  const queryClient = useQueryClient();
  return useMutation((body) => dataService.createAdminRole(body), {
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries([QueryKeys.adminRoles]);
      if (variables.departmentId) {
        queryClient.invalidateQueries([QueryKeys.adminDepartments]);
      }
    },
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

export const useCreateDepartment = (): UseMutationResult<
  { department: TDepartment },
  Error,
  TCreateDepartmentBody
> => {
  const queryClient = useQueryClient();
  return useMutation((body) => dataService.createAdminDepartment(body), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminDepartments]),
  });
};

export const useRenameDepartment = (): UseMutationResult<
  { department: TDepartment },
  Error,
  { departmentId: string; body: TRenameDepartmentBody }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ departmentId, body }) => dataService.renameAdminDepartment(departmentId, body),
    {
      onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminDepartments]),
    },
  );
};

export const useSetDepartmentHead = (): UseMutationResult<
  { department: TDepartment },
  Error,
  { departmentId: string; body: TSetDepartmentHeadBody }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ departmentId, body }) => dataService.setAdminDepartmentHead(departmentId, body),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminDepartments]);
      },
    },
  );
};

export const useDeleteDepartment = (): UseMutationResult<
  { success: true },
  Error,
  { departmentId: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ departmentId }) => dataService.deleteAdminDepartment(departmentId), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminDepartments]),
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

export const useCreatePricingRate = (): UseMutationResult<
  TAdminPricingMutationResponse,
  Error,
  TAdminPricingCreateBody
> => {
  const queryClient = useQueryClient();
  return useMutation((body) => dataService.createAdminPricingRate(body), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminPricing]),
  });
};

export const useUpdatePricingRate = (): UseMutationResult<
  TAdminPricingMutationResponse,
  Error,
  { modelKey: string; updates: TAdminPricingUpdateBody }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ modelKey, updates }) => dataService.updateAdminPricingRate(modelKey, updates),
    { onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminPricing]) },
  );
};

export const useDeletePricingRate = (): UseMutationResult<
  TAdminPricingDeleteResponse,
  Error,
  { modelKey: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ modelKey }) => dataService.deleteAdminPricingRate(modelKey), {
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminPricing]),
  });
};

/** The current balance from a 409 "changed since loaded" response, or `null` for any other error. */
export const getBalanceConflict = (error: unknown): TAdminUserBalance | null => {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) {
    return null;
  }
  return (error.response.data as Partial<TAdminUserBalanceConflict>).balance ?? null;
};

export const useSetUserBalance = (): UseMutationResult<
  TAdminUserBalance,
  Error,
  { userId: string } & TAdminUserBalanceUpdateBody
> => {
  const queryClient = useQueryClient();
  const cacheBalance = (balance: TAdminUserBalance) =>
    queryClient.setQueryData([QueryKeys.adminUserBalance, balance.userId], balance);
  return useMutation(({ userId, ...body }) => dataService.setAdminUserBalance(userId, body), {
    onSuccess: cacheBalance,
    onError: (error) => {
      const current = getBalanceConflict(error);
      if (current) {
        cacheBalance(current);
      }
    },
  });
};
