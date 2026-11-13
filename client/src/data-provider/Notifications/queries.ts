import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TNotificationListResponse,
  TUnreadNotificationCountResponse,
} from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';

/** Fallback for anyone with no open chat stream to push over (e.g. a department
 * head who isn't actively chatting right now) — the SSE push covers the active
 * chatter instantly; this just bounds the worst case for everyone else. */
const UNREAD_POLL_INTERVAL = 5_000;

export const useNotifications = (
  params: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  config?: UseQueryOptions<TNotificationListResponse>,
): QueryObserverResult<TNotificationListResponse> =>
  useQuery<TNotificationListResponse>(
    [QueryKeys.notifications, params],
    () => dataService.listNotifications(params),
    { refetchOnWindowFocus: false, ...config },
  );

/** Polls for the department head's own unread count — the near-real-time fallback
 * while their tab is open, since there's no backend push channel. */
export const useUnreadNotificationCount = (
  config?: UseQueryOptions<TUnreadNotificationCountResponse>,
): QueryObserverResult<TUnreadNotificationCountResponse> =>
  useQuery<TUnreadNotificationCountResponse>(
    [QueryKeys.unreadNotificationCount],
    () => dataService.getUnreadNotificationCount(),
    { refetchOnWindowFocus: false, refetchInterval: UNREAD_POLL_INTERVAL, ...config },
  );
