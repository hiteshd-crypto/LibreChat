import { NavLink, Outlet } from 'react-router-dom';
import { useMyHierarchy } from '~/data-provider';
import { useAdminGuard } from './guard';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function AdminLayout() {
  const localize = useLocalize();
  const redirect = useAdminGuard();
  const { data: hierarchy } = useMyHierarchy();
  if (redirect) {
    return redirect;
  }

  const item = (to: string, label: string) => (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors',
          'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2',
          isActive
            ? 'bg-surface-active-alt text-text-primary'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        )
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface-primary md:flex-row">
      <aside className="flex flex-col gap-3 border-b border-border-light px-4 py-4 md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <h1 className="px-3 text-lg font-semibold text-text-primary">
          {localize('com_admin_nav_title')}
        </h1>
        <nav
          aria-label={localize('com_admin_nav_title')}
          className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
        >
          {hierarchy?.isAdmin ? item('/admin/access', localize('com_admin_hierarchy_title')) : null}
          {hierarchy?.isAdmin ? item('/admin/pricing', localize('com_admin_pricing_title')) : null}
          {hierarchy?.isAdmin ? item('/admin/balance', localize('com_admin_balance_title')) : null}
          {item('/admin/users', localize('com_admin_users_title'))}
        </nav>
      </aside>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <Outlet />
      </main>
    </div>
  );
}
