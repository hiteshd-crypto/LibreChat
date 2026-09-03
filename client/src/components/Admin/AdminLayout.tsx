import { NavLink, Outlet } from 'react-router-dom';
import { useAdminGuard } from './guard';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function AdminLayout() {
  const localize = useLocalize();
  const redirect = useAdminGuard();
  if (redirect) {
    return redirect;
  }

  const tab = (to: string, label: string) => (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'border-b-2 px-3 py-2 text-sm transition-colors',
          isActive
            ? 'border-text-primary text-text-primary'
            : 'border-transparent text-text-secondary hover:text-text-primary',
        )
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface-primary">
      <header className="flex flex-col gap-3 border-b border-border-light px-6 pt-5">
        <h1 className="text-lg font-semibold text-text-primary">
          {localize('com_admin_nav_title')}
        </h1>
        <nav className="flex gap-1">
          {tab('/admin/access', localize('com_admin_access_title'))}
          {tab('/admin/users', localize('com_admin_users_title'))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <Outlet />
      </main>
    </div>
  );
}
