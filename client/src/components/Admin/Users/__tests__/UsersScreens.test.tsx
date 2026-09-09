import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import ConversationTranscript from '../ConversationTranscript';
import UserConversationsView from '../UserConversationsView';
import UsersView from '../UsersView';

const mockNavigate = jest.fn();
const routeState: { userId?: string; conversationId?: string; locationState?: unknown } = {};

const mockUseAdminUsers = jest.fn();
const mockUseAdminUserSearch = jest.fn();
const mockUseAdminUserConversations = jest.fn();
const mockUseAdminUserConversation = jest.fn();
const mockUseAdminUserMessages = jest.fn();
const mockUseMyHierarchy = jest.fn();
const mockSetUserRoleMutate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({
    userId: routeState.userId,
    conversationId: routeState.conversationId,
  }),
  useLocation: () => ({ state: routeState.locationState }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en', language: 'en' } }),
}));

jest.mock('~/data-provider', () => ({
  useAdminUsers: (...args: unknown[]) => mockUseAdminUsers(...args),
  useAdminUserSearch: (...args: unknown[]) => mockUseAdminUserSearch(...args),
  useAdminUserConversations: (...args: unknown[]) => mockUseAdminUserConversations(...args),
  useAdminUserConversation: (...args: unknown[]) => mockUseAdminUserConversation(...args),
  useAdminUserMessages: (...args: unknown[]) => mockUseAdminUserMessages(...args),
  useMyHierarchy: (...args: unknown[]) => mockUseMyHierarchy(...args),
  useAdminRoles: () => ({ data: { roles: [] } }),
  useSetUserRole: () => ({ mutate: mockSetUserRoleMutate, isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

jest.mock('librechat-data-provider', () => ({
  buildTree: ({ messages }: { messages: unknown[] }) => messages,
}));

jest.mock('@librechat/client', () => ({
  Input: (props: any) => <input {...props} />,
  Spinner: () => <span data-testid="spinner" />,
}));

jest.mock('~/Providers', () => ({ ShareContext: { Provider: ({ children }: any) => children } }));
jest.mock('~/components/Share/ShareMessagesProvider', () => ({
  ShareMessagesProvider: ({ children }: any) => children,
}));
jest.mock('~/components/Share/MessagesView', () => ({
  __esModule: true,
  default: ({ messagesTree }: any) => (
    <div data-testid="messages-view">
      {(messagesTree ?? []).map((m: any) => (
        <p key={m.messageId}>{m.text}</p>
      ))}
    </div>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  routeState.userId = 'u1';
  routeState.conversationId = 'c1';
  routeState.locationState = { name: 'Ann' };
  mockUseAdminUsers.mockReturnValue({ data: { users: [], total: 0 }, isLoading: false });
  mockUseAdminUserSearch.mockReturnValue({ data: { users: [] }, isLoading: false });
  mockUseAdminUserConversations.mockReturnValue({ data: { pages: [] }, isLoading: false });
  mockUseAdminUserConversation.mockReturnValue({ data: undefined });
  mockUseAdminUserMessages.mockReturnValue({ data: [], isLoading: false });
  mockUseMyHierarchy.mockReturnValue({ data: { isAdmin: true, manageableRoleKeys: [] } });
});

describe('UsersView', () => {
  it('lists users and navigates on row click', async () => {
    mockUseAdminUsers.mockReturnValue({
      data: {
        users: [{ id: 'u1', name: 'Ann', email: 'a@x.io', role: 'USER', provider: 'local' }],
        total: 1,
      },
      isLoading: false,
    });
    render(<UsersView />);
    await userEvent.click(screen.getByText('Ann'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/users/u1', { state: { name: 'Ann' } });
  });

  it('switches to server search at >= 2 characters', async () => {
    mockUseAdminUserSearch.mockReturnValue({
      data: { users: [{ id: 'u9', name: 'Zed', email: 'z@x.io' }] },
      isLoading: false,
    });
    render(<UsersView />);
    await userEvent.type(screen.getByPlaceholderText('com_admin_users_search_placeholder'), 'ze');
    expect(await screen.findByText('Zed')).toBeInTheDocument();
  });

  it('shows a plain role badge for an admin viewer', () => {
    mockUseMyHierarchy.mockReturnValue({ data: { isAdmin: true, manageableRoleKeys: [] } });
    mockUseAdminUsers.mockReturnValue({
      data: {
        users: [{ id: 'u1', name: 'Ann', email: 'a@x.io', role: 'SALES_EMPLOYEE' }],
        total: 1,
      },
      isLoading: false,
    });
    render(<UsersView />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('SALES_EMPLOYEE')).toBeInTheDocument();
  });

  it('renders a role-change select for a non-admin hierarchy viewer', async () => {
    mockUseMyHierarchy.mockReturnValue({
      data: {
        isAdmin: false,
        manageableRoleKeys: ['SALES_EMPLOYEE', 'SALES_EMPLOYEE_TIER_2'],
      },
    });
    mockUseAdminUsers.mockReturnValue({
      data: {
        users: [{ id: 'u1', name: 'Ann', email: 'a@x.io', role: 'SALES_EMPLOYEE' }],
        total: 1,
      },
      isLoading: false,
    });
    render(<UsersView />);
    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, 'SALES_EMPLOYEE_TIER_2');
    expect(mockSetUserRoleMutate).toHaveBeenCalledWith({
      userId: 'u1',
      role: 'SALES_EMPLOYEE_TIER_2',
    });
  });
});

describe('UserConversationsView', () => {
  it('shows the banner and lists conversations', async () => {
    mockUseAdminUserConversations.mockReturnValue({
      data: {
        pages: [
          { conversations: [{ conversationId: 'c1', title: 'Trip plan' }], nextCursor: null },
        ],
      },
      isLoading: false,
    });
    render(<UserConversationsView />);
    expect(screen.getByText(/com_admin_viewer_banner/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Trip plan'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/users/u1/c/c1', { state: { name: 'Ann' } });
  });
});

describe('ConversationTranscript', () => {
  it('renders messages read-only with the conversation title and no composer', () => {
    mockUseAdminUserConversation.mockReturnValue({ data: { title: 'Trip plan' } });
    mockUseAdminUserMessages.mockReturnValue({
      data: [
        { messageId: 'm1', parentMessageId: null, text: 'hello', conversationId: 'c1' },
        { messageId: 'm2', parentMessageId: 'm1', text: 'hi there', conversationId: 'c1' },
      ],
      isLoading: false,
    });
    render(<ConversationTranscript />);
    expect(screen.getByText('Trip plan')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('hi there')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText(/com_admin_viewer_banner/)).toBeInTheDocument();
  });
});
