import { useMemo, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { Input, Spinner, Button } from '@librechat/client';
import type { TAdminRole } from 'librechat-data-provider';
import MoveRoleDialog, { type MoveIntent } from './MoveRoleDialog';
import SetDepartmentHeadDialog from './SetDepartmentHeadDialog';
import { buildRoleMaps, reparentBlock } from './reparent';
import CreateRoleDialog from './CreateRoleDialog';
import { useAdminRoles } from '~/data-provider';
import { buildRoleLabels } from './roleLabels';
import { orderRolesByTree } from './roleTree';
import EditRoleDialog from './EditRoleDialog';
import { SYSTEM_ROLES } from './constants';
import { useLocalize } from '~/hooks';
import RoleRow from './RoleRow';

const DRAG_TYPE = 'access-role';

interface DragItem {
  roleKey: string;
  rootKey: string;
  name: string;
}

function DraggableRoleRow({
  role,
  depth,
  isSystem,
  isTopLevel,
  rootKey,
  label,
  roles,
  onEdit,
  onManageMembers,
  onAdd,
  onKeyboardMove,
  onHoverBlocked,
  onValidDrop,
}: {
  role: TAdminRole;
  depth: number;
  isSystem: boolean;
  isTopLevel: boolean;
  rootKey: string;
  label: string;
  roles: TAdminRole[];
  onEdit: () => void;
  onManageMembers: () => void;
  onAdd: () => void;
  onKeyboardMove: () => void;
  onHoverBlocked: (reason: 'cross-branch', dragged: { name: string; rootKey: string }) => void;
  onValidDrop: (sourceKey: string, targetKey: string) => void;
}) {
  const handleRef = useRef<HTMLButtonElement | null>(null);

  const [{ isDragging }, drag] = useDrag<DragItem, unknown, { isDragging: boolean }>({
    type: DRAG_TYPE,
    item: { roleKey: role.roleKey, rootKey, name: role.name },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const [, drop] = useDrop<DragItem, unknown, unknown>({
    accept: DRAG_TYPE,
    canDrop: (item) => reparentBlock(roles, item.roleKey, role.roleKey) === null,
    hover: (item, monitor) => {
      if (!monitor.isOver({ shallow: true })) {
        return;
      }
      const block = reparentBlock(roles, item.roleKey, role.roleKey);
      if (block === 'cross-branch') {
        onHoverBlocked(block, { name: item.name, rootKey: item.rootKey });
      }
    },
    drop: (item, monitor) => {
      if (monitor.canDrop()) {
        onValidDrop(item.roleKey, role.roleKey);
      }
    },
  });

  const setHandle = (el: HTMLButtonElement | null) => {
    handleRef.current = el;
    drag(el);
  };
  const containerRef = (el: HTMLDivElement | null) => drop(el);

  return (
    <div ref={containerRef} style={{ marginLeft: `${depth * 1.25}rem` }}>
      <RoleRow
        role={role}
        isSystem={isSystem}
        isTopLevel={isTopLevel}
        label={label}
        isDragging={isDragging}
        dragHandleRef={setHandle}
        onEdit={onEdit}
        onManageMembers={onManageMembers}
        onAdd={onAdd}
        onKeyboardMove={onKeyboardMove}
      />
    </div>
  );
}

export default function DepartmentTreeView({
  scopeRootRoleKey,
  departmentId,
  departmentName,
}: {
  /**
   * Tri-state: `undefined` (the prop omitted) is the Department Head's own
   * unscoped view — their branch is already the only one the server returns
   * (`attachDepartmentScope`), which is the real authorization boundary; a
   * string is the Super Admin's drill-down into one *staffed* Department from
   * `DepartmentListView`, filtered client-side to just that branch; `null` is
   * the Super Admin viewing a Department with no root role yet — zero rows
   * are rendered regardless of what the unscoped fetch returned. This prop is
   * purely a Super Admin convenience/empty-state marker and must never be
   * treated as an authorization boundary.
   */
  scopeRootRoleKey?: string | null;
  /** The empty-department id to link a first top-level role to — only
   * meaningful (and only forwarded to the top-level Create dialog) when
   * `scopeRootRoleKey === null`. */
  departmentId?: string;
  /** Rendered as a heading above the search/Create row when provided. */
  departmentName?: string;
} = {}) {
  const localize = useLocalize();
  const { data, isLoading, isError } = useAdminRoles();
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<TAdminRole | null>(null);
  const [editInitialTab, setEditInitialTab] = useState<'details' | 'members'>('details');
  const [addUnder, setAddUnder] = useState<TAdminRole | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [setHeadOpen, setSetHeadOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveIntent | null>(null);
  const [dropNotice, setDropNotice] = useState<string | null>(null);

  const allRolesUnscoped = useMemo(() => data?.roles ?? [], [data?.roles]);
  const unscopedMaps = useMemo(() => buildRoleMaps(allRolesUnscoped), [allRolesUnscoped]);
  const allRoles = useMemo(() => {
    if (scopeRootRoleKey === null) {
      return [];
    }
    if (!scopeRootRoleKey) {
      return allRolesUnscoped;
    }
    return allRolesUnscoped.filter(
      (role) =>
        role.roleKey === scopeRootRoleKey ||
        unscopedMaps.rootKeyByKey.get(role.roleKey) === scopeRootRoleKey,
    );
  }, [allRolesUnscoped, unscopedMaps, scopeRootRoleKey]);
  const labelMap = useMemo(() => buildRoleLabels(allRoles), [allRoles]);
  const maps = useMemo(() => buildRoleMaps(allRoles), [allRoles]);

  const orderedRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? allRoles.filter((r) => r.name.toLowerCase().includes(q)) : allRoles;
    return orderRolesByTree(filtered);
  }, [allRoles, search]);

  if (isLoading) {
    return (
      <div data-testid="admin-roles-loading" className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-text-secondary">{localize('com_admin_access_load_error')}</p>;
  }

  const parentNameOf = (role: TAdminRole) =>
    role.parentRole ? maps.byKey.get(role.parentRole)?.name : undefined;

  return (
    <div className="flex flex-col gap-4">
      {departmentName ? (
        <h2 className="text-base font-semibold text-text-primary">{departmentName}</h2>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={localize('com_admin_access_search_placeholder')}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          {scopeRootRoleKey === null && departmentId ? (
            <Button variant="outline" type="button" onClick={() => setSetHeadOpen(true)}>
              {localize('com_admin_department_set_head_action')}
            </Button>
          ) : null}
          <Button variant="submit" type="button" onClick={() => setCreateOpen(true)}>
            {localize('com_admin_access_create_title')}
          </Button>
        </div>
      </div>

      {dropNotice ? (
        <p role="status" className="text-sm text-text-secondary">
          {dropNotice}
        </p>
      ) : null}

      {orderedRoles.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('com_admin_access_empty')}</p>
      ) : (
        orderedRoles.map(({ role, depth }) => (
          <DraggableRoleRow
            key={role.roleKey}
            role={role}
            depth={depth}
            isSystem={SYSTEM_ROLES.has(role.name)}
            isTopLevel={role.parentRole == null}
            rootKey={maps.rootKeyByKey.get(role.roleKey) ?? role.roleKey}
            label={labelMap.get(role.roleKey) ?? role.name}
            roles={allRoles}
            onEdit={() => {
              setEditInitialTab('details');
              setEditTarget(role);
            }}
            onManageMembers={() => {
              setEditInitialTab('members');
              setEditTarget(role);
            }}
            onAdd={() => setAddUnder(role)}
            onKeyboardMove={() => {
              setDropNotice(null);
              setMoveTarget({ role });
            }}
            onHoverBlocked={(_reason, dragged) =>
              setDropNotice(
                localize('com_admin_role_move_out_of_branch', {
                  0: maps.byKey.get(dragged.rootKey)?.name ?? '',
                }),
              )
            }
            onValidDrop={(sourceKey, targetKey) => {
              setDropNotice(null);
              const source = maps.byKey.get(sourceKey);
              if (source) {
                setMoveTarget({ role: source, newParentKey: targetKey });
              }
            }}
          />
        ))
      )}

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        departmentId={scopeRootRoleKey === null ? departmentId : undefined}
      />
      {scopeRootRoleKey === null && departmentId ? (
        <SetDepartmentHeadDialog
          open={setHeadOpen}
          onOpenChange={setSetHeadOpen}
          departmentId={departmentId}
        />
      ) : null}
      <CreateRoleDialog
        open={addUnder != null}
        parent={addUnder}
        onOpenChange={(v) => {
          if (!v) {
            setAddUnder(null);
          }
        }}
      />
      <EditRoleDialog
        role={editTarget}
        parentName={editTarget ? parentNameOf(editTarget) : undefined}
        initialTab={editInitialTab}
        onClose={() => setEditTarget(null)}
      />
      <MoveRoleDialog
        move={moveTarget}
        roles={allRoles}
        labelMap={labelMap}
        onClose={() => setMoveTarget(null)}
      />
    </div>
  );
}
