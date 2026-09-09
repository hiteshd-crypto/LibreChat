import { useMemo, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { Input, Spinner, Button } from '@librechat/client';
import type { TAdminRole } from 'librechat-data-provider';
import MoveRoleDialog, { type MoveIntent } from './MoveRoleDialog';
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
  onAdd: () => void;
  onKeyboardMove: () => void;
  onHoverBlocked: (reason: 'cross-branch' | 'name-clash', targetName: string) => void;
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
      if (block === 'cross-branch' || block === 'name-clash') {
        onHoverBlocked(block, role.name);
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
        onAdd={onAdd}
        onKeyboardMove={onKeyboardMove}
      />
    </div>
  );
}

export default function AccessView() {
  const localize = useLocalize();
  const { data, isLoading, isError } = useAdminRoles();
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<TAdminRole | null>(null);
  const [addUnder, setAddUnder] = useState<TAdminRole | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveIntent | null>(null);
  const [dropNotice, setDropNotice] = useState<string | null>(null);

  const allRoles = useMemo(() => data?.roles ?? [], [data?.roles]);
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
      <div className="flex items-center justify-between gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={localize('com_admin_access_search_placeholder')}
          className="max-w-xs"
        />
        <Button variant="submit" type="button" onClick={() => setCreateOpen(true)}>
          {localize('com_admin_access_create_title')}
        </Button>
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
            onEdit={() => setEditTarget(role)}
            onAdd={() => setAddUnder(role)}
            onKeyboardMove={() => {
              setDropNotice(null);
              setMoveTarget({ role });
            }}
            onHoverBlocked={(reason, targetName) =>
              setDropNotice(
                reason === 'cross-branch'
                  ? localize('com_admin_role_move_out_of_branch', {
                      0: maps.byKey.get(maps.rootKeyByKey.get(role.roleKey) ?? '')?.name ?? '',
                    })
                  : localize('com_admin_role_move_name_clash', { 0: role.name, 1: targetName }),
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

      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />
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
