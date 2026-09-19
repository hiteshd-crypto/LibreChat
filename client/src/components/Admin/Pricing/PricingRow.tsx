import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Button,
  Input,
  Spinner,
  TableCell,
  TableRow,
  TableRowHeader,
  useToastContext,
} from '@librechat/client';
import type { TAdminPricingRate, TAdminPricingMutationResponse } from 'librechat-data-provider';
import { useCreatePricingRate, useUpdatePricingRate } from '~/data-provider';
import { getResponseErrorMessage } from '~/utils';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { parseRate } from './rates';

interface RowErrors {
  modelKey?: string;
  prompt?: string;
  completion?: string;
}

interface PricingRowProps {
  /** The stored rate; omitted for the Add New draft row, which starts in edit mode. */
  rate?: TAdminPricingRate;
  existingKeys: ReadonlySet<string>;
  /** Draft rows only: called on cancel and after a successful create. */
  onDiscard?: () => void;
  onRequestDelete?: (rate: TAdminPricingRate) => void;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-text-destructive">
      {message}
    </p>
  );
}

export default function PricingRow({
  rate,
  existingKeys,
  onDiscard,
  onRequestDelete,
}: PricingRowProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const createMutation = useCreatePricingRate();
  const updateMutation = useUpdatePricingRate();

  const isNew = rate == null;
  const [editing, setEditing] = useState(isNew);
  const [modelKey, setModelKey] = useState('');
  const [prompt, setPrompt] = useState(rate ? String(rate.prompt) : '');
  const [completion, setCompletion] = useState(rate ? String(rate.completion) : '');
  const [errors, setErrors] = useState<RowErrors>({});
  const modelRef = useRef<HTMLInputElement>(null);
  const saving = createMutation.isLoading || updateMutation.isLoading;
  const rowKey = rate?.modelKey ?? (modelKey.trim() || localize('com_admin_pricing_new_model'));

  useEffect(() => {
    if (isNew) {
      modelRef.current?.focus();
    }
  }, [isNew]);

  const startEditing = () => {
    if (!rate) {
      return;
    }
    setPrompt(String(rate.prompt));
    setCompletion(String(rate.completion));
    setErrors({});
    setEditing(true);
  };

  const cancel = () => {
    setErrors({});
    if (isNew) {
      onDiscard?.();
      return;
    }
    setEditing(false);
  };

  const validate = (): RowErrors => {
    const next: RowErrors = {};
    const key = modelKey.trim();
    if (isNew && !key) {
      next.modelKey = localize('com_admin_pricing_model_required');
    } else if (isNew && existingKeys.has(key)) {
      next.modelKey = localize('com_admin_pricing_model_exists');
    }
    if (parseRate(prompt) === null) {
      next.prompt = localize('com_admin_pricing_rate_invalid');
    }
    if (parseRate(completion) === null) {
      next.completion = localize('com_admin_pricing_rate_invalid');
    }
    return next;
  };

  const notifySaved = (result: TAdminPricingMutationResponse, key: string, created: boolean) =>
    showToast({
      message: result.cacheReloaded
        ? localize(created ? 'com_admin_pricing_created' : 'com_admin_pricing_saved', { 0: key })
        : localize('com_admin_pricing_cache_warning'),
      severity: result.cacheReloaded ? NotificationSeverity.SUCCESS : NotificationSeverity.WARNING,
    });

  const notifyFailed = (error: unknown) =>
    showToast({
      message: getResponseErrorMessage(error, localize('com_admin_pricing_save_error')),
      severity: NotificationSeverity.ERROR,
    });

  const save = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    const promptValue = parseRate(prompt);
    const completionValue = parseRate(completion);
    if (Object.keys(nextErrors).length > 0 || promptValue === null || completionValue === null) {
      return;
    }

    if (!rate) {
      const key = modelKey.trim();
      createMutation.mutate(
        { modelKey: key, prompt: promptValue, completion: completionValue },
        {
          onSuccess: (result) => {
            notifySaved(result, key, true);
            onDiscard?.();
          },
          onError: (error) =>
            axios.isAxiosError(error) && error.response?.status === 409
              ? setErrors({ modelKey: localize('com_admin_pricing_model_exists') })
              : notifyFailed(error),
        },
      );
      return;
    }

    updateMutation.mutate(
      { modelKey: rate.modelKey, updates: { prompt: promptValue, completion: completionValue } },
      {
        onSuccess: (result) => {
          notifySaved(result, rate.modelKey, false);
          setEditing(false);
        },
        onError: notifyFailed,
      },
    );
  };

  const promptId = `pricing-prompt-${rowKey}`;
  const completionId = `pricing-completion-${rowKey}`;
  const modelId = `pricing-model-${rowKey}`;

  return (
    <TableRow className="border-b border-border-light">
      {rate ? (
        <TableRowHeader className="p-3 text-text-primary">{rate.modelKey}</TableRowHeader>
      ) : (
        <TableCell className="p-3 align-top">
          <Input
            ref={modelRef}
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            aria-label={localize('com_admin_pricing_model_label')}
            aria-invalid={errors.modelKey ? true : undefined}
            aria-describedby={errors.modelKey ? modelId : undefined}
            placeholder={localize('com_admin_pricing_model_placeholder')}
            disabled={saving}
          />
          <FieldError id={modelId} message={errors.modelKey} />
        </TableCell>
      )}
      <TableCell className="p-3 align-top">
        <Input
          inputMode="decimal"
          value={editing ? prompt : String(rate?.prompt ?? '')}
          onChange={(e) => setPrompt(e.target.value)}
          readOnly={!editing}
          disabled={saving}
          aria-label={localize('com_admin_pricing_prompt_for', { 0: rowKey })}
          aria-invalid={errors.prompt ? true : undefined}
          aria-describedby={errors.prompt ? promptId : undefined}
        />
        <FieldError id={promptId} message={errors.prompt} />
      </TableCell>
      <TableCell className="p-3 align-top">
        <Input
          inputMode="decimal"
          value={editing ? completion : String(rate?.completion ?? '')}
          onChange={(e) => setCompletion(e.target.value)}
          readOnly={!editing}
          disabled={saving}
          aria-label={localize('com_admin_pricing_completion_for', { 0: rowKey })}
          aria-invalid={errors.completion ? true : undefined}
          aria-describedby={errors.completion ? completionId : undefined}
        />
        <FieldError id={completionId} message={errors.completion} />
      </TableCell>
      <TableCell className="p-3 align-top">
        <div className="flex justify-end gap-2">
          {editing ? (
            <>
              <Button variant="submit" type="button" disabled={saving} onClick={save}>
                {saving ? <Spinner /> : localize('com_ui_save')}
              </Button>
              <Button variant="outline" type="button" disabled={saving} onClick={cancel}>
                {localize('com_ui_cancel')}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              type="button"
              aria-label={localize('com_admin_pricing_update_for', { 0: rowKey })}
              onClick={startEditing}
            >
              {localize('com_ui_update')}
            </Button>
          )}
          {rate ? (
            <Button
              variant="outline"
              type="button"
              disabled={saving}
              aria-label={localize('com_admin_pricing_delete_for', { 0: rowKey })}
              onClick={() => onRequestDelete?.(rate)}
            >
              {localize('com_ui_delete')}
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
