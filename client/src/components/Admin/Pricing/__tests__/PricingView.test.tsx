import { forwardRef as mockForwardRef } from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import PricingView from '../PricingView';

const mockUseAdminPricing = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/data-provider', () => ({
  useAdminPricing: () => mockUseAdminPricing(),
  useCreatePricingRate: () => ({ mutate: mockCreate, isLoading: false, error: null }),
  useUpdatePricingRate: () => ({ mutate: mockUpdate, isLoading: false, error: null }),
  useDeletePricingRate: () => ({ mutate: mockDelete, isLoading: false, error: null }),
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
  Input: mockForwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
  Spinner: () => <span data-testid="spinner" />,
  Table: ({ children, ...props }: any) => <table {...props}>{children}</table>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
  TableHead: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableRowHeader: ({ children }: any) => <th scope="row">{children}</th>,
  ControlCombobox: ({ items, setValue, ariaLabel, disabled }: any) => (
    <select
      aria-label={ariaLabel}
      value=""
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
    >
      <option value="" />
      {items.map((item: any) => (
        <option key={item.value} value={item.value} aria-selected={item.selected}>
          {item.label}
        </option>
      ))}
    </select>
  ),
  OGDialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  OGDialogTemplate: ({ title, main, buttons }: any) => (
    <div>
      <h2>{title}</h2>
      {main}
      {buttons}
    </div>
  ),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const rates = [
  { modelKey: 'claude-3', prompt: 3, completion: 15 },
  { modelKey: 'gpt-4o', prompt: 2.5, completion: 10 },
];

const ready = (list = rates) =>
  mockUseAdminPricing.mockReturnValue({ data: { rates: list }, isLoading: false, isError: false });

const masterDropdown = () => screen.getByLabelText('com_admin_pricing_model_select_label');

/** Picks a model from the master dropdown, adding or removing its row. */
const pickModel = (model: string) => userEvent.selectOptions(masterDropdown(), model);

beforeEach(() => {
  jest.clearAllMocks();
  ready();
});

