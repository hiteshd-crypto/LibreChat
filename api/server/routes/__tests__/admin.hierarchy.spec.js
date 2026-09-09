const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { createModels, createMethods } = require('@librechat/data-schemas');
const { SystemRoles, PrincipalType } = require('librechat-data-provider');
const {
  createHierarchyMiddleware,
  createAdminUsersHandlers,
  createAdminHierarchyHandlers,
  createAdminRolesHandlers,
  generateCapabilityCheck,
} = require('@librechat/api');
const { connectTestDb } = require('../../../test/connectTestDb');

/**
 * Integration test for the role-hierarchy wiring: the resolver (role.ts) +
 * hierarchy middleware + admin user/role handlers, exercised against a real
 * MongoDB with real SystemGrant-backed capability checks. `req.user` is injected
 * in place of a JWT; every capability decision below hits real `systemgrants`.
 * Roles are referenced by their immutable `roleKey`.
 */

let teardown;
let db;
let capabilityCheck;

beforeAll(async () => {
  teardown = await connectTestDb();
  createModels(mongoose);
  db = createMethods(mongoose);
  capabilityCheck = generateCapabilityCheck({
    getUserPrincipals: db.getUserPrincipals,
    hasCapabilityForPrincipals: db.hasCapabilityForPrincipals,
  });
}, 60000);

afterAll(async () => {
  await teardown();
});

afterEach(async () => {
  await Promise.all([
    mongoose.models.User.deleteMany({}),
    mongoose.models.Role.deleteMany({}),
    mongoose.models.SystemGrant.deleteMany({}),
    mongoose.models.Conversation.deleteMany({}),
    mongoose.models.Message.deleteMany({}),
  ]);
});

let seedCounter = 0;

/** `roleKey` is the immutable identifier now stored on `user.role`. */
async function createUser(roleKey) {
  seedCounter += 1;
  const user = await mongoose.models.User.create({
    email: `u-${seedCounter}-${Date.now()}@x.io`,
    name: `user-${seedCounter}`,
    provider: 'local',
    role: roleKey,
  });
  return user._id.toString();
}

/**
 * Seeds, via `createRoleByName` (mints `roleKey`, `parentRole` holds keys):
 *   SUPERVISOR
 *     └── SALES_MANAGER
 *           └── SALES_EMPLOYEE
 *   SUPPORT_MANAGER
 *     └── SUPPORT_EMPLOYEE
 * and grants `read:subordinates` to each branch role by its key.
 */
async function seedTree() {
  const supervisor = await db.createRoleByName({ name: 'SUPERVISOR' });
  const salesMgr = await db.createRoleByName({
    name: 'SALES_MANAGER',
    parentRole: supervisor.roleKey,
  });
  const salesEmp = await db.createRoleByName({
    name: 'SALES_EMPLOYEE',
    parentRole: salesMgr.roleKey,
  });
  const supportMgr = await db.createRoleByName({ name: 'SUPPORT_MANAGER' });
  const supportEmp = await db.createRoleByName({
    name: 'SUPPORT_EMPLOYEE',
    parentRole: supportMgr.roleKey,
  });
  for (const role of [supervisor, salesMgr, salesEmp, supportMgr, supportEmp]) {
    await db.grantCapability({
      principalType: PrincipalType.ROLE,
      principalId: role.roleKey,
      capability: 'read:subordinates',
    });
  }
  return { supervisor, salesMgr, salesEmp, supportMgr, supportEmp };
}

async function grantAdmin(adminId) {
  await db.grantCapability({
    principalType: PrincipalType.ROLE,
    principalId: SystemRoles.ADMIN,
    capability: 'access:admin',
  });
  return adminId;
}

