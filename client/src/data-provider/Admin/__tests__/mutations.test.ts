import { createElement } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useRemoveRoleMember,
  useAddRoleMember,
  useCreateRole,
  useSetRoleParent,
  useSetUserRole,
} from '../mutations';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      addAdminRoleMember: jest.fn().mockResolvedValue({ success: true }),
      removeAdminRoleMember: jest.fn().mockResolvedValue({ success: true }),
      createAdminRole: jest.fn().mockResolvedValue({ role: { name: 'SALES_MANAGER' } }),
      setAdminRoleParent: jest.fn().mockResolvedValue({ role: { name: 'SALES_MANAGER' } }),
      setAdminUserRole: jest.fn().mockResolvedValue({ success: true }),
    },
  };
});

const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return Wrapper;
};

describe('admin membership mutations', () => {
  it('invalidates the current-user query so the admin guard re-evaluates', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRemoveRoleMember(), { wrapper: makeWrapper(client) });
    result.current.mutate({ roleName: 'ADMIN', userId: 'u1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.user]);
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.adminRoleMembers, 'ADMIN']);
  });

  it('does the same on add', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useAddRoleMember(), { wrapper: makeWrapper(client) });
    result.current.mutate({ roleName: 'ADMIN', userId: 'u1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.user]);
  });
});

describe('hierarchy tree mutations', () => {
  it('useCreateRole passes parentRole and refreshes the role list', async () => {
    const { dataService } = jest.requireMock('librechat-data-provider');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateRole(), { wrapper: makeWrapper(client) });
    result.current.mutate({ name: 'SALES_MANAGER', parentRole: 'SUPERVISOR' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dataService.createAdminRole).toHaveBeenCalledWith({
      name: 'SALES_MANAGER',
      parentRole: 'SUPERVISOR',
    });
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.adminRoles]);
  });

  it('useSetRoleParent invalidates the role list and my-hierarchy', async () => {
    const { dataService } = jest.requireMock('librechat-data-provider');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSetRoleParent(), { wrapper: makeWrapper(client) });
    result.current.mutate({ name: 'SALES_MANAGER', parentRole: null });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dataService.setAdminRoleParent).toHaveBeenCalledWith('SALES_MANAGER', null);
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.myHierarchy]);
  });

  it('useSetUserRole invalidates the user lists and current user', async () => {
    const { dataService } = jest.requireMock('librechat-data-provider');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSetUserRole(), { wrapper: makeWrapper(client) });
    result.current.mutate({ userId: 'u1', role: 'SALES_EMPLOYEE' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dataService.setAdminUserRole).toHaveBeenCalledWith('u1', 'SALES_EMPLOYEE');
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.adminUsers]);
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.user]);
  });
});