describe('PricingView', () => {
  it('shows a spinner while loading', () => {
    mockUseAdminPricing.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<PricingView />);
    expect(screen.getByTestId('admin-pricing-loading')).toBeInTheDocument();
  });

  it('shows an error message when the load fails', () => {
    mockUseAdminPricing.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<PricingView />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_admin_pricing_load_error');
  });

  it('shows the empty state when there are no rates, and still offers Add New', () => {
    ready([]);
    render(<PricingView />);
    expect(screen.getByRole('status')).toHaveTextContent('com_admin_pricing_empty');
    expect(screen.getByRole('button', { name: 'com_admin_pricing_add' })).toBeEnabled();
  });

  it('shows a select prompt and no table until a model is chosen', () => {
    render(<PricingView />);
    expect(screen.getByRole('status')).toHaveTextContent('com_admin_pricing_select_prompt');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'com_admin_pricing_clear_all' }),
    ).not.toBeInTheDocument();
  });

  it('lists every stored model in the master dropdown regardless of selection', async () => {
    render(<PricingView />);
    await pickModel('gpt-4o');
    const options = Array.from(masterDropdown().querySelectorAll('option'))
      .map((o) => o.textContent)
      .filter(Boolean);
    expect(options).toEqual(['claude-3', 'gpt-4o']);
  });

  it('marks a displayed model as selected in the dropdown, including for assistive tech', async () => {
    render(<PricingView />);
    await pickModel('gpt-4o');
    const option = within(masterDropdown()).getByText('gpt-4o');
    expect(option).toHaveAttribute('aria-selected', 'true');
    const other = within(masterDropdown()).getByText('claude-3');
    expect(other).toHaveAttribute('aria-selected', 'false');
  });

  it('adds a row read-only with semantic table markup when a model is picked', async () => {
    render(<PricingView />);
    await pickModel('gpt-4o');
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.getAllByRole('rowheader')).toHaveLength(1);
    expect(screen.getByRole('rowheader')).toHaveTextContent('gpt-4o');
    const prompt = screen.getByLabelText('com_admin_pricing_prompt_for:gpt-4o');
    expect(prompt).toHaveValue('2.5');
    expect(prompt).toHaveAttribute('readonly');
  });

  it('accumulates multiple selections instead of replacing the previous one', async () => {
    render(<PricingView />);
    await pickModel('gpt-4o');
    await pickModel('claude-3');
    expect(screen.getAllByRole('rowheader').map((el) => el.textContent)).toEqual([
      'claude-3',
      'gpt-4o',
    ]);
  });

  it('toggles a model off when picked again, without duplicating rows', async () => {
    render(<PricingView />);
    await pickModel('gpt-4o');
    await pickModel('gpt-4o');
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('com_admin_pricing_select_prompt');
  });

  it('clears every displayed row via Clear All without deleting anything', async () => {
    render(<PricingView />);
    await pickModel('gpt-4o');
    await pickModel('claude-3');
    await userEvent.click(screen.getByRole('button', { name: 'com_admin_pricing_clear_all' }));
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  describe('update', () => {
    it('makes the row editable and saves only valid values', async () => {
      render(<PricingView />);
      await pickModel('gpt-4o');
      await userEvent.click(
        screen.getByRole('button', { name: 'com_admin_pricing_update_for:gpt-4o' }),
      );
      const prompt = screen.getByLabelText('com_admin_pricing_prompt_for:gpt-4o');
      expect(prompt).not.toHaveAttribute('readonly');

      await userEvent.clear(prompt);
      await userEvent.type(prompt, '-1');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
      expect(screen.getByRole('alert')).toHaveTextContent('com_admin_pricing_rate_invalid');
      expect(mockUpdate).not.toHaveBeenCalled();

      await userEvent.clear(prompt);
      await userEvent.type(prompt, '3.25');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
      expect(mockUpdate).toHaveBeenCalledWith(
        { modelKey: 'gpt-4o', updates: { prompt: 3.25, completion: 10 } },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      );
    });

    it('discards edits on cancel', async () => {
      render(<PricingView />);
      await pickModel('gpt-4o');
      await userEvent.click(
        screen.getByRole('button', { name: 'com_admin_pricing_update_for:gpt-4o' }),
      );
      const prompt = screen.getByLabelText('com_admin_pricing_prompt_for:gpt-4o');
      await userEvent.clear(prompt);
      await userEvent.type(prompt, '99');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
      expect(screen.getByLabelText('com_admin_pricing_prompt_for:gpt-4o')).toHaveValue('2.5');
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('add new', () => {
    const openDraft = async () => {
      render(<PricingView />);
      await userEvent.click(screen.getByRole('button', { name: 'com_admin_pricing_add' }));
      return screen.getByLabelText('com_admin_pricing_model_label');
    };

    it('requires a model name', async () => {
      await openDraft();
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
      expect(screen.getByText('com_admin_pricing_model_required')).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects an existing model inline without calling the API', async () => {
      const model = await openDraft();
      await userEvent.type(model, 'gpt-4o');
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
      expect(screen.getByText('com_admin_pricing_model_exists')).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('creates a new model with parsed numeric rates', async () => {
      const model = await openDraft();
      await userEvent.type(model, ' new-model ');
      await userEvent.type(screen.getByLabelText('com_admin_pricing_prompt_for:new-model'), '1.5');
      await userEvent.type(
        screen.getByLabelText('com_admin_pricing_completion_for:new-model'),
        '6',
      );
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
      expect(mockCreate).toHaveBeenCalledWith(
        { modelKey: 'new-model', prompt: 1.5, completion: 6 },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      );
    });

    it('disables Add New while a draft is open and closes it on cancel', async () => {
      await openDraft();
      expect(screen.getByRole('button', { name: 'com_admin_pricing_add' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
      expect(screen.getByRole('button', { name: 'com_admin_pricing_add' })).toBeEnabled();
    });
  });

  describe('delete', () => {
    it('asks for confirmation before deleting', async () => {
      render(<PricingView />);
      await pickModel('gpt-4o');
      await userEvent.click(
        screen.getByRole('button', { name: 'com_admin_pricing_delete_for:gpt-4o' }),
      );
      const dialog = screen.getByRole('dialog');
      expect(
        within(dialog).getByText('com_admin_pricing_delete_confirm:gpt-4o'),
      ).toBeInTheDocument();
      expect(mockDelete).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole('button', { name: 'com_ui_delete' }));
      expect(mockDelete).toHaveBeenCalledWith(
        { modelKey: 'gpt-4o' },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
  });
});
