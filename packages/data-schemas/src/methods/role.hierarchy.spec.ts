import mongoose from 'mongoose';
import { SystemRoles } from 'librechat-data-provider';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IRole } from '..';
import { createRoleMethods, RoleConflictError } from './role';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let Role: mongoose.Model<IRole>;
let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createRoleMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  Role = mongoose.models.Role as mongoose.Model<IRole>;
  methods = createRoleMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Role.deleteMany({});
});

/**
 * Seeds a tree:
 *   SUPERVISOR
 *     └── SALES_MANAGER
 *           └── SALES_EMPLOYEE
 *   SUPPORT_MANAGER (top-level, separate branch)
 *     └── SUPPORT_EMPLOYEE
 */
async function seedTree() {
  await Role.create([
    { name: 'SUPERVISOR', parentRole: null, depth: 0 },
    { name: 'SALES_MANAGER', parentRole: 'SUPERVISOR', depth: 1 },
    { name: 'SALES_EMPLOYEE', parentRole: 'SALES_MANAGER', depth: 2 },
    { name: 'SUPPORT_MANAGER', parentRole: null, depth: 0 },
    { name: 'SUPPORT_EMPLOYEE', parentRole: 'SUPPORT_MANAGER', depth: 1 },
  ]);
}

describe('hierarchy resolver', () => {
  describe('getAncestorRoleNames', () => {
    it('walks up to the root', async () => {
      await seedTree();
      await expect(methods.getAncestorRoleNames('SALES_EMPLOYEE')).resolves.toEqual([
        'SALES_MANAGER',
        'SUPERVISOR',
      ]);
    });

    it('returns an empty array for a top-level role', async () => {
      await seedTree();
      await expect(methods.getAncestorRoleNames('SUPERVISOR')).resolves.toEqual([]);
    });
  });

  describe('getDescendantRoleNames', () => {
    it('collects the whole subtree', async () => {
      await seedTree();
      const names = await methods.getDescendantRoleNames('SUPERVISOR');
      expect(new Set(names)).toEqual(new Set(['SALES_MANAGER', 'SALES_EMPLOYEE']));
    });

    it('returns an empty array for a leaf role', async () => {
      await seedTree();
      await expect(methods.getDescendantRoleNames('SALES_EMPLOYEE')).resolves.toEqual([]);
    });
  });

  describe('isDescendantOf / canViewRole', () => {
    it('confirms a deep descendant', async () => {
      await seedTree();
      await expect(methods.isDescendantOf('SALES_EMPLOYEE', 'SUPERVISOR')).resolves.toBe(true);
    });

    it('denies a sibling', async () => {
      await seedTree();
      await expect(methods.canViewRole('SALES_MANAGER', 'SUPPORT_EMPLOYEE')).resolves.toBe(false);
    });

    it('denies cross-branch access even at the same depth', async () => {
      await seedTree();
      await expect(methods.canViewRole('SUPPORT_MANAGER', 'SALES_EMPLOYEE')).resolves.toBe(false);
    });

    it('ADMIN can view any role, including USER', async () => {
      await seedTree();
      await expect(methods.canViewRole(SystemRoles.ADMIN, 'SALES_EMPLOYEE')).resolves.toBe(true);
      await expect(methods.canViewRole(SystemRoles.ADMIN, SystemRoles.USER)).resolves.toBe(true);
    });

    it('a hierarchy role can never view USER', async () => {
      await seedTree();
      await expect(methods.canViewRole('SUPERVISOR', SystemRoles.USER)).resolves.toBe(false);
    });
  });

  describe('wouldCreateCycle', () => {
    it('rejects a role as its own parent', async () => {
      await seedTree();
      await expect(methods.wouldCreateCycle('SUPERVISOR', 'SUPERVISOR')).resolves.toBe(true);
    });

    it('rejects moving a role under its own descendant', async () => {
      await seedTree();
      await expect(methods.wouldCreateCycle('SUPERVISOR', 'SALES_EMPLOYEE')).resolves.toBe(true);
    });

    it('allows moving a role to null (top-level)', async () => {
      await seedTree();
      await expect(methods.wouldCreateCycle('SALES_MANAGER', null)).resolves.toBe(false);
    });

    it('allows an unrelated move', async () => {
      await seedTree();
      await expect(methods.wouldCreateCycle('SALES_EMPLOYEE', 'SUPPORT_MANAGER')).resolves.toBe(
        false,
      );
    });
  });
});

describe('setRoleParent', () => {
  it('moves a role to a new parent and recomputes depth for its subtree', async () => {
    await seedTree();
    const updated = await methods.setRoleParent('SALES_MANAGER', 'SUPPORT_MANAGER');
    expect(updated.parentRole).toBe('SUPPORT_MANAGER');
    expect(updated.depth).toBe(1);

    const child = await Role.findOne({ name: 'SALES_EMPLOYEE' }).lean();
    expect(child?.depth).toBe(2);
  });

  it('moves a role to top-level (null parent)', async () => {
    await seedTree();
    const updated = await methods.setRoleParent('SALES_MANAGER', null);
    expect(updated.parentRole ?? null).toBeNull();
    expect(updated.depth).toBe(0);

    const child = await Role.findOne({ name: 'SALES_EMPLOYEE' }).lean();
    expect(child?.depth).toBe(1);
  });

  it('rejects a cycle', async () => {
    await seedTree();
    await expect(methods.setRoleParent('SUPERVISOR', 'SALES_EMPLOYEE')).rejects.toThrow(
      RoleConflictError,
    );
  });

  it('rejects a nonexistent parent', async () => {
    await seedTree();
    await expect(methods.setRoleParent('SALES_MANAGER', 'GHOST_ROLE')).rejects.toThrow();
  });

  it('rejects re-parenting a system role', async () => {
    await seedTree();
    await expect(methods.setRoleParent(SystemRoles.USER, 'SUPERVISOR')).rejects.toThrow();
  });

  it('rejects setting a system role as the parent', async () => {
    await seedTree();
    await expect(methods.setRoleParent('SALES_MANAGER', SystemRoles.ADMIN)).rejects.toThrow();
  });
});

describe('countChildRoles', () => {
  it('counts direct children only', async () => {
    await seedTree();
    await expect(methods.countChildRoles('SUPERVISOR')).resolves.toBe(1);
    await expect(methods.countChildRoles('SALES_EMPLOYEE')).resolves.toBe(0);
  });
});
