import { memo } from 'react';
import { Bell } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@librechat/client';
import { useUnreadNotificationCount } from '~/data-provider';
import NotificationList from './NotificationList';
import { useLocalize } from '~/hooks';

function NotificationBell() {
  const localize = useLocalize();
  const { data } = useUnreadNotificationCount();
  const unreadCount = data?.count ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={localize('com_ui_notifications')}
          className="relative h-9 w-9 rounded-lg"
        >
          <Bell aria-hidden="true" className="h-5 w-5 text-text-primary" />
          {unreadCount > 0 && (
            <span
              role="status"
              aria-label={localize('com_ui_notifications_unread_aria', { count: unreadCount })}
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-status-error px-1 text-[10px] font-semibold text-white"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0">
        <div className="border-b border-border-light px-3 py-2 text-sm font-medium text-text-primary">
          {localize('com_ui_notifications')}
        </div>
        <NotificationList />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default memo(NotificationBell);
