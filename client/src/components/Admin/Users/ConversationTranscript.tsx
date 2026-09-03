import { useMemo } from 'react';
import { Spinner } from '@librechat/client';
import { buildTree } from 'librechat-data-provider';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ShareMessagesProvider } from '~/components/Share/ShareMessagesProvider';
import MessagesView from '~/components/Share/MessagesView';
import { useAdminUserMessages } from '~/data-provider';
import ViewingBanner from './ViewingBanner';
import { ShareContext } from '~/Providers';
import { useLocalize } from '~/hooks';

export default function ConversationTranscript() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { userId = '', conversationId = '' } = useParams();
  const { state } = useLocation() as { state?: { name?: string } };
  const name = state?.name ?? userId;

  const { data: messages, isLoading, isError } = useAdminUserMessages(userId, conversationId);
  const messagesTree = useMemo(
    () => (messages && messages.length ? buildTree({ messages }) : null),
    [messages],
  );

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  } else if (isError) {
    body = <p className="text-sm text-text-secondary">{localize('com_admin_viewer_load_error')}</p>;
  } else {
    body = (
      <ShareContext.Provider value={{ isSharedConvo: true }}>
        <ShareMessagesProvider messages={messages ?? []}>
          <MessagesView messagesTree={messagesTree} conversationId={conversationId} />
        </ShareMessagesProvider>
      </ShareContext.Provider>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewingBanner name={name} />
      <button
        type="button"
        className="self-start px-1 py-2 text-sm text-text-secondary hover:text-text-primary"
        onClick={() => navigate(`/admin/users/${encodeURIComponent(userId)}`, { state: { name } })}
      >
        {localize('com_admin_viewer_back_to_conversations')}
      </button>
      {body}
    </div>
  );
}