function createApp() {
  const { requireSubordinateAccess, attachHierarchyScope } = createHierarchyMiddleware({
    hasCapability: capabilityCheck.hasCapability,
    findUsers: db.findUsers,
    canViewRole: db.canViewRole,
    getDescendantRoleKeys: db.getDescendantRoleKeys,
  });
  const requireAnyAccess = capabilityCheck.requireAnyCapability([
    'access:admin',
    'read:users',
    'read:subordinates',
  ]);
  const requireAdmin = capabilityCheck.requireCapability('access:admin');

  const noop = () => Promise.resolve(undefined);
  const userHandlers = createAdminUsersHandlers({
    findUsers: db.findUsers,
    countUsers: db.countUsers,
    updateUsersRoleByIds: db.updateUsersRoleByIds,
    canViewRole: db.canViewRole,
    getRoleByName: db.getRoleByName,
    beginAgentTriggerUserDeletion: noop,
    cancelAgentTriggerUserDeletion: noop,
    drainAgentTriggerDeliveriesForUser: noop,
    prepareAgentTriggerUserPurge: noop,
    cancelAgentTriggerUserPurge: noop,
    purgeAgentTriggerDeliveriesForUser: noop,
    deleteUserById: noop,
    deleteUserCodeEnvironments: noop,
    invalidateCodeEnvironmentConfigCache: noop,
    deleteConfig: noop,
    deleteAclEntries: noop,
  });
  const hierarchyHandlers = createAdminHierarchyHandlers({
    hasCapability: capabilityCheck.hasCapability,
    getDescendantRoleKeys: db.getDescendantRoleKeys,
  });
  const roleHandlers = createAdminRolesHandlers({
    listRoles: db.listRoles,
    countRoles: db.countRoles,
    getRoleByName: db.getRoleByName,
    createRoleByName: db.createRoleByName,
    updateRoleByName: db.updateRoleByName,
    updateAccessPermissions: db.updateAccessPermissions,
    deleteRoleByName: db.deleteRoleByName,
    setRoleParent: db.setRoleParent,
    countChildRoles: db.countChildRoles,
    grantCapability: db.grantCapability,
    findUser: db.findUser,
    updateUser: db.updateUser,
    listUsersByRole: db.listUsersByRole,
    countUsersByRole: db.countUsersByRole,
    deleteConfig: noop,
    deleteAclEntries: noop,
    deleteGrantsForPrincipal: () => Promise.resolve([]),
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.headers['x-test-user'];
    if (header) {
      req.user = JSON.parse(header);
    }
    next();
  });

  const usersRouter = express.Router();
  usersRouter.use(requireAnyAccess);
  usersRouter.get('/', attachHierarchyScope, userHandlers.listUsers);
  usersRouter.get('/search', attachHierarchyScope, userHandlers.searchUsers);
  usersRouter.patch('/:userId/role', requireSubordinateAccess, userHandlers.reassignUserRole);
  app.use('/api/admin/users', usersRouter);

  const rolesRouter = express.Router();
  rolesRouter.use(requireAdmin);
  rolesRouter.post('/', roleHandlers.createRole);
  rolesRouter.patch('/:roleKey', roleHandlers.updateRole);
  app.use('/api/admin/roles', rolesRouter);

  const hierarchyRouter = express.Router();
  hierarchyRouter.get('/me', hierarchyHandlers.getMyHierarchy);
  app.use('/api/admin/hierarchy', hierarchyRouter);

  return app;
}

function as(userId, roleKey) {
  return JSON.stringify({ id: userId, _id: userId, role: roleKey });
}

