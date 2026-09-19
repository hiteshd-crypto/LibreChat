import { createElement } from 'react';
import { AxiosError } from 'axios';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useRemoveRoleMember,
  useAddRoleMember,
  useCreateRole,
  useSetRoleParent,
  useSetUserRole,
  useSetUserBalance,
  getBalanceConflict,
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
      setAdminUserBalance: jest.fn(),
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
    result.current.mutate({ roleKey: 'ADMIN', userId: 'u1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.user]);
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.adminRoleMembers, 'ADMIN']);
  });

  it('does the same on add', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useAddRoleMember(), { wrapper: makeWrapper(client) });
    result.current.mutate({ roleKey: 'ADMIN', userId: 'u1' });

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
    result.current.mutate({ roleKey: 'SALES_MANAGER', parentRole: null });

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

describe('user balance mutation', () => {
  const quietClient = () =>
    new QueryClient({
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      defaultOptions: { queries: { retry: false } },
    });
  const setAdminUserBalance = dataService.setAdminUserBalance as jest.MockedFunction<
    typeof dataService.setAdminUserBalance
  >;
  const conflictError = (balance: unknown) =>
    Object.assign(new AxiosError('conflict'), {
      response: { status: 409, data: { error: 'changed', balance } },
    });

  beforeEach(() => setAdminUserBalance.mockReset());

  it('sends the tokenCredits and the expected value, and caches the saved balance', async () => {
    const saved = { userId: 'u1', tokenCredits: 7500, hasRecord: true };
    setAdminUserBalance.mockResolvedValue(saved);
    const client = quietClient();
    const { result } = renderHook(() => useSetUserBalance(), { wrapper: makeWrapper(client) });

    result.current.mutate({ userId: 'u1', tokenCredits: 7500, expectedTokenCredits: 5000 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(setAdminUserBalance).toHaveBeenCalledWith('u1', {
      tokenCredits: 7500,
      expectedTokenCredits: 5000,
    });
    expect(client.getQueryData([QueryKeys.adminUserBalance, 'u1'])).toEqual(saved);
  });

  it('replaces the cached balance with the current one on a conflict', async () => {
    const current = { userId: 'u1', tokenCredits: 3000, hasRecord: true };
    setAdminUserBalance.mockRejectedValue(conflictError(current));
    const client = quietClient();
    client.setQueryData([QueryKeys.adminUserBalance, 'u1'], {
      userId: 'u1',
      tokenCredits: 5000,
      hasRecord: true,
    });
    const { result } = renderHook(() => useSetUserBalance(), { wrapper: makeWrapper(client) });

    result.current.mutate({ userId: 'u1', tokenCredits: 7500, expectedTokenCredits: 5000 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(client.getQueryData([QueryKeys.adminUserBalance, 'u1'])).toEqual(current);
  });

  it('leaves the cache alone for a non-conflict failure', async () => {
    setAdminUserBalance.mockRejectedValue(new Error('boom'));
    const client = quietClient();
    const before = { userId: 'u1', tokenCredits: 5000, hasRecord: true };
    client.setQueryData([QueryKeys.adminUserBalance, 'u1'], before);
    const { result } = renderHook(() => useSetUserBalance(), { wrapper: makeWrapper(client) });

    result.current.mutate({ userId: 'u1', tokenCredits: 1 });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(client.getQueryData([QueryKeys.adminUserBalance, 'u1'])).toEqual(before);
  });

  it('getBalanceConflict only recognises a 409 that carries a balance', () => {
    const balance = { userId: 'u1', tokenCredits: 1, hasRecord: true };
    const withResponse = (status: number, data: unknown) =>
      Object.assign(new AxiosError('x'), { response: { status, data } });
    expect(getBalanceConflict(conflictError(balance))).toEqual(balance);
    expect(getBalanceConflict(new Error('x'))).toBeNull();
    expect(getBalanceConflict(withResponse(500, {}))).toBeNull();
    expect(getBalanceConflict(withResponse(409, {}))).toBeNull();
  });
});
