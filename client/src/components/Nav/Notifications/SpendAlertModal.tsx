import { useMemo, useState } from 'react';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  OGDialogDescription,
} from '@librechat/client';
import { useNotifications, useMarkNotificationRead } from '~/data-provider';

/** Fallback poll — the SSE push (see `useResumableSSE.ts`'s `ON_SPEND_THRESHOLD`
 * handler) delivers this instantly for whoever's actively chatting; this only
 * bounds the wait for anyone without an open stream right now. */
const POLL_INTERVAL = 5_000;

/** A persistent, dismiss-only popup for spend-threshold alerts — stays open until the
 * department head clicks the close button, unlike the auto-fading toast system. Shows
 * one at a time; dismissing marks it read server-side, which both removes it from this
 * queue and from the bell's unread count. */
export default function SpendAlertModal() {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const { data } = useNotifications(
    { unreadOnly: true, limit: 10 },
    { refetchInterval: POLL_INTERVAL, refetchOnWindowFocus: false },
  );
  const markRead = useMarkNotificationRead();

  const current = useMemo(() => {
    const notifications = data?.notifications ?? [];
    return notifications.find(
      (n) =>
        (n.type === 'spend_threshold' || n.type === 'member_spend_threshold') &&
        !dismissedIds.has(n._id),
    );
  }, [data, dismissedIds]);

  if (!current) {
    return null;
  }

  const handleDismiss = () => {
    setDismissedIds((prev) => new Set(prev).add(current._id));
    markRead.mutate(current._id);
  };

  /** Same severity-to-icon/color vocabulary as `Alert.tsx` — warning for the 80%
   * crossing, error for the 100% one — so this popup reads consistently with the
   * rest of the app's status-colored surfaces instead of introducing new colors. */
  const isWarning = current.severity === 'warning';
  const Icon = isWarning ? AlertTriangle : AlertCircle;
  const badgeClassName = isWarning
    ? 'bg-status-warning-subtle text-status-warning'
    : 'bg-status-error-subtle text-status-error';

  return (
    <OGDialog open modal={false} onOpenChange={(open) => !open && handleDismiss()}>
      <OGDialogContent
        className="inset-auto bottom-6 left-1/2 top-auto w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 translate-y-0 data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4"
        overlayClassName="bg-transparent pointer-events-none"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <OGDialogHeader className="flex-row items-start gap-3 space-y-0">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${badgeClassName}`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1 pt-0.5">
            <OGDialogTitle>{current.title}</OGDialogTitle>
            <OGDialogDescription>{current.message}</OGDialogDescription>
          </div>
        </OGDialogHeader>
      </OGDialogContent>
    </OGDialog>
  );
}
