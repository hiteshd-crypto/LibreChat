import { Spinner } from '@librechat/client';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminUserConversations } from '~/data-provider';
import ViewingBanner from './ViewingBanner';
import { useLocalize } from '~/hooks';

export default function UserConversationsView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { userId = '' } = useParams();
  const { state } = useLocation() as { state?: { name?: string } };
  const name = state?.name ?? userId;

  const query = useAdminUserConversations(userId);

  const conversations = (query.data?.pages ?? []).flatMap((p) => p.conversations);

  let body: ReactNode;
  if (query.isLoading) {
    body = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  } else if (query.isError) {
    body = <p className="text-sm text-text-secondary">{localize('com_admin_viewer_load_error')}</p>;
  } else if (conversations.length === 0) {
    body = (
      <p className="text-sm text-text-secondary">{localize('com_admin_viewer_no_conversations')}</p>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-1">
        {conversations.map((convo) => (
          <li key={convo.conversationId}>
            <button
              type="button"
              className="w-full rounded-lg border border-border-light px-3 py-2 text-left hover:bg-surface-hover"
              onClick={() =>
                navigate(
                  `/admin/users/${encodeURIComponent(userId)}/c/${encodeURIComponent(
                    convo.conversationId ?? '',
                  )}`,
                  { state: { name } },
                )
              }
            >
              <span className="text-sm text-text-primary">
                {convo.title || localize('com_ui_untitled')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ViewingBanner name={name} />
      <button
        type="button"
        className="self-start text-sm text-text-secondary hover:text-text-primary"
        onClick={() => navigate('/admin/users')}
      >
        {localize('com_admin_viewer_back_to_users')}
      </button>
      {body}
      {query.hasNextPage ? (
        <button
          type="button"
          className="self-center text-sm text-text-secondary hover:text-text-primary disabled:opacity-40"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {localize('com_admin_viewer_load_more')}
        </button>
      ) : null}
    </div>
  );
}