describe('Role hierarchy — Integration', () => {
  it('resolves the tree: getDescendantRoleKeys walks the whole subtree', async () => {
    const { supervisor, salesMgr, salesEmp } = await seedTree();
    const keys = await db.getDescendantRoleKeys(supervisor.roleKey);
    expect(new Set(keys)).toEqual(new Set([salesMgr.roleKey, salesEmp.roleKey]));
  });

  it('listRoles projects roleKey, parentRole, and depth for the Access tree', async () => {
    const { salesMgr } = await seedTree();
    const roles = await db.listRoles({ limit: 200 });
    const salesEmployee = roles.find((r) => r.name === 'SALES_EMPLOYEE');
    expect(salesEmployee.roleKey).toBe(String(salesEmployee._id));
    expect(salesEmployee.parentRole).toBe(salesMgr.roleKey);
    expect(salesEmployee.depth).toBe(2);
    const supervisor = roles.find((r) => r.name === 'SUPERVISOR');
    expect(supervisor.parentRole ?? null).toBeNull();
    expect(supervisor.depth).toBe(0);
  });

  it('lets a SALES_MANAGER list only descendant users', async () => {
    const { salesMgr, salesEmp, supportEmp } = await seedTree();
    const mgrId = await createUser(salesMgr.roleKey);
    await createUser(salesEmp.roleKey);
    await createUser(supportEmp.roleKey);
    const app = createApp();

    const res = await request(app)
      .get('/api/admin/users')
      .set('x-test-user', as(mgrId, salesMgr.roleKey));

    expect(res.status).toBe(200);
    const roles = res.body.users.map((u) => u.role);
    expect(roles).toContain(salesEmp.roleKey);
    expect(roles).not.toContain(supportEmp.roleKey);
    expect(roles).not.toContain(salesMgr.roleKey);
  });

  it('gives an ADMIN the unscoped list', async () => {
    const { salesEmp, supportEmp } = await seedTree();
    const adminId = await createUser(SystemRoles.ADMIN);
    await grantAdmin(adminId);
    await createUser(salesEmp.roleKey);
    await createUser(supportEmp.roleKey);
    const app = createApp();

    const res = await request(app)
      .get('/api/admin/users')
      .set('x-test-user', as(adminId, SystemRoles.ADMIN));

    expect(res.status).toBe(200);
    const roles = res.body.users.map((u) => u.role);
    expect(roles).toEqual(expect.arrayContaining([salesEmp.roleKey, supportEmp.roleKey]));
  });

  it('denies a plain USER any access to /api/admin/users', async () => {
    await seedTree();
    const userId = await createUser(SystemRoles.USER);
    const app = createApp();

    const res = await request(app)
      .get('/api/admin/users')
      .set('x-test-user', as(userId, SystemRoles.USER));

    expect(res.status).toBe(403);
  });

  it('lets a SALES_MANAGER reassign a SALES_EMPLOYEE within the subtree', async () => {
    const { salesMgr, salesEmp } = await seedTree();
    const tier2 = await db.createRoleByName({
      name: 'SALES_EMPLOYEE_TIER_2',
      parentRole: salesMgr.roleKey,
    });
    await db.grantCapability({
      principalType: PrincipalType.ROLE,
      principalId: tier2.roleKey,
      capability: 'read:subordinates',
    });
    const mgrId = await createUser(salesMgr.roleKey);
    const empId = await createUser(salesEmp.roleKey);
    const app = createApp();

    const res = await request(app)
      .patch(`/api/admin/users/${empId}/role`)
      .set('x-test-user', as(mgrId, salesMgr.roleKey))
      .send({ role: tier2.roleKey });

    expect(res.status).toBe(200);
    const moved = await mongoose.models.User.findById(empId).lean();
    expect(moved.role).toBe(tier2.roleKey);
  });

  it('denies a SALES_MANAGER reassigning across branches', async () => {
    const { salesMgr, salesEmp, supportEmp } = await seedTree();
    const mgrId = await createUser(salesMgr.roleKey);
    const supportEmpId = await createUser(supportEmp.roleKey);
    const app = createApp();

    const res = await request(app)
      .patch(`/api/admin/users/${supportEmpId}/role`)
      .set('x-test-user', as(mgrId, salesMgr.roleKey))
      .send({ role: salesEmp.roleKey });

    expect(res.status).toBe(403);
  });

  it('denies a SALES_MANAGER promoting an employee up to its own tier', async () => {
    const { salesMgr, salesEmp } = await seedTree();
    const mgrId = await createUser(salesMgr.roleKey);
    const empId = await createUser(salesEmp.roleKey);
    const app = createApp();

    const res = await request(app)
      .patch(`/api/admin/users/${empId}/role`)
      .set('x-test-user', as(mgrId, salesMgr.roleKey))
      .send({ role: salesMgr.roleKey });

    expect(res.status).toBe(403);
  });

  it('GET /api/admin/hierarchy/me reflects each principal', async () => {
    const { supervisor, salesMgr, salesEmp } = await seedTree();
    const supervisorId = await createUser(supervisor.roleKey);
    const userId = await createUser(SystemRoles.USER);
    const app = createApp();

    const supervisorRes = await request(app)
      .get('/api/admin/hierarchy/me')
      .set('x-test-user', as(supervisorId, supervisor.roleKey));
    expect(supervisorRes.status).toBe(200);
    expect(supervisorRes.body.canViewSubordinates).toBe(true);
    expect(new Set(supervisorRes.body.viewableRoleKeys)).toEqual(
      new Set([salesMgr.roleKey, salesEmp.roleKey]),
    );

    const userRes = await request(app)
      .get('/api/admin/hierarchy/me')
      .set('x-test-user', as(userId, SystemRoles.USER));
    expect(userRes.body).toEqual({
      isAdmin: false,
      canViewSubordinates: false,
      viewableRoleKeys: [],
      manageableRoleKeys: [],
    });
  });

  it('rejects a cross-branch re-parent via PATCH /roles/:roleKey', async () => {
    const { salesMgr, supportMgr } = await seedTree();
    const adminId = await createUser(SystemRoles.ADMIN);
    await grantAdmin(adminId);
    const app = createApp();

    const res = await request(app)
      .patch(`/api/admin/roles/${salesMgr.roleKey}`)
      .set('x-test-user', as(adminId, SystemRoles.ADMIN))
      .send({ parentRole: supportMgr.roleKey });

    expect(res.status).toBe(400);
    const unchanged = await mongoose.models.Role.findOne({ roleKey: salesMgr.roleKey }).lean();
    expect(unchanged.parentRole).not.toBe(supportMgr.roleKey);
  });

  it('rejects creating a duplicate sibling name', async () => {
    const { salesMgr } = await seedTree();
    const adminId = await createUser(SystemRoles.ADMIN);
    await grantAdmin(adminId);
    const app = createApp();

    await request(app)
      .post('/api/admin/roles')
      .set('x-test-user', as(adminId, SystemRoles.ADMIN))
      .send({ name: 'DUP_SIB', parentRole: salesMgr.roleKey })
      .expect(201);

    const res = await request(app)
      .post('/api/admin/roles')
      .set('x-test-user', as(adminId, SystemRoles.ADMIN))
      .send({ name: 'DUP_SIB', parentRole: salesMgr.roleKey });

    expect(res.status).toBe(409);
  });

  it('allows the same name under a different parent', async () => {
    const { salesMgr, supportMgr } = await seedTree();
    const adminId = await createUser(SystemRoles.ADMIN);
    await grantAdmin(adminId);
    const app = createApp();

    await request(app)
      .post('/api/admin/roles')
      .set('x-test-user', as(adminId, SystemRoles.ADMIN))
      .send({ name: 'SHARED', parentRole: salesMgr.roleKey })
      .expect(201);

    await request(app)
      .post('/api/admin/roles')
      .set('x-test-user', as(adminId, SystemRoles.ADMIN))
      .send({ name: 'SHARED', parentRole: supportMgr.roleKey })
      .expect(201);

    const shared = await mongoose.models.Role.find({ name: 'SHARED' }).lean();
    expect(shared).toHaveLength(2);
  });
});
