import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import type {
  TConversation,
  TMessage,
  TAdminRoleListResponse,
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

export const useAdminRoles = (
  config?: UseQueryOptions<TAdminRoleListResponse>,
): QueryObserverResult<TAdminRoleListResponse> =>
  useQuery<TAdminRoleListResponse>([QueryKeys.adminRoles], () => dataService.listAdminRoles(), {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    ...config,
  });

export const useAdminRoleMembers = (
  roleName: string,
  page: number,
  config?: UseQueryOptions<TAdminMemberListResponse>,
): QueryObserverResult<TAdminMemberListResponse> =>
  useQuery<TAdminMemberListResponse>(
    [QueryKeys.adminRoleMembers, roleName, page],
    () =>
      dataService.listAdminRoleMembers(roleName, {
        limit: MEMBERS_PAGE_SIZE,
        offset: (page - 1) * MEMBERS_PAGE_SIZE,
      }),
    { enabled: !!roleName, refetchOnWindowFocus: false, staleTime: 30_000, ...config },
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
