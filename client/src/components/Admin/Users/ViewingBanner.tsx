import { useLocalize } from '~/hooks';

export default function ViewingBanner({ name }: { name: string }) {
  const localize = useLocalize();
  return (
    <div className="sticky top-0 z-10 border-b border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-secondary">
      {localize('com_admin_viewer_banner', { 0: name })}
    </div>
  );
}
