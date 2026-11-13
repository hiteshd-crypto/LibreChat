import { memo } from 'react';
import { Bell } from 'lucide-react';
import type { TNotification } from 'librechat-data-provider';
import { useNotifications, useMarkNotificationRead } from '~/data-provider';
import { useLocalize } from '~/hooks';

const LIST_LIMIT = 20;

function NotificationRow({ notification }: { notification: TNotification }) {
  const markRead = useMarkNotificationRead();
  const localize = useLocalize();
  return (
    <div
      className={`flex flex-col gap-0.5 border-b border-border-light px-3 py-2 last:border-b-0 ${
        notification.read ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">{notification.title}</span>
        {!notification.read && (
          <button
            type="button"
            className="shrink-0 text-xs text-text-secondary hover:text-text-primary hover:underline"
            onClick={() => markRead.mutate(notification._id)}
          >
            {localize('com_ui_notifications_mark_read')}
          </button>
        )}
      </div>
      <span className="text-xs text-text-secondary">{notification.message}</span>
    </div>
  );
}

function NotificationList() {
  const localize = useLocalize();
  const { data } = useNotifications({ limit: LIST_LIMIT });
  const notifications = data?.notifications ?? [];

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-6 text-text-secondary">
        <Bell className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm">{localize('com_ui_notifications_empty')}</span>
      </div>
    );
  }

  return (
    <div className="flex max-h-96 flex-col overflow-y-auto">
      {notifications.map((notification) => (
        <NotificationRow key={notification._id} notification={notification} />
      ))}
    </div>
  );
}

export default memo(NotificationList);
