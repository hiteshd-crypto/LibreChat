import { resolveDisplayMetadata } from 'librechat-data-provider';
import type { TAdminAuditLogEntry } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { resolveDisplayAction } from './displayAction';
import { useLocalize } from '~/hooks';

function actionLabelKey(action: string): TranslationKeys {
  return `com_admin_audit_log_action_${action.replace(/\./g, '_')}` as TranslationKeys;
}

/** Capability grant/revoke metadata (`{"capability":"..."}`) is hidden from the
 * table — it's still fully present in MongoDB and in the CSV export, which reads
 * directly from the stored entry, not from this component. */
function isHiddenDetailsAction(action: string): boolean {
  return action === 'grant.assigned' || action === 'grant.removed';
}

export default function AuditLogRow({
  entry,
  locale,
}: {
  entry: TAdminAuditLogEntry;
  locale: string;
}) {
  const localize = useLocalize();
  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(entry.timestamp));
  const hideDetails = isHiddenDetailsAction(entry.action);
  const displayMetadata = resolveDisplayMetadata(entry.action, entry.metadata, locale);
  const details = !hideDetails && displayMetadata ? JSON.stringify(displayMetadata) : '';
  const displayAction = resolveDisplayAction(entry);
  const actionLabel = localize(actionLabelKey(displayAction));

  return (
    <tr className="border-b border-border-light">
      <td className="px-3 py-2 text-sm text-text-secondary">{timestamp}</td>
      <td className="px-3 py-2 text-sm text-text-primary">{entry.actor.name}</td>
      <td className="px-3 py-2 text-sm text-text-primary">{actionLabel || displayAction}</td>
      <td className="px-3 py-2 text-sm text-text-secondary">
        {entry.target.name ?? entry.target.id ?? entry.target.type}
      </td>
      <td className="px-3 py-2 text-sm text-text-secondary">{entry.outcome}</td>
      <td
        className="max-w-xs truncate px-3 py-2 text-xs text-text-secondary"
        title={hideDetails ? undefined : details}
      >
        {hideDetails
          ? localize('com_admin_audit_log_details_hidden')
          : details || localize('com_admin_audit_log_no_details')}
      </td>
    </tr>
  );
}
