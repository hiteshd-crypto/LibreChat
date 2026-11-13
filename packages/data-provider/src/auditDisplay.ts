import { creditsToInr, formatInr } from './credits';

type AuditMetadataValue = string | number | boolean | null;
type AuditMetadata = Record<string, AuditMetadataValue>;

/** Token-amount fields money-formatted in place across every `balance.*`
 * audit kind (pool grant, disbursement, transfer, hierarchical/self grant). */
const BALANCE_AMOUNT_FIELDS = [
  'amount',
  'totalAmount',
  'perRecipientAmount',
  'perParticipantAmount',
];

function formatCreditsField(value: AuditMetadataValue, locale?: string): AuditMetadataValue {
  return typeof value === 'number' ? formatInr(creditsToInr(value), locale) : value;
}

/**
 * Display-only transform of an audit entry's raw `metadata` — renames and
 * money-formats token-credit fields for the Details column (UI table and CSV
 * export both call this), without ever touching what `recordAuditEntry`
 * persisted. The stored `AuditLog` document always keeps the raw
 * `tokenCredits` numbers the hash chain was computed over.
 */
export function resolveDisplayMetadata(
  action: string,
  metadata: AuditMetadata | undefined,
  locale?: string,
): AuditMetadata | undefined {
  if (!metadata) {
    return metadata;
  }
  if (action === 'balance.edited') {
    const { previousTokenCredits, newTokenCredits, ...rest } = metadata;
    return {
      ...rest,
      ...(previousTokenCredits !== undefined && {
        previousBalance: formatCreditsField(previousTokenCredits, locale),
      }),
      ...(newTokenCredits !== undefined && {
        newBalance: formatCreditsField(newTokenCredits, locale),
      }),
    };
  }
  if (!action.startsWith('balance.')) {
    return metadata;
  }
  const formatted: AuditMetadata = { ...metadata };
  for (const field of BALANCE_AMOUNT_FIELDS) {
    if (formatted[field] !== undefined) {
      formatted[field] = formatCreditsField(formatted[field], locale);
    }
  }
  return formatted;
}

interface AuditActionEntry {
  action: string;
  metadata?: AuditMetadata;
  actor: { id?: string };
  target: { id?: string };
}

/**
 * Historical `balance.token_grant` entries predate the specific
 * `balance.departmental_distribution` / `balance.internal_distribution` /
 * `balance.self_grant` actions introduced later. Stored entries are never
 * rewritten (that would break the audit log's hash chain — see
 * `packages/data-schemas/src/methods/auditLog.ts`'s `computeEntryHash`), so
 * this derives the same specific label for display only — for both the UI
 * table and the CSV export, which both call this — using the same
 * `metadata.kind` discriminator the backend now writes going forward, or
 * (for entries that predate `kind` entirely) the same actor-vs-target
 * comparison `tokenDistribution.ts`'s `emitGrantAudit` uses today.
 *
 * `grant.assigned` / `grant.removed` are deliberately left unmapped: the
 * generic capability-grant endpoint (`admin/grants.ts`) can produce an
 * identically-shaped entry for an unrelated `DEPARTMENT_HEAD` grant/revoke,
 * so there is no reliable way to tell a department lifecycle event apart
 * from a genuine capability grant after the fact.
 */
export function resolveDisplayAction(entry: AuditActionEntry): string {
  if (entry.action !== 'balance.token_grant') {
    return entry.action;
  }
  const kind = entry.metadata?.kind;
  if (kind === 'department_pool_grant' || kind === 'hierarchical_grant') {
    return 'balance.departmental_distribution';
  }
  if (kind === 'department_disbursement' || kind === 'department_transfer') {
    return 'balance.internal_distribution';
  }
  if (kind === 'self_grant') {
    return 'balance.self_grant';
  }
  return entry.actor.id != null && entry.actor.id === entry.target.id
    ? 'balance.self_grant'
    : 'balance.departmental_distribution';
}
