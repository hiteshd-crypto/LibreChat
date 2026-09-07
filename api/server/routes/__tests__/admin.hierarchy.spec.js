const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { createModels, createMethods } = require('@librechat/data-schemas');
const { SystemRoles, PrincipalType } = require('librechat-data-provider');
const {
  createHierarchyMiddleware,
  createAdminUsersHandlers,
  createAdminHierarchyHandlers,
  generateCapabilityCheck,
} = require('@librechat/api');
const { connectTestDb } = require('../../../test/connectTestDb');

/**
 * Integration test for the role-hierarchy wiring: the resolver (role.ts) +
 * hierarchy middleware + admin user handlers, exercised against a real MongoDB
 * with real SystemGrant-backed capability checks. `req.user` is injected in
 * place of a JWT; every capability decision below hits real `systemgrants`.
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

async function createUser(role) {
  seedCounter += 1;
  const user = await mongoose.models.User.create({
    email: `u-${seedCounter}-${Date.now()}@x.io`,
    name: `user-${role}-${seedCounter}`,
    provider: 'local',
    role,
  });
  return user._id.toString();
}

/**
 * Seeds:
 *   SUPERVISOR
 *     └── SALES_MANAGER
 *           └── SALES_EMPLOYEE
 *   SUPPORT_MANAGER
 *     └── SUPPORT_EMPLOYEE
 * and grants VIEW_SUBORDINATES to each branch role.
 */
async function seedTree() {
  await db.createRoleByName({ name: 'SUPERVISOR' });
  await db.createRoleByName({ name: 'SALES_MANAGER', parentRole: 'SUPERVISOR' });
  await db.createRoleByName({ name: 'SALES_EMPLOYEE', parentRole: 'SALES_MANAGER' });
  await db.createRoleByName({ name: 'SUPPORT_MANAGER' });
  await db.createRoleByName({ name: 'SUPPORT_EMPLOYEE', parentRole: 'SUPPORT_MANAGER' });
  for (const name of [
    'SUPERVISOR',
    'SALES_MANAGER',
    'SALES_EMPLOYEE',
    'SUPPORT_MANAGER',
    'SUPPORT_EMPLOYEE',
  ]) {
    await db.grantCapability({
      principalType: PrincipalType.ROLE,
      principalId: name,
      capability: 'read:subordinates',
    });
  }
}

function createApp() {
  const { requireSubordinateAccess, attachHierarchyScope } = createHierarchyMiddleware({
    hasCapability: capabilityCheck.hasCapability,
    findUsers: db.findUsers,
    canViewRole: db.canViewRole,
    getDescendantRoleNames: db.getDescendantRoleNames,
  });
  const requireAnyAccess = capabilityCheck.requireAnyCapability([
    'access:admin',
    'read:users',
    'read:subordinates',
  ]);

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
    getDescendantRoleNames: db.getDescendantRoleNames,
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

  const hierarchyRouter = express.Router();
  hierarchyRouter.get('/me', hierarchyHandlers.getMyHierarchy);
  app.use('/api/admin/hierarchy', hierarchyRouter);

  return app;
}

function as(userId, role) {
  return JSON.stringify({ id: userId, _id: userId, role });
}

