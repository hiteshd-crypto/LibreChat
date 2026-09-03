import * as endpoints from './api-endpoints';

/** BASE_URL is '' in the node/jest context, so paths carry no host prefix. */
describe('admin endpoint builders', () => {
  it('builds role paths with encoding', () => {
    expect(endpoints.adminRole('ADMIN')).toBe('/api/admin/roles/ADMIN');
    expect(endpoints.adminRoleMembers('A B')).toBe('/api/admin/roles/A%20B/members');
    expect(endpoints.adminRoleMembers('ADMIN', { limit: 20, offset: 40 })).toBe(
      '/api/admin/roles/ADMIN/members?limit=20&offset=40',
    );
    expect(endpoints.adminRoleMember('ADMIN', '64f/1')).toBe(
      '/api/admin/roles/ADMIN/members/64f%2F1',
    );
  });

  it('builds admin user paths', () => {
    expect(endpoints.adminUsers()).toBe('/api/admin/users');
    expect(endpoints.adminUsers({ limit: 25 })).toBe('/api/admin/users?limit=25');
    expect(endpoints.adminUsers({ limit: 25, offset: 50 })).toBe(
      '/api/admin/users?limit=25&offset=50',
    );
    expect(endpoints.adminUserSearch('ab', 10)).toBe('/api/admin/users/search?q=ab&limit=10');
  });

  it('builds admin user conversation paths', () => {
    expect(endpoints.adminUserConversations('u1')).toBe('/api/admin/users/u1/conversations');
    expect(endpoints.adminUserConversations('u1', { cursor: 'c', limit: 25 })).toBe(
      '/api/admin/users/u1/conversations?cursor=c&limit=25',
    );
    expect(endpoints.adminUserConversation('u1', 'c9')).toBe(
      '/api/admin/users/u1/conversations/c9',
    );
    expect(endpoints.adminUserConversationMessages('u1', 'c9')).toBe(
      '/api/admin/users/u1/conversations/c9/messages',
    );
  });
});
