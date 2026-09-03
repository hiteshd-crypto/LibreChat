import { createElement } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRemoveRoleMember, useAddRoleMember } from '../mutations';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      addAdminRoleMember: jest.fn().mockResolvedValue({ success: true }),
      removeAdminRoleMember: jest.fn().mockResolvedValue({ success: true }),
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
