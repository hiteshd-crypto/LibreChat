import {
  AUTH_USER_DOC_BY_ID_PREFIX,
  CacheKeys,
  SystemRoles,
  roleDefaults,
  permissionsSchema,
  removeNullishValues,
} from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type { CacheStore, IRole, IUser } from '~/types';
import { scopedCacheKey, getTenantId, runAsSystem, SYSTEM_TENANT_ID } from '~/config/tenantContext';
import { escapeRegExp } from '~/utils/string';
import logger from '~/config/winston';

const systemRoleValues = new Set<string>(Object.values(SystemRoles));

/** Case-insensitive check — the legacy roles route uppercases params. */
function isSystemRoleName(name: string): boolean {
  return systemRoleValues.has(name.toUpperCase());
}

function isAuthUserDocCacheEnabled(): boolean {
  return process.env.AUTH_USER_CACHE_MODE === 'on';
}

export class RoleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleConflictError';
  }
}

export interface RoleDeps {
  /** Returns a cache store for the given key. Injected from getLogStores. */
  getCache?: (key: string) => CacheStore | undefined;
}

export function createRoleMethods(
  mongoose: typeof import('mongoose'),
  deps: RoleDeps = {},
): {
  listRoles: (options?: {
    limit?: number;
    offset?: number;
  }) => Promise<Pick<IRole, '_id' | 'roleKey' | 'name' | 'description' | 'parentRole' | 'depth'>[]>;
  countRoles: () => Promise<number>;
  initializeRoles: () => Promise<void>;
  migrateRoleKeys: (options?: { dryRun?: boolean }) => Promise<{
    keyed: number;
    parentLinks: number;
    users: number;
    principals: number;
    dryRun: boolean;
    planned?: string[];
  }>;
  getRoleByName: (roleName: string, fieldsToSelect?: string | string[] | null) => Promise<IRole>;
  findRolesByNames: (
    roleNames: string[],
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IRole[]>;
  updateRoleByName: (roleName: string, updates: Partial<IRole>) => Promise<IRole>;
  updateAccessPermissions: (
    roleName: string,
    permissionsUpdate: Record<string, Record<string, boolean>>,
    roleData?: IRole,
  ) => Promise<void>;
  migrateRoleSchema: (roleName?: string) => Promise<number>;
  createRoleByName: (roleData: Partial<IRole>) => Promise<IRole>;
  deleteRoleByName: (roleName: string) => Promise<IRole | null>;
  updateUsersByRole: (oldRole: string, newRole: string) => Promise<void>;
  findUserIdsByRole: (roleName: string) => Promise<string[]>;
  updateUsersRoleByIds: (userIds: string[], newRole: string) => Promise<void>;
  listUsersByRole: (
    roleName: string,
    options?: { limit?: number; offset?: number },
  ) => Promise<IUser[]>;
  countUsersByRole: (roleName: string) => Promise<number>;
  getAncestorRoleKeys: (roleKey: string) => Promise<string[]>;
  getDescendantRoleKeys: (roleKey: string) => Promise<string[]>;
  isDescendantOf: (childKey: string, ancestorKey: string) => Promise<boolean>;
  canViewRole: (actorKey: string, targetKey: string) => Promise<boolean>;
  wouldCreateCycle: (roleKey: string, newParentKey: string | null) => Promise<boolean>;
  setRoleParent: (roleKey: string, newParentKey: string | null) => Promise<IRole>;
  countChildRoles: (roleKey: string) => Promise<number>;
} {
  /**
   * Initialize default roles in the system.
   * Creates the default roles (ADMIN, USER) if they don't exist in the database.
   * Updates existing roles with new permission types if they're missing.
   */
  async function initializeRoles(): Promise<void> {
    const Role = mongoose.models.Role;

    for (const roleName of [SystemRoles.ADMIN, SystemRoles.USER]) {
      // Strict mode hides off-schema SHARED_GLOBAL and won't $unset it on save; migrate it via the raw driver.
      // eslint-disable-next-line no-restricted-syntax -- Role is a global (non-tenant) collection; raw read is required to see the off-schema field.
      const legacyDoc = await Role.collection.findOne({ name: roleName });
      if (legacyDoc?.permissions) {
        const set: Record<string, unknown> = {};
        const unset: Record<string, ''> = {};
        for (const permType of ['PROMPTS', 'AGENTS']) {
          const block = legacyDoc.permissions[permType];
          if (block && 'SHARED_GLOBAL' in block) {
            if (!('SHARE' in block)) {
              set[`permissions.${permType}.SHARE`] = block.SHARED_GLOBAL;
            }
            unset[`permissions.${permType}.SHARED_GLOBAL`] = '';
          }
        }
        if (Object.keys(unset).length) {
          const update: Record<string, unknown> = { $unset: unset };
          if (Object.keys(set).length) {
            update.$set = set;
          }
          // eslint-disable-next-line no-restricted-syntax -- Role is a global (non-tenant) collection; raw $unset is required to drop the off-schema field.
          await Role.collection.updateOne({ name: roleName }, update);
        }
      }
      let role = await Role.findOne({ name: roleName });
      const defaultPerms = roleDefaults[roleName].permissions;

      if (!role) {
        role = new Role({ ...roleDefaults[roleName], description: '' });
      } else {
        if (role.description == null) {
          role.description = '';
        }
        const permissions = role.toObject()?.permissions ?? {};
        role.permissions = role.permissions || {};
        for (const permType of Object.keys(defaultPerms)) {
          const defaultBlock = defaultPerms[permType as keyof typeof defaultPerms] as Record<
            string,
            unknown
          >;
          const existingBlock = permissions[permType] as Record<string, unknown> | null | undefined;
          if (existingBlock == null) {
            role.permissions[permType] = defaultBlock;
            continue;
          }
          const mergedBlock: Record<string, unknown> = { ...existingBlock };
          for (const field of Object.keys(defaultBlock)) {
            if (mergedBlock[field] == null) {
              mergedBlock[field] = defaultBlock[field];
            }
          }
          role.permissions[permType] = mergedBlock;
        }
      }
      await role.save();
    }

    await migrateRoleKeys();
  }

  /**
   * One-time, idempotent migration from name-based to `roleKey`-based references.
   * Runs inside `initializeRoles` at boot (before the server accepts traffic) and
   * via the `migrate:role-keys` CLI. Names are still globally unique when the
   * name→key map is built, so every rewrite below is unambiguous.
   */
  async function migrateRoleKeys(options: { dryRun?: boolean } = {}): Promise<{
    keyed: number;
    parentLinks: number;
    users: number;
    principals: number;
    dryRun: boolean;
    planned?: string[];
  }> {
    const dryRun = options.dryRun === true;
    const Role = mongoose.models.Role as Model<IRole>;
    const User = mongoose.models.User as Model<IUser>;
    const planned: string[] = [];

    /* eslint-disable no-restricted-syntax -- boot migration: reads/writes pre-hook, off-schema, and cross-collection refs on the global (non-tenant) Role/User collections. */
    const rawRoles = await Role.collection
      .find({}, { projection: { name: 1, parentRole: 1, roleKey: 1 } })
      .toArray();

    const needsKey = rawRoles.filter((role) => !role.roleKey);
    const keyByName = new Map<string, string>();
    for (const role of rawRoles) {
      const key =
        (role.roleKey as string | undefined) ??
        (isSystemRoleName(role.name) ? role.name.toUpperCase() : String(role._id));
      keyByName.set(role.name, key);
    }
    const knownKeys = new Set(keyByName.values());

    /**
     * Fast path for a boot after the migration already ran: every role is keyed,
     * no `parentRole` still holds a name, and no user / grant still references a
     * custom role by name. Skips ~one query per custom role on every restart.
     */
    const customNames = rawRoles
      .filter((role) => !isSystemRoleName(role.name) && keyByName.get(role.name) !== role.name)
      .map((role) => role.name);
    const parentLinksPending = rawRoles.some((role) => {
      const parent = role.parentRole as string | null | undefined;
      return !!parent && keyByName.has(parent) && !knownKeys.has(parent);
    });
    if (needsKey.length === 0 && !parentLinksPending && customNames.length > 0) {
      const nameFilter = { principalType: 'role', principalId: { $in: customNames } };
      const [staleUsers, staleGrants, staleConfigs, staleAcl] = await Promise.all([
        User.collection.countDocuments({ role: { $in: customNames } }),
        mongoose.connection.collection('systemgrants').countDocuments(nameFilter),
        mongoose.connection.collection('configs').countDocuments(nameFilter),
        mongoose.connection.collection('aclentries').countDocuments(nameFilter),
      ]);
      if (staleUsers === 0 && staleGrants === 0 && staleConfigs === 0 && staleAcl === 0) {
        return { keyed: 0, parentLinks: 0, users: 0, principals: 0, dryRun, planned };
      }
    }

    for (const role of needsKey) {
      const key = keyByName.get(role.name) as string;
      planned.push(`role "${role.name}" → roleKey ${key}`);
      if (!dryRun) {
        await Role.collection.updateOne({ _id: role._id }, { $set: { roleKey: key } });
      }
    }

    let parentLinks = 0;
    for (const role of rawRoles) {
      const parent = role.parentRole as string | null | undefined;
      if (parent && !knownKeys.has(parent) && keyByName.has(parent)) {
        const key = keyByName.get(parent) as string;
        planned.push(`role "${role.name}".parentRole "${parent}" → ${key}`);
        parentLinks += 1;
        if (!dryRun) {
          await Role.collection.updateOne({ _id: role._id }, { $set: { parentRole: key } });
        }
      }
    }

    let users = 0;
    let principals = 0;
    const migratedUserIds: string[] = [];
    for (const role of rawRoles) {
      if (isSystemRoleName(role.name)) {
        continue;
      }
      const key = keyByName.get(role.name) as string;
      if (key === role.name) {
        continue;
      }
      const affected = await User.collection
        .find({ role: role.name }, { projection: { _id: 1 } })
        .toArray();
      if (affected.length > 0) {
        planned.push(`${affected.length} user(s) role "${role.name}" → ${key}`);
        users += affected.length;
        migratedUserIds.push(...affected.map((user) => String(user._id)));
        if (!dryRun) {
          await User.collection.updateMany({ role: role.name }, { $set: { role: key } });
        }
      }
      for (const collectionName of ['systemgrants', 'configs', 'aclentries']) {
        const filter = { principalType: 'role', principalId: role.name };
        const count = await mongoose.connection.collection(collectionName).countDocuments(filter);
        if (count > 0) {
          planned.push(`${count} ${collectionName} principal "${role.name}" → ${key}`);
          principals += count;
          if (!dryRun) {
            await mongoose.connection
              .collection(collectionName)
              .updateMany(filter, { $set: { principalId: key } });
          }
        }
      }
    }

    if (!dryRun && (needsKey.length > 0 || parentLinks > 0)) {
      await Role.collection.dropIndex('name_1_tenantId_1').catch(() => undefined);
      await Role.syncIndexes();
      const cache = deps.getCache?.(CacheKeys.ROLES);
      if (cache) {
        await Promise.all(
          [...keyByName.values()].map((key) => cache.set(scopedCacheKey(key), null)),
        );
      }
      await invalidateAuthUserDocCache(migratedUserIds);
      logger.info(
        `[migrateRoleKeys] keyed=${needsKey.length} parentLinks=${parentLinks} users=${users} principals=${principals}`,
      );
    }
    /* eslint-enable no-restricted-syntax */

    return { keyed: needsKey.length, parentLinks, users, principals, dryRun, planned };
  }

  /**
   * List all roles in the system. Projects `roleKey`, name, description, and the
   * hierarchy fields (`parentRole`, `depth`) the admin Access tree renders from.
   */
  async function listRoles(options?: {
    limit?: number;
    offset?: number;
  }): Promise<Pick<IRole, '_id' | 'roleKey' | 'name' | 'description' | 'parentRole' | 'depth'>[]> {
    const Role = mongoose.models.Role as Model<IRole>;
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    return await Role.find({})
      .select('roleKey name description parentRole depth')
      .sort({ name: 1 })
      .skip(offset)
      .limit(limit)
      .lean();
  }

  async function countRoles(): Promise<number> {
    const Role = mongoose.models.Role;
    return await Role.countDocuments({});
  }

  /**
   * Retrieve a role by its `roleKey` (the system-role sentinels `ADMIN`/`USER`, or a
   * custom role's `_id` string) and convert the found document to a plain object.
   * When the role is missing and `roleRef` is a system-role name, create it and
   * return the lean version.
   */
  async function getRoleByName(
    roleRef: string,
    fieldsToSelect: string | string[] | null = null,
  ): Promise<IRole> {
    const cache = deps.getCache?.(CacheKeys.ROLES);
    try {
      if (cache) {
        const cachedRole = await cache.get(scopedCacheKey(roleRef));
        if (cachedRole) {
          return cachedRole as IRole;
        }
      }
      const Role = mongoose.models.Role;
      let query = Role.findOne({ roleKey: roleRef });
      if (fieldsToSelect) {
        query = query.select(fieldsToSelect);
      }
      const role = await query.lean().exec();

      if (!role && systemRoleValues.has(roleRef)) {
        const newRole = await new Role(roleDefaults[roleRef as keyof typeof roleDefaults]).save();
        if (cache) {
          await cache.set(scopedCacheKey(roleRef), newRole);
        }
        return newRole.toObject() as IRole;
      }
      if (cache) {
        await cache.set(scopedCacheKey(roleRef), role);
      }
      return role as unknown as IRole;
    } catch (error) {
      throw new Error(`Failed to retrieve or create role: ${(error as Error).message}`);
    }
  }

  /**
   * Find roles by name without using or populating the shared role-name cache.
   * Use this for tenant-scoped authorization lookups where the active ALS tenant context must control the query.
   *
   * When a non-system tenant context is active, the tenant-isolation plugin scopes the
   * query to that tenant. When no tenant context is active (base/global users), the lookup
   * runs under an explicit system context — so strict-mode isolation does not reject the
   * context-less query — while an explicit base-role filter (`tenantId` unset) ensures a
   * base user cannot match, and be assigned, a role that only exists within some tenant.
   */
  async function findRolesByNames(
    roleNames: string[],
    fieldsToSelect: string | string[] | null = null,
  ): Promise<IRole[]> {
    try {
      const uniqueRoleNames = [
        ...new Set(roleNames.map((roleName) => roleName.trim()).filter(Boolean)),
      ];
      if (uniqueRoleNames.length === 0) {
        return [] as IRole[];
      }

      const Role = mongoose.models.Role;
      /**
       * A config-declared list may still hold role *names* while `user.role` now
       * holds a `roleKey` — match either so both keep resolving.
       */
      const nameFilter = {
        $or: [
          { roleKey: { $in: uniqueRoleNames } },
          ...uniqueRoleNames.map((roleName) => ({
            name: new RegExp(`^${escapeRegExp(roleName)}$`, 'i'),
          })),
        ],
      };

      const runQuery = (filter: Record<string, unknown>) => {
        let query = Role.find(filter);
        if (fieldsToSelect) {
          query = query.select(fieldsToSelect);
        }
        return query.lean<IRole[]>().exec();
      };

      const tenantId = getTenantId();
      if (tenantId && tenantId !== SYSTEM_TENANT_ID) {
        return await runQuery(nameFilter);
      }

      return await runAsSystem(() =>
        runQuery({ ...nameFilter, tenantId: { $in: [null, undefined] } }),
      );
    } catch (error) {
      throw new Error(`Failed to retrieve roles: ${(error as Error).message}`);
    }
  }

  /**
   * Update a role addressed by its `roleKey`. A rename is a single-document write —
   * children reference the parent's `roleKey`, and users reference `roleKey`, so
   * nothing else moves. Rejects a rename that would collide with a direct sibling.
   */
  async function updateRoleByName(roleRef: string, updates: Partial<IRole>): Promise<IRole> {
    const cache = deps.getCache?.(CacheKeys.ROLES);
    try {
      const Role = mongoose.models.Role as Model<IRole>;
      if (updates.name) {
        const self = await Role.findOne({ roleKey: roleRef }, 'parentRole').lean();
        const clash = await Role.exists({
          parentRole: self?.parentRole ?? null,
          name: updates.name,
          roleKey: { $ne: roleRef },
        });
        if (clash) {
          throw new RoleConflictError(`A role named "${updates.name}" already exists here`);
        }
      }
      const role = await Role.findOneAndUpdate(
        { roleKey: roleRef },
        { $set: updates },
        { new: true },
      )
        .select('-__v')
        .lean()
        .exec();
      if (cache) {
        await cache.set(scopedCacheKey(roleRef), role);
      }
      return role as unknown as IRole;
    } catch (error) {
      if (error instanceof RoleConflictError) {
        throw error;
      }
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        throw new RoleConflictError(
          `A role named "${updates.name ?? roleRef}" already exists here`,
        );
      }
      const updateError = new Error(
        `Failed to update role: ${(error as Error).message}`,
      ) as Error & {
        cause?: unknown;
      };
      updateError.cause = error;
      throw updateError;
    }
  }

  /**
   * Updates access permissions for a specific role and multiple permission types.
   * `roleName` holds a `roleKey` (system sentinel or a custom role's `_id`).
   */
  async function updateAccessPermissions(
    roleName: string,
    permissionsUpdate: Record<string, Record<string, boolean>>,
    roleData?: IRole,
  ): Promise<void> {
    const updates: Record<string, Record<string, boolean>> = {};
    for (const [permissionType, permissions] of Object.entries(permissionsUpdate)) {
      if (
        permissionsSchema.shape &&
        permissionsSchema.shape[permissionType as keyof typeof permissionsSchema.shape]
      ) {
        updates[permissionType] = removeNullishValues(permissions) as Record<string, boolean>;
      }
    }
    if (!Object.keys(updates).length) {
      return;
    }

    try {
      const role = roleData ?? (await getRoleByName(roleName));
      if (!role) {
        return;
      }

      const currentPermissions =
        ((role as unknown as Record<string, unknown>).permissions as Record<
          string,
          Record<string, boolean>
        >) || {};
      const updatedPermissions: Record<string, Record<string, boolean>> = { ...currentPermissions };
      let hasChanges = false;

      const unsetFields: Record<string, number> = {};
      const permissionTypes = Object.keys(permissionsSchema.shape || {});
      for (const permType of permissionTypes) {
        if (
          (role as unknown as Record<string, unknown>)[permType] &&
          typeof (role as unknown as Record<string, unknown>)[permType] === 'object'
        ) {
          logger.info(
            `Migrating '${roleName}' role from old schema: found '${permType}' at top level`,
          );

          updatedPermissions[permType] = {
            ...updatedPermissions[permType],
            ...((role as unknown as Record<string, unknown>)[permType] as Record<string, boolean>),
          };

          unsetFields[permType] = 1;
          hasChanges = true;
        }
      }

      // Migrate legacy SHARED_GLOBAL → SHARE for PROMPTS and AGENTS.
      // SHARED_GLOBAL was removed in favour of SHARE in PR #11283. If the DB still has
      // SHARED_GLOBAL but not SHARE, inherit the value so sharing intent is preserved.
      const legacySharedGlobalTypes = ['PROMPTS', 'AGENTS'];
      for (const legacyPermType of legacySharedGlobalTypes) {
        const existingTypePerms = currentPermissions[legacyPermType];
        if (
          existingTypePerms &&
          'SHARED_GLOBAL' in existingTypePerms &&
          !('SHARE' in existingTypePerms) &&
          updates[legacyPermType] &&
          // Don't override an explicit SHARE value the caller already provided
          !('SHARE' in updates[legacyPermType])
        ) {
          const inheritedValue = existingTypePerms['SHARED_GLOBAL'];
          updates[legacyPermType]['SHARE'] = inheritedValue;
          logger.info(
            `Migrating '${roleName}' role ${legacyPermType}.SHARED_GLOBAL=${inheritedValue} → SHARE`,
          );
        }
      }

      for (const [permissionType, permissions] of Object.entries(updates)) {
        const currentTypePermissions = currentPermissions[permissionType] || {};
        updatedPermissions[permissionType] = { ...currentTypePermissions };

        for (const [permission, value] of Object.entries(permissions)) {
          if (currentTypePermissions[permission] !== value) {
            updatedPermissions[permissionType][permission] = value;
            hasChanges = true;
            logger.info(
              `Updating '${roleName}' role permission '${permissionType}' '${permission}' from ${currentTypePermissions[permission]} to: ${value}`,
            );
          }
        }
      }

      // Clean up orphaned SHARED_GLOBAL fields left in DB after the schema rename.
      // Since we $set the full permissions object, deleting from updatedPermissions
      // is sufficient to remove the field from MongoDB.
      for (const legacyPermType of legacySharedGlobalTypes) {
        const existingTypePerms = currentPermissions[legacyPermType];
        if (existingTypePerms && 'SHARED_GLOBAL' in existingTypePerms) {
          if (!updates[legacyPermType]) {
            // permType wasn't in the update payload so the migration block above didn't run.
            // Create a writable copy and handle the SHARED_GLOBAL → SHARE inheritance here
            // to avoid removing SHARED_GLOBAL without writing SHARE (data loss).
            updatedPermissions[legacyPermType] = { ...existingTypePerms };
            if (!('SHARE' in existingTypePerms)) {
              updatedPermissions[legacyPermType]['SHARE'] = existingTypePerms['SHARED_GLOBAL'];
              logger.info(
                `Migrating '${roleName}' role ${legacyPermType}.SHARED_GLOBAL=${existingTypePerms['SHARED_GLOBAL']} → SHARE`,
              );
            }
          }
          delete updatedPermissions[legacyPermType]['SHARED_GLOBAL'];
          hasChanges = true;
          logger.info(
            `Removed legacy SHARED_GLOBAL field from '${roleName}' role ${legacyPermType} permissions`,
          );
        }
      }

      if (hasChanges) {
        const Role = mongoose.models.Role;
        const updateObj = { permissions: updatedPermissions };

        if (Object.keys(unsetFields).length > 0) {
          logger.info(
            `Unsetting old schema fields for '${roleName}' role: ${Object.keys(unsetFields).join(', ')}`,
          );

          try {
            await Role.updateOne(
              { roleKey: roleName },
              {
                $set: updateObj,
                $unset: unsetFields,
              },
            );

            const cache = deps.getCache?.(CacheKeys.ROLES);
            const updatedRole = await Role.findOne({ roleKey: roleName })
              .select('-__v')
              .lean()
              .exec();
            if (cache) {
              await cache.set(scopedCacheKey(roleName), updatedRole);
            }

            logger.info(`Updated role '${roleName}' and removed old schema fields`);
          } catch (updateError) {
            logger.error(`Error during role migration update: ${(updateError as Error).message}`);
            throw updateError;
          }
        } else {
          await updateRoleByName(roleName, updateObj as unknown as Partial<IRole>);
        }

        logger.info(`Updated '${roleName}' role permissions`);
      } else {
        logger.info(`No changes needed for '${roleName}' role permissions`);
      }
    } catch (error) {
      logger.error(`Failed to update ${roleName} role permissions:`, error);
    }
  }

  /**
   * Migrates roles from old schema to new schema structure.
   */
  async function migrateRoleSchema(roleName?: string): Promise<number> {
    try {
      const Role = mongoose.models.Role;
      let roles;
      if (roleName) {
        const role = await Role.findOne({ name: roleName });
        roles = role ? [role] : [];
      } else {
        roles = await Role.find({});
      }

      logger.info(`Migrating ${roles.length} roles to new schema structure`);
      let migratedCount = 0;

      for (const role of roles) {
        const permissionTypes = Object.keys(permissionsSchema.shape || {});
        const unsetFields: Record<string, number> = {};
        let hasOldSchema = false;

        for (const permType of permissionTypes) {
          if (role[permType] && typeof role[permType] === 'object') {
            hasOldSchema = true;
            role.permissions = role.permissions || {};
            role.permissions[permType] = {
              ...role.permissions[permType],
              ...role[permType],
            };
            unsetFields[permType] = 1;
          }
        }

        if (hasOldSchema) {
          try {
            logger.info(`Migrating role '${role.name}' from old schema structure`);

            await Role.updateOne(
              { _id: role._id },
              {
                $set: { permissions: role.permissions },
                $unset: unsetFields,
              },
            );

            const cache = deps.getCache?.(CacheKeys.ROLES);
            if (cache) {
              const updatedRole = await Role.findById(role._id).lean().exec();
              await cache.set(scopedCacheKey(role.name), updatedRole);
            }

            migratedCount++;
            logger.info(`Migrated role '${role.name}'`);
          } catch (error) {
            logger.error(`Failed to migrate role '${role.name}': ${(error as Error).message}`);
          }
        }
      }

      logger.info(`Migration complete: ${migratedCount} roles migrated`);
      return migratedCount;
    } catch (error) {
      logger.error(`Role schema migration failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Creates a custom role. `roleData.parentRole` is the parent's `roleKey` (or
   * `null`/absent for a top-level role). `roleKey` is minted by the schema's
   * `pre('validate')` hook. Rejects: a reserved system name; a name that collides
   * with a direct sibling (or, at top level, another top-level role).
   */
  async function createRoleByName(roleData: Partial<IRole>): Promise<IRole> {
    const { name } = roleData;
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Role name is required');
    }
    const trimmed = name.trim();
    if (isSystemRoleName(trimmed)) {
      throw new RoleConflictError(`Cannot create role with reserved system name: ${name}`);
    }
    const Role = mongoose.models.Role as Model<IRole>;

    const { parentRole } = roleData;
    let depth = 0;
    let parentKey: string | null = null;
    if (parentRole != null) {
      const parent = (await Role.findOne({ roleKey: parentRole }, 'depth name roleKey').lean()) as {
        depth?: number;
        name: string;
        roleKey: string;
      } | null;
      if (!parent) {
        throw new Error(`Parent role "${parentRole}" does not exist`);
      }
      if (isSystemRoleName(parent.name)) {
        throw new Error(`Cannot set parent to system role: ${parent.name}`);
      }
      parentKey = parent.roleKey;
      depth = (parent.depth ?? 0) + 1;
    }

    const sibling = await Role.findOne({ parentRole: parentKey, name: trimmed }).lean();
    if (sibling) {
      throw new RoleConflictError(
        parentKey
          ? `A role named "${trimmed}" already exists under this parent`
          : `A top-level role named "${trimmed}" already exists`,
      );
    }

    let role;
    try {
      role = await new Role({
        ...roleData,
        name: trimmed,
        parentRole: parentKey,
        depth,
      }).save();
    } catch (err) {
      /**
       * The `{ parentRole, name, tenantId }` unique index triggers error 11000
       * when a concurrent request races past the `findOne` check above.
       */
      if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
        throw new RoleConflictError(`A role named "${trimmed}" already exists here`);
      }
      throw err;
    }
    try {
      const cache = deps.getCache?.(CacheKeys.ROLES);
      if (cache) {
        await cache.set(scopedCacheKey(role.roleKey), role.toObject());
      }
    } catch (cacheError) {
      logger.error(`[createRoleByName] cache set failed for "${role.roleKey}":`, cacheError);
    }
    return role.toObject() as IRole;
  }

  /**
   * Guards against deleting system roles. Reassigns affected users back to USER.
   *
   * No existence pre-check is performed: for a nonexistent role the `updateMany`
   * is a harmless no-op and `findOneAndDelete` returns null. This makes the
   * function idempotent — a retry after a partial failure will still clean up
   * orphaned user references and cache entries.
   *
   * Without a MongoDB transaction the two writes are non-atomic — if the delete
   * fails after the reassignment, users will already have been moved to USER
   * while the role document still exists. Recovery requires the caller to retry
   * the delete call, which will succeed since the `updateMany` is a no-op on
   * the second pass.
   */
  async function deleteRoleByName(roleRef: string): Promise<IRole | null> {
    const Role = mongoose.models.Role as Model<IRole>;
    const doc = await Role.findOne({ roleKey: roleRef }, 'name roleKey').lean();
    if (!doc) {
      return null;
    }
    if (isSystemRoleName(doc.name)) {
      throw new Error(`Cannot delete system role: ${doc.name}`);
    }
    const childCount = await countChildRoles(roleRef);
    if (childCount > 0) {
      throw new RoleConflictError(
        `Cannot delete role "${doc.name}": it has ${childCount} child role(s). Re-parent or delete them first.`,
      );
    }
    const User = mongoose.models.User as Model<IUser>;
    const affectedUserIds = await findUserIdsByRole(roleRef);
    await User.updateMany({ role: roleRef }, { $set: { role: SystemRoles.USER } });
    await invalidateAuthUserDocCache(affectedUserIds);
    const deleted = await Role.findOneAndDelete({ roleKey: roleRef }).lean();
    try {
      const cache = deps.getCache?.(CacheKeys.ROLES);
      if (cache) {
        // Setting null evicts the stale document. getRoleByName treats falsy cached
        // values as a miss and falls through to the DB, so this does not provide
        // negative caching — it only prevents serving the pre-deletion document.
        await cache.set(scopedCacheKey(roleRef), null);
      }
    } catch (cacheError) {
      logger.error(`[deleteRoleByName] cache invalidation failed for "${roleRef}":`, cacheError);
    }
    return deleted as IRole | null;
  }

  async function updateUsersByRole(oldRole: string, newRole: string): Promise<void> {
    const User = mongoose.models.User as Model<IUser>;
    const affectedUserIds = await findUserIdsByRole(oldRole);
    await User.updateMany({ role: oldRole }, { $set: { role: newRole } });
    await invalidateAuthUserDocCache(affectedUserIds);
  }

  async function findUserIdsByRole(roleName: string): Promise<string[]> {
    const User = mongoose.models.User as Model<IUser>;
    const users = await User.find({ role: roleName }).select('_id').lean();
    return users.map((u) => u._id.toString());
  }

  async function updateUsersRoleByIds(userIds: string[], newRole: string): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    const User = mongoose.models.User as Model<IUser>;
    await User.updateMany({ _id: { $in: userIds } }, { $set: { role: newRole } });
    await invalidateAuthUserDocCache(userIds);
  }

  async function invalidateAuthUserDocCache(userIds: string[]): Promise<void> {
    if (!isAuthUserDocCacheEnabled() || userIds.length === 0) {
      return;
    }
    const cache = deps.getCache?.(CacheKeys.AUTH_USER_DOC);
    if (!cache?.get || !cache?.delete) {
      return;
    }
    try {
      const uniqueUserIds = [...new Set(userIds.map((userId) => userId.toString()))];
      await Promise.all(
        uniqueUserIds.map(async (userId) => {
          const indexKey = `${AUTH_USER_DOC_BY_ID_PREFIX}:${userId}`;
          const cachedKeys = await cache.get(indexKey);
          if (Array.isArray(cachedKeys)) {
            await Promise.all(
              cachedKeys.map((key) => (typeof key === 'string' ? cache.delete?.(key) : undefined)),
            );
          }
          await cache.delete?.(indexKey);
        }),
      );
    } catch (cacheError) {
      logger.error('[roleMethods] auth user doc cache invalidation failed:', cacheError);
    }
  }

  async function listUsersByRole(
    roleName: string,
    options?: { limit?: number; offset?: number },
  ): Promise<IUser[]> {
    const User = mongoose.models.User as Model<IUser>;
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    return await User.find({ role: roleName })
      .select('_id name email avatar')
      .sort({ _id: 1 })
      .skip(offset)
      .limit(limit)
      .lean<IUser[]>();
  }

  async function countUsersByRole(roleName: string): Promise<number> {
    const User = mongoose.models.User as Model<IUser>;
    return await User.countDocuments({ role: roleName });
  }

  /**
   * Hierarchy resolver — the single owner of every `parentRole` traversal.
   *
   * Each call reads a fresh `{ roleKey, parentRole }` projection of the whole
   * roles collection (~10 rows) rather than the individual-doc `CacheKeys.ROLES`
   * cache, so an authorization decision is never made against a stale tree after
   * a re-parent or rename, and there is no cache-invalidation dependency to get
   * wrong. Every value below is a `roleKey`.
   */
  interface RoleGraphNode {
    roleKey: string;
    parentRole: string | null;
  }

  async function fetchRoleGraph(): Promise<RoleGraphNode[]> {
    const Role = mongoose.models.Role as Model<IRole>;
    return await Role.find({}, 'roleKey parentRole').lean<RoleGraphNode[]>();
  }

  function buildChildrenMap(graph: RoleGraphNode[]): Map<string, string[]> {
    const children = new Map<string, string[]>();
    for (const { roleKey, parentRole } of graph) {
      if (!parentRole) {
        continue;
      }
      const siblings = children.get(parentRole) ?? [];
      siblings.push(roleKey);
      children.set(parentRole, siblings);
    }
    return children;
  }

  /** Walks `parentRole` to the top of the branch; returns `roleKey` itself when already top-level. */
  function rootKeyOf(graph: RoleGraphNode[], roleKey: string): string {
    const parentByKey = new Map(graph.map((node) => [node.roleKey, node.parentRole]));
    const seen = new Set<string>([roleKey]);
    let current = roleKey;
    let parent = parentByKey.get(current) ?? null;
    while (parent && !seen.has(parent)) {
      current = parent;
      seen.add(current);
      parent = parentByKey.get(current) ?? null;
    }
    return current;
  }

  async function getAncestorRoleKeys(roleKey: string): Promise<string[]> {
    const graph = await fetchRoleGraph();
    const parentByKey = new Map(graph.map((node) => [node.roleKey, node.parentRole]));
    const ancestors: string[] = [];
    const seen = new Set<string>([roleKey]);
    let current = parentByKey.get(roleKey) ?? null;
    while (current && !seen.has(current)) {
      ancestors.push(current);
      seen.add(current);
      current = parentByKey.get(current) ?? null;
    }
    return ancestors;
  }

  async function getDescendantRoleKeys(roleKey: string): Promise<string[]> {
    const graph = await fetchRoleGraph();
    const children = buildChildrenMap(graph);
    const descendants: string[] = [];
    const seen = new Set<string>();
    const queue = [...(children.get(roleKey) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      descendants.push(next);
      queue.push(...(children.get(next) ?? []));
    }
    return descendants;
  }

  async function isDescendantOf(childKey: string, ancestorKey: string): Promise<boolean> {
    const ancestors = await getAncestorRoleKeys(childKey);
    return ancestors.includes(ancestorKey);
  }

  async function canViewRole(actorKey: string, targetKey: string): Promise<boolean> {
    if (actorKey === SystemRoles.ADMIN) {
      return true;
    }
    return isDescendantOf(targetKey, actorKey);
  }

  async function wouldCreateCycle(roleKey: string, newParentKey: string | null): Promise<boolean> {
    if (!newParentKey) {
      return false;
    }
    if (newParentKey === roleKey) {
      return true;
    }
    const descendants = await getDescendantRoleKeys(roleKey);
    return descendants.includes(newParentKey);
  }

  async function countChildRoles(roleKey: string): Promise<number> {
    const Role = mongoose.models.Role;
    return await Role.countDocuments({ parentRole: roleKey });
  }

  /**
   * Re-parents a role addressed by its `roleKey` and recomputes `depth` for it
   * and its whole subtree. Throws a plain `Error` for a missing role/parent or a
   * system role; `RoleConflictError` for a cycle, a cross-branch move (the new
   * parent's top-level root differs from the role's), or a name clash with an
   * existing child of the new parent. `newParentKey === null` is rejected for a
   * non-top-level role (its root would change) and is a no-op for a top-level one.
   */
  async function setRoleParent(roleKey: string, newParentKey: string | null): Promise<IRole> {
    const Role = mongoose.models.Role as Model<IRole>;
    const self = await Role.findOne({ roleKey }, 'name roleKey parentRole').lean();
    if (!self) {
      throw new Error(`Role "${roleKey}" not found`);
    }
    if (isSystemRoleName(self.name)) {
      throw new Error(`Cannot re-parent system role: ${self.name}`);
    }

    let parentDoc: { depth?: number; name: string; roleKey: string } | null = null;
    if (newParentKey != null) {
      parentDoc = (await Role.findOne({ roleKey: newParentKey }, 'depth name roleKey').lean()) as {
        depth?: number;
        name: string;
        roleKey: string;
      } | null;
      if (!parentDoc) {
        throw new Error(`Parent role "${newParentKey}" does not exist`);
      }
      if (isSystemRoleName(parentDoc.name)) {
        throw new Error(`Cannot set parent to system role: ${parentDoc.name}`);
      }
    }

    const graph = await fetchRoleGraph();
    if (await wouldCreateCycle(roleKey, newParentKey)) {
      throw new RoleConflictError(`Setting parent to "${newParentKey}" would create a cycle`);
    }
    const currentRoot = rootKeyOf(graph, roleKey);
    const newRoot = newParentKey != null ? rootKeyOf(graph, newParentKey) : roleKey;
    if (currentRoot !== newRoot) {
      throw new RoleConflictError('cannot move a role to a different branch');
    }

    if (newParentKey != null) {
      const clash = await Role.exists({
        parentRole: newParentKey,
        name: self.name,
        roleKey: { $ne: roleKey },
      });
      if (clash) {
        throw new RoleConflictError(
          `A role named "${self.name}" already exists under the target parent`,
        );
      }
    }

    const children = buildChildrenMap(graph);
    const newRootDepth = (parentDoc?.depth ?? -1) + 1;

    const depthByKey = new Map<string, number>([[roleKey, newRootDepth]]);
    const queue = [roleKey];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const currentDepth = depthByKey.get(current) as number;
      for (const child of children.get(current) ?? []) {
        depthByKey.set(child, currentDepth + 1);
        queue.push(child);
      }
    }

    const affectedKeys = [...depthByKey.keys()];
    await Promise.all(
      affectedKeys.map((key) =>
        Role.updateOne(
          { roleKey: key },
          key === roleKey
            ? { $set: { parentRole: newParentKey, depth: newRootDepth } }
            : { $set: { depth: depthByKey.get(key) } },
        ),
      ),
    );

    const [updatedRole, subtreeUserIds] = await Promise.all([
      Role.findOne({ roleKey }).select('-__v').lean(),
      Promise.all(affectedKeys.map((key) => findUserIdsByRole(key))).then((ids) => ids.flat()),
    ]);

    const cache = deps.getCache?.(CacheKeys.ROLES);
    if (cache) {
      await Promise.all(affectedKeys.map((key) => cache.set(scopedCacheKey(key), null)));
    }
    await invalidateAuthUserDocCache(subtreeUserIds);

    if (!updatedRole) {
      throw new Error(`Role "${roleKey}" not found after re-parenting`);
    }
    return updatedRole as unknown as IRole;
  }

  return {
    listRoles,
    countRoles,
    initializeRoles,
    migrateRoleKeys,
    getRoleByName,
    findRolesByNames,
    updateRoleByName,
    updateAccessPermissions,
    migrateRoleSchema,
    createRoleByName,
    deleteRoleByName,
    updateUsersByRole,
    findUserIdsByRole,
    updateUsersRoleByIds,
    listUsersByRole,
    countUsersByRole,
    getAncestorRoleKeys,
    getDescendantRoleKeys,
    isDescendantOf,
    canViewRole,
    wouldCreateCycle,
    setRoleParent,
    countChildRoles,
  };
}

export type RoleMethods = ReturnType<typeof createRoleMethods>;