describe('Role hierarchy — Integration', () => {
  it('resolves the tree: getDescendantRoleNames walks the whole subtree', async () => {
    await seedTree();
    const names = await db.getDescendantRoleNames('SUPERVISOR');
    expect(new Set(names)).toEqual(new Set(['SALES_MANAGER', 'SALES_EMPLOYEE']));
  });

  it('listRoles projects parentRole and depth for the Access tree', async () => {
    await seedTree();
    const roles = await db.listRoles({ limit: 200 });
    const salesEmployee = roles.find((r) => r.name === 'SALES_EMPLOYEE');
    expect(salesEmployee.parentRole).toBe('SALES_MANAGER');
    expect(salesEmployee.depth).toBe(2);
    const supervisor = roles.find((r) => r.name === 'SUPERVISOR');
    expect(supervisor.parentRole ?? null).toBeNull();
    expect(supervisor.depth).toBe(0);
  });

  it('lets a SALES_MANAGER list only descendant users', async () => {
    await seedTree();
    const mgrId = await createUser('SALES_MANAGER');
    await createUser('SALES_EMPLOYEE');
    await createUser('SUPPORT_EMPLOYEE');
    const app = createApp();

    const res = await request(app)
      .get('/api/admin/users')
      .set('x-test-user', as(mgrId, 'SALES_MANAGER'));

    expect(res.status).toBe(200);
    const roles = res.body.users.map((u) => u.role);
    expect(roles).toContain('SALES_EMPLOYEE');
    expect(roles).not.toContain('SUPPORT_EMPLOYEE');
    expect(roles).not.toContain('SALES_MANAGER');
  });

  it('gives an ADMIN the unscoped list', async () => {
    await seedTree();
    const adminId = await createUser(SystemRoles.ADMIN);
    await db.grantCapability({
      principalType: PrincipalType.ROLE,
      principalId: SystemRoles.ADMIN,
      capability: 'access:admin',
    });
    await createUser('SALES_EMPLOYEE');
    await createUser('SUPPORT_EMPLOYEE');
    const app = createApp();

    const res = await request(app)
      .get('/api/admin/users')
      .set('x-test-user', as(adminId, SystemRoles.ADMIN));

    expect(res.status).toBe(200);
    const roles = res.body.users.map((u) => u.role);
    expect(roles).toEqual(expect.arrayContaining(['SALES_EMPLOYEE', 'SUPPORT_EMPLOYEE']));
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
    await seedTree();
    await db.createRoleByName({ name: 'SALES_EMPLOYEE_TIER_2', parentRole: 'SALES_MANAGER' });
    const mgrId = await createUser('SALES_MANAGER');
    const empId = await createUser('SALES_EMPLOYEE');
    const app = createApp();

    const res = await request(app)
      .patch(`/api/admin/users/${empId}/role`)
      .set('x-test-user', as(mgrId, 'SALES_MANAGER'))
      .send({ role: 'SALES_EMPLOYEE_TIER_2' });

    expect(res.status).toBe(200);
    const moved = await mongoose.models.User.findById(empId).lean();
    expect(moved.role).toBe('SALES_EMPLOYEE_TIER_2');
  });

  it('denies a SALES_MANAGER reassigning across branches', async () => {
    await seedTree();
    const mgrId = await createUser('SALES_MANAGER');
    const supportEmpId = await createUser('SUPPORT_EMPLOYEE');
    const app = createApp();

    const res = await request(app)
      .patch(`/api/admin/users/${supportEmpId}/role`)
      .set('x-test-user', as(mgrId, 'SALES_MANAGER'))
      .send({ role: 'SALES_EMPLOYEE' });

    expect(res.status).toBe(403);
  });

  it('denies a SALES_MANAGER promoting an employee up to its own tier', async () => {
    await seedTree();
    const mgrId = await createUser('SALES_MANAGER');
    const empId = await createUser('SALES_EMPLOYEE');
    const app = createApp();

    const res = await request(app)
      .patch(`/api/admin/users/${empId}/role`)
      .set('x-test-user', as(mgrId, 'SALES_MANAGER'))
      .send({ role: 'SALES_MANAGER' });

    expect(res.status).toBe(403);
  });

  it('GET /api/admin/hierarchy/me reflects each principal', async () => {
    await seedTree();
    const supervisorId = await createUser('SUPERVISOR');
    const userId = await createUser(SystemRoles.USER);
    const app = createApp();

    const supervisorRes = await request(app)
      .get('/api/admin/hierarchy/me')
      .set('x-test-user', as(supervisorId, 'SUPERVISOR'));
    expect(supervisorRes.status).toBe(200);
    expect(supervisorRes.body.canViewSubordinates).toBe(true);
    expect(new Set(supervisorRes.body.viewableRoleNames)).toEqual(
      new Set(['SALES_MANAGER', 'SALES_EMPLOYEE']),
    );

    const userRes = await request(app)
      .get('/api/admin/hierarchy/me')
      .set('x-test-user', as(userId, SystemRoles.USER));
    expect(userRes.body).toEqual({
      isAdmin: false,
      canViewSubordinates: false,
      viewableRoleNames: [],
      manageableRoleNames: [],
    });
  });
});
