import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TAdminRole } from 'librechat-data-provider';
import CreateRoleDialog from '../CreateRoleDialog';

const mockCreateMutate = jest.fn();

jest.mock('~/data-provider', () => ({
  useCreateRole: () => ({
    mutate: mockCreateMutate,
    reset: jest.fn(),
    isLoading: false,
    error: null,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

jest.mock('~/utils', () => ({
  getResponseErrorMessage: (e: unknown) => String(e),
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
  Spinner: () => <span data-testid="spinner" />,
  OGDialog: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
  OGDialogTemplate: ({ title, main, buttons }: any) => (
    <div>
      <h2>{title}</h2>
      {main}
      {buttons}
    </div>
  ),
}));

const parent = (name: string): TAdminRole => ({ roleKey: `${name}-key`, name, parentRole: null });

beforeEach(() => jest.clearAllMocks());

describe('CreateRoleDialog', () => {
  it('has no parent picker and creates a top-level role with parentRole null', async () => {
    render(<CreateRoleDialog open onOpenChange={() => {}} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    await userEvent.type(screen.getAllByRole('textbox')[0], 'SUPERVISOR');
    await userEvent.click(screen.getByText('com_ui_create'));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SUPERVISOR', parentRole: null }),
      expect.any(Object),
    );
  });

  it('in add-under mode shows the parent name and submits its roleKey', async () => {
    render(<CreateRoleDialog open onOpenChange={() => {}} parent={parent('SALES_MANAGER')} />);
    expect(screen.getByText('SALES_MANAGER')).toBeInTheDocument();

    await userEvent.type(screen.getAllByRole('textbox')[0], 'CHILD');
    await userEvent.click(screen.getByText('com_ui_create'));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'CHILD', parentRole: 'SALES_MANAGER-key' }),
      expect.any(Object),
    );
  });
});
