import { useState } from 'react';
import download from 'downloadjs';
import { useTranslation } from 'react-i18next';
import { dataService } from 'librechat-data-provider';
import { Button, Spinner, useToastContext } from '@librechat/client';
import type { TAdminAuditLogListParams } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import {
  useAdminAuditLog,
  useVerifyAdminAuditLog,
  useDepartments,
  AUDIT_LOG_PAGE_SIZE,
} from '~/data-provider';
import { LocalizedDateRangePicker } from '~/components/ui';
import { NotificationSeverity } from '~/common';
import AuditLogRow from './AuditLogRow';
import { useLocalize } from '~/hooks';

type AuditLogFilterDraft = {
  startDate?: Date;
  endDate?: Date;
  departmentName: string;
};

const EMPTY_FILTER_DRAFT: AuditLogFilterDraft = { departmentName: '' };

function toDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toAppliedFilters(
  draft: AuditLogFilterDraft,
): Omit<TAdminAuditLogListParams, 'limit' | 'offset'> {
  const filters: Omit<TAdminAuditLogListParams, 'limit' | 'offset'> = {};
  if (draft.startDate) filters.from = toDateParam(draft.startDate);
  if (draft.endDate) filters.to = toDateParam(draft.endDate);
  if (draft.departmentName) {
    filters.targetType = 'department';
    filters.targetQuery = draft.departmentName;
  }
  return filters;
}

export default function AuditLogView() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  const [page, setPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);
  const [filterDraft, setFilterDraft] = useState<AuditLogFilterDraft>(EMPTY_FILTER_DRAFT);
  const [appliedFilters, setAppliedFilters] = useState<
    Omit<TAdminAuditLogListParams, 'limit' | 'offset'>
  >({});
  const { data, isLoading, isError } = useAdminAuditLog(page, appliedFilters, {
    enabled: hasSearched,
  });
  const verifyAuditLog = useVerifyAdminAuditLog();
  const { data: departmentsData } = useDepartments();
  const departments = departmentsData?.departments ?? [];

  const handleViewLogs = () => {
    setAppliedFilters(toAppliedFilters(filterDraft));
    setPage(1);
    setHasSearched(true);
  };

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / AUDIT_LOG_PAGE_SIZE));

  const handleVerify = () => {
    verifyAuditLog.mutate(undefined, {
      onSuccess: (result) => {
        showToast({
          message: result.ok
            ? localize('com_admin_audit_log_verify_ok')
            : localize('com_admin_audit_log_verify_broken', {
                seq: result.brokenAt ?? '?',
                reason: result.reason ?? '',
              }),
          severity: result.ok ? NotificationSeverity.SUCCESS : NotificationSeverity.ERROR,
        });
      },
      onError: () => {
        showToast({
          message: localize('com_admin_audit_log_verify_error'),
          severity: NotificationSeverity.ERROR,
        });
      },
    });
  };

  const handleExport = async () => {
    try {
      const blob = await dataService.exportAdminAuditLogCsv();
      download(blob, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    } catch {
      showToast({
        message: localize('com_admin_audit_log_export_error'),
        severity: NotificationSeverity.ERROR,
      });
    }
  };

  let body: ReactNode;
  if (!hasSearched) {
    body = null;
  } else if (isLoading) {
    body = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  } else if (isError) {
    body = (
      <p className="text-sm text-text-secondary">{localize('com_admin_audit_log_load_error')}</p>
    );
  } else if (entries.length === 0) {
    body = <p className="text-sm text-text-secondary">{localize('com_admin_audit_log_empty')}</p>;
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-light text-left text-xs text-text-secondary">
              <th className="px-3 py-2 font-medium">
                {localize('com_admin_audit_log_col_timestamp')}
              </th>
              <th className="px-3 py-2 font-medium">{localize('com_admin_audit_log_col_actor')}</th>
              <th className="px-3 py-2 font-medium">
                {localize('com_admin_audit_log_col_action')}
              </th>
              <th className="px-3 py-2 font-medium">
                {localize('com_admin_audit_log_col_target')}
              </th>
              <th className="px-3 py-2 font-medium">
                {localize('com_admin_audit_log_col_outcome')}
              </th>
              <th className="px-3 py-2 font-medium">
                {localize('com_admin_audit_log_col_details')}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <AuditLogRow key={entry.id} entry={entry} locale={locale} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">
          {localize('com_admin_audit_log_title')}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleVerify} disabled={verifyAuditLog.isLoading}>
            {localize('com_admin_audit_log_verify')}
          </Button>
          <Button variant="outline" onClick={handleExport}>
            {localize('com_admin_audit_log_export_csv')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 sm:w-[300px]">
          <LocalizedDateRangePicker
            startDate={filterDraft.startDate}
            endDate={filterDraft.endDate}
            futureDatesDisabled
            locale={locale}
            labels={{
              apply: localize('com_ui_done'),
              cancel: localize('com_ui_cancel'),
              startDate: localize('com_admin_audit_log_filter_from'),
              endDate: localize('com_admin_audit_log_filter_to'),
              invalidRange: localize('com_admin_audit_log_invalid_date_range'),
            }}
            placeholder={localize('com_admin_audit_log_date_range_placeholder')}
            onSelectDateRange={(startDate, endDate) =>
              setFilterDraft((f) => ({ ...f, startDate, endDate }))
            }
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          {localize('com_admin_audit_log_filter_department')}
          <select
            value={filterDraft.departmentName}
            onChange={(e) => setFilterDraft((f) => ({ ...f, departmentName: e.target.value }))}
            className="rounded-lg border border-border-light bg-surface-primary px-2 py-1 text-sm text-text-primary"
          >
            <option value="">{localize('com_admin_audit_log_filter_department_all')}</option>
            {departments.map((department) => (
              <option key={department._id} value={department.name}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={handleViewLogs}>
          {localize('com_admin_audit_log_view_logs')}
        </Button>
      </div>

      {body}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-text-secondary">
          <button
            type="button"
            disabled={page <= 1}
            className="disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {localize('com_admin_access_page_prev')}
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            className="disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {localize('com_admin_access_page_next')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
