import { createElement } from 'react';
import { dataService } from 'librechat-data-provider';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAdminRoles, useAdminUserSearch } from '../queries';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      listAdminRoles: jest.fn(),
      searchAdminUsers: jest.fn(),
    },
  };
});

const listAdminRoles = dataService.listAdminRoles as jest.MockedFunction<
  typeof dataService.listAdminRoles
>;
const searchAdminUsers = dataService.searchAdminUsers as jest.MockedFunction<
  typeof dataService.searchAdminUsers
>;

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

beforeEach(() => jest.clearAllMocks());

describe('useAdminRoles', () => {
  it('fetches the role list', async () => {
    listAdminRoles.mockResolvedValue({
      roles: [{ name: 'ADMIN' }],
      total: 1,
      limit: 200,
      offset: 0,
    });
    const { result } = renderHook(() => useAdminRoles(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.roles[0].name).toBe('ADMIN');
  });
});

describe('useAdminUserSearch', () => {
  it('stays disabled below 2 characters', async () => {
    const { result } = renderHook(() => useAdminUserSearch('a'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(searchAdminUsers).not.toHaveBeenCalled();
  });

  it('queries once the term reaches 2 characters', async () => {
    searchAdminUsers.mockResolvedValue({
      users: [{ id: 'u1', name: 'Ann', email: 'a@x.io' }],
      total: 1,
      capped: false,
    });
    const { result } = renderHook(() => useAdminUserSearch('an'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(searchAdminUsers).toHaveBeenCalledWith('an', 20);
    expect(result.current.data?.users[0].name).toBe('Ann');
  });
});
