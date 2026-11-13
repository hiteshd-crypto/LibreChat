# feat(admin): pricing multi-select model picker

## What changed

- `PricingView.tsx`: replaced the search-filter combobox with a multi-select "master" combobox
  (`toggleModel`/`displayedKeys`) — pick any number of models to show as rows, with a "Clear All"
  action.
- `PricingRow.tsx`: dropped the per-row model-switcher dropdown now that the master combobox
  controls which rows are displayed.
- `packages/client/src/common/types.ts`: `OptionWithIcon` gains an optional `selected?: boolean`.
- `packages/client/src/components/ControlCombobox.tsx`: renders `selected` as `aria-selected` plus
  highlight styling — needed for the new multi-select master combobox and not used elsewhere yet.

## Why

The old single-model dropdown-per-row plus a text search didn't scale well once there were more
than a handful of pricing rates to review at once; picking several specific models to compare
side by side needed a genuine multi-select.

## Ops notes

None — frontend-only, no backend/schema changes.
