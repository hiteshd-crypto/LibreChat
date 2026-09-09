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
 * Seeds, via `createRoleByName` (so `roleKey` is minted and `parentRole` holds keys):
 *   SUPERVISOR
 *     └── SALES_MANAGER
 *           └── SALES_EMPLOYEE
 *   SUPPORT_MANAGER (separate branch)
 *     └── SUPPORT_EMPLOYEE
 */
async function seedTree() {
  const sup = await methods.createRoleByName({ name: 'SUPERVISOR' });
  const salesMgr = await methods.createRoleByName({
    name: 'SALES_MANAGER',
    parentRole: sup.roleKey,
  });
  const salesEmp = await methods.createRoleByName({
    name: 'SALES_EMPLOYEE',
    parentRole: salesMgr.roleKey,
  });
  const supportMgr = await methods.createRoleByName({ name: 'SUPPORT_MANAGER' });
  const supportEmp = await methods.createRoleByName({
    name: 'SUPPORT_EMPLOYEE',
    parentRole: supportMgr.roleKey,
  });
  return { sup, salesMgr, salesEmp, supportMgr, supportEmp };
}

describe('hierarchy resolver', () => {
  it('getAncestorRoleKeys walks up to the root', async () => {
    const { sup, salesMgr, salesEmp } = await seedTree();
    await expect(methods.getAncestorRoleKeys(salesEmp.roleKey)).resolves.toEqual([
      salesMgr.roleKey,
      sup.roleKey,
    ]);
    await expect(methods.getAncestorRoleKeys(sup.roleKey)).resolves.toEqual([]);
  });

  it('getDescendantRoleKeys collects the whole subtree', async () => {
    const { sup, salesMgr, salesEmp } = await seedTree();
    const keys = await methods.getDescendantRoleKeys(sup.roleKey);
    expect(new Set(keys)).toEqual(new Set([salesMgr.roleKey, salesEmp.roleKey]));
    await expect(methods.getDescendantRoleKeys(salesEmp.roleKey)).resolves.toEqual([]);
  });

  it('isDescendantOf / canViewRole enforce branch isolation', async () => {
    const { sup, salesMgr, salesEmp, supportMgr, supportEmp } = await seedTree();
    await expect(methods.isDescendantOf(salesEmp.roleKey, sup.roleKey)).resolves.toBe(true);
    await expect(methods.canViewRole(salesMgr.roleKey, supportEmp.roleKey)).resolves.toBe(false);
    await expect(methods.canViewRole(supportMgr.roleKey, salesEmp.roleKey)).resolves.toBe(false);
    await expect(methods.canViewRole(SystemRoles.ADMIN, salesEmp.roleKey)).resolves.toBe(true);
    await expect(methods.canViewRole(SystemRoles.ADMIN, SystemRoles.USER)).resolves.toBe(true);
    await expect(methods.canViewRole(sup.roleKey, SystemRoles.USER)).resolves.toBe(false);
  });

  it('wouldCreateCycle rejects self and descendant parents', async () => {
    const { sup, salesMgr, salesEmp, supportMgr } = await seedTree();
    await expect(methods.wouldCreateCycle(sup.roleKey, sup.roleKey)).resolves.toBe(true);
    await expect(methods.wouldCreateCycle(sup.roleKey, salesEmp.roleKey)).resolves.toBe(true);
    await expect(methods.wouldCreateCycle(salesMgr.roleKey, null)).resolves.toBe(false);
    await expect(methods.wouldCreateCycle(salesEmp.roleKey, supportMgr.roleKey)).resolves.toBe(
      false,
    );
  });
});

describe('setRoleParent', () => {
  it('allows a same-branch move and recomputes depth for the subtree', async () => {
    const { sup, salesEmp } = await seedTree();
    const updated = await methods.setRoleParent(salesEmp.roleKey, sup.roleKey);
    expect(updated.parentRole).toBe(sup.roleKey);
    expect(updated.depth).toBe(1);
  });

  it('rejects a cross-branch move', async () => {
    const { salesMgr, supportMgr } = await seedTree();
    await expect(methods.setRoleParent(salesMgr.roleKey, supportMgr.roleKey)).rejects.toThrow(
      /different branch/,
    );
  });

  it('rejects making a nested role top-level (its root would change)', async () => {
    const { salesMgr } = await seedTree();
    await expect(methods.setRoleParent(salesMgr.roleKey, null)).rejects.toThrow(RoleConflictError);
  });

  it('rejects a move that would duplicate a sibling name', async () => {
    const { sup, salesMgr } = await seedTree();
    const dupe = await methods.createRoleByName({
      name: 'SALES_MANAGER',
      parentRole: salesMgr.roleKey,
    });
    await expect(methods.setRoleParent(dupe.roleKey, sup.roleKey)).rejects.toThrow(
      RoleConflictError,
    );
  });

  it('rejects a cycle', async () => {
    const { sup, salesMgr } = await seedTree();
    await expect(methods.setRoleParent(sup.roleKey, salesMgr.roleKey)).rejects.toThrow(/cycle/);
  });

  it('rejects a nonexistent parent', async () => {
    const { salesMgr } = await seedTree();
    await expect(methods.setRoleParent(salesMgr.roleKey, 'ghost-key')).rejects.toThrow();
  });

  it('rejects re-parenting a system role', async () => {
    await seedTree();
    await expect(methods.setRoleParent(SystemRoles.USER, 'anything')).rejects.toThrow();
  });
});

describe('countChildRoles', () => {
  it('counts direct children only', async () => {
    const { sup, salesEmp } = await seedTree();
    await expect(methods.countChildRoles(sup.roleKey)).resolves.toBe(1);
    await expect(methods.countChildRoles(salesEmp.roleKey)).resolves.toBe(0);
  });
});
