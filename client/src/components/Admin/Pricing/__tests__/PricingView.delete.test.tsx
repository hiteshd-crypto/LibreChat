import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import {
  useMutation as mockUseMutation,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import PricingView from '../PricingView';

const mockDeleteApi = jest.fn();

jest.mock('~/data-provider', () => ({
  useAdminPricing: () => ({
    data: {
      rates: [
        { modelKey: 'claude-3', prompt: 3, completion: 15 },
        { modelKey: 'gpt-4o', prompt: 2.5, completion: 10 },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useCreatePricingRate: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdatePricingRate: () => ({ mutate: jest.fn(), isLoading: false }),
  useDeletePricingRate: () =>
    mockUseMutation(({ modelKey }: { modelKey: string }) => mockDeleteApi(modelKey)),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));

jest.mock('~/common', () => ({
  NotificationSeverity: { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' },
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, variant: _v, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
  Spinner: () => <span data-testid="spinner" />,
  Table: ({ children }: any) => <table>{children}</table>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableRowHeader: ({ children }: any) => <th scope="row">{children}</th>,
  ControlCombobox: ({ selectedValue, ariaLabel }: any) => (
    <button aria-label={ariaLabel}>{selectedValue}</button>
  ),
  OGDialog: ({ open, onOpenChange, children }: any) =>
    open ? (
      <div role="dialog">
        {children}
        <button aria-label="close-dialog" onClick={() => onOpenChange(false)} />
      </div>
    ) : null,
  OGDialogTemplate: ({ title, main, buttons }: any) => (
    <div>
      <h2>{title}</h2>
      {main}
      {buttons}
    </div>
  ),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

const quietLogger = { log: () => undefined, warn: () => undefined, error: () => undefined };

const renderView = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ logger: quietLogger, defaultOptions: { mutations: { retry: false } } })
      }
    >
      <PricingView />
    </QueryClientProvider>,
  );

const openDelete = (model: string) =>
  userEvent.click(screen.getByRole('button', { name: `com_admin_pricing_delete_for:${model}` }));

describe('PricingView delete dialog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not carry a failed delete error over to the next model', async () => {
    mockDeleteApi.mockRejectedValue(new Error('server said no'));
    renderView();

    await openDelete('gpt-4o');
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'com_ui_delete' }),
    );
    expect(await screen.findByText('server said no')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'close-dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await openDelete('claude-3');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('server said no')).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('com_admin_pricing_delete_confirm:claude-3'),
    ).toBeInTheDocument();
  });
});
