import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import type {
  TConversation,
  TMessage,
  TMyHierarchy,
  TAdminRoleListResponse,
  TAdminUserBalance,
  TAdminUserListItem,
  TAdminPricingListResponse,
  TAdminMemberListResponse,
  TAdminUserListResponse,
  TAdminUserSearchResponse,
  TAdminUserConversationsResponse,
} from 'librechat-data-provider';
import type {
  QueryObserverResult,
  UseInfiniteQueryResult,
  UseQueryOptions,
} from '@tanstack/react-query';

export const MEMBERS_PAGE_SIZE = 20;
const USERS_PAGE_SIZE = 25;
const USER_SEARCH_LIMIT = 20;
const CONVERSATIONS_PAGE_SIZE = 25;
const ALL_USERS_PAGE_SIZE = 200;
const ALL_USERS_CAP = 5000;

export interface TAdminAllUsers {
  users: TAdminUserListItem[];
  total: number;
  /** `true` when the safety cap stopped paging before every user was loaded. */
  truncated: boolean;
}

export const useAdminRoles = (
  config?: UseQueryOptions<TAdminRoleListResponse>,
): QueryObserverResult<TAdminRoleListResponse> =>
  useQuery<TAdminRoleListResponse>([QueryKeys.adminRoles], () => dataService.listAdminRoles(), {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    ...config,
  });

export const useAdminPricing = (
  config?: UseQueryOptions<TAdminPricingListResponse>,
): QueryObserverResult<TAdminPricingListResponse> =>
  useQuery<TAdminPricingListResponse>(
    [QueryKeys.adminPricing],
    () => dataService.listAdminPricing(),
    {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      ...config,
    },
  );

/** The caller's own hierarchy access — drives the admin guard, sidebar link, and role pickers. */
export const useMyHierarchy = (
  config?: UseQueryOptions<TMyHierarchy>,
): QueryObserverResult<TMyHierarchy> =>
  useQuery<TMyHierarchy>([QueryKeys.myHierarchy], () => dataService.getMyHierarchy(), {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    ...config,
  });

export const useAdminRoleMembers = (
  roleKey: string,
  page: number,
  config?: UseQueryOptions<TAdminMemberListResponse>,
): QueryObserverResult<TAdminMemberListResponse> =>
  useQuery<TAdminMemberListResponse>(
    [QueryKeys.adminRoleMembers, roleKey, page],
    () =>
      dataService.listAdminRoleMembers(roleKey, {
        limit: MEMBERS_PAGE_SIZE,
        offset: (page - 1) * MEMBERS_PAGE_SIZE,
      }),
    { enabled: !!roleKey, refetchOnWindowFocus: false, staleTime: 30_000, ...config },
  );

export const useAdminUsers = (
  page: number,
  config?: UseQueryOptions<TAdminUserListResponse>,
): QueryObserverResult<TAdminUserListResponse> =>
  useQuery<TAdminUserListResponse>(
    [QueryKeys.adminUsers, page],
    () =>
      dataService.listAdminUsers({
        limit: USERS_PAGE_SIZE,
        offset: (page - 1) * USERS_PAGE_SIZE,
      }),
    { keepPreviousData: true, refetchOnWindowFocus: false, staleTime: 30_000, ...config },
  );

/** Pages through the admin user list so a picker can filter every user client-side. */
export const useAdminAllUsers = (
  config?: UseQueryOptions<TAdminAllUsers>,
): QueryObserverResult<TAdminAllUsers> =>
  useQuery<TAdminAllUsers>(
    [QueryKeys.adminAllUsers],
    async () => {
      const users: TAdminUserListItem[] = [];
      let total = 0;
      let lastPageSize = 0;
      do {
        const page = await dataService.listAdminUsers({
          limit: ALL_USERS_PAGE_SIZE,
          offset: users.length,
        });
        users.push(...page.users);
        total = page.total;
        lastPageSize = page.users.length;
      } while (lastPageSize > 0 && users.length < total && users.length < ALL_USERS_CAP);
      return { users, total, truncated: users.length < total };
    },
    { refetchOnWindowFocus: false, staleTime: 60_000, ...config },
  );

export const useAdminUserBalance = (
  userId: string,
  config?: UseQueryOptions<TAdminUserBalance>,
): QueryObserverResult<TAdminUserBalance> =>
  useQuery<TAdminUserBalance>(
    [QueryKeys.adminUserBalance, userId],
    () => dataService.getAdminUserBalance(userId),
    { enabled: !!userId, refetchOnWindowFocus: false, ...config },
  );

export const useAdminUserSearch = (
  query: string,
  config?: UseQueryOptions<TAdminUserSearchResponse>,
): QueryObserverResult<TAdminUserSearchResponse> => {
  const trimmed = query.trim();
  return useQuery<TAdminUserSearchResponse>(
    [QueryKeys.adminUserSearch, trimmed],
    () => dataService.searchAdminUsers(trimmed, USER_SEARCH_LIMIT),
    { enabled: trimmed.length >= 2, refetchOnWindowFocus: false, ...config },
  );
};

export const useAdminUserConversations = (
  userId: string,
  params: { search?: string } = {},
): UseInfiniteQueryResult<TAdminUserConversationsResponse> =>
  useInfiniteQuery<TAdminUserConversationsResponse>(
    [QueryKeys.adminUserConversations, userId, params.search ?? ''],
    ({ pageParam }) =>
      dataService.listAdminUserConversations(userId, {
        cursor: pageParam as string | undefined,
        limit: CONVERSATIONS_PAGE_SIZE,
        search: params.search || undefined,
      }),
    {
      enabled: !!userId,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchOnWindowFocus: false,
    },
  );

export const useAdminUserConversation = (
  userId: string,
  conversationId: string,
  config?: UseQueryOptions<TConversation>,
): QueryObserverResult<TConversation> =>
  useQuery<TConversation>(
    [QueryKeys.adminUserConversation, userId, conversationId],
    () => dataService.getAdminUserConversation(userId, conversationId),
    { enabled: !!userId && !!conversationId, refetchOnWindowFocus: false, ...config },
  );

export const useAdminUserMessages = (
  userId: string,
  conversationId: string,
  config?: UseQueryOptions<TMessage[]>,
): QueryObserverResult<TMessage[]> =>
  useQuery<TMessage[]>(
    [QueryKeys.adminUserMessages, userId, conversationId],
    () => dataService.getAdminUserConversationMessages(userId, conversationId),
    { enabled: !!userId && !!conversationId, refetchOnWindowFocus: false, ...config },
  );
