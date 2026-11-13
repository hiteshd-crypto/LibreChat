import { resolveDisplayAction } from '../displayAction';

function entry(overrides: {
  action: string;
  metadata?: Record<string, string | number | boolean | null>;
  actorId?: string;
  targetId?: string;
}) {
  return {
    action: overrides.action,
    metadata: overrides.metadata,
    actor: { type: 'user', id: overrides.actorId, name: 'Actor' },
    target: { type: 'user', id: overrides.targetId, name: 'Target' },
  } as Parameters<typeof resolveDisplayAction>[0];
}

describe('resolveDisplayAction', () => {
  it('passes through non-token-grant actions unchanged', () => {
    expect(resolveDisplayAction(entry({ action: 'grant.assigned' }))).toBe('grant.assigned');
    expect(resolveDisplayAction(entry({ action: 'grant.removed' }))).toBe('grant.removed');
    expect(resolveDisplayAction(entry({ action: 'department.created' }))).toBe(
      'department.created',
    );
  });

  it('maps department_pool_grant and hierarchical_grant kinds to departmental_distribution', () => {
    expect(
      resolveDisplayAction(
        entry({ action: 'balance.token_grant', metadata: { kind: 'department_pool_grant' } }),
      ),
    ).toBe('balance.departmental_distribution');
    expect(
      resolveDisplayAction(
        entry({ action: 'balance.token_grant', metadata: { kind: 'hierarchical_grant' } }),
      ),
    ).toBe('balance.departmental_distribution');
  });

  it('maps department_disbursement and department_transfer kinds to internal_distribution', () => {
    expect(
      resolveDisplayAction(
        entry({ action: 'balance.token_grant', metadata: { kind: 'department_disbursement' } }),
      ),
    ).toBe('balance.internal_distribution');
    expect(
      resolveDisplayAction(
        entry({ action: 'balance.token_grant', metadata: { kind: 'department_transfer' } }),
      ),
    ).toBe('balance.internal_distribution');
  });

  it('maps self_grant kind to balance.self_grant', () => {
    expect(
      resolveDisplayAction(
        entry({ action: 'balance.token_grant', metadata: { kind: 'self_grant' } }),
      ),
    ).toBe('balance.self_grant');
  });

  it('falls back to an actor/target id comparison for legacy entries with no kind', () => {
    expect(
      resolveDisplayAction(entry({ action: 'balance.token_grant', actorId: 'u1', targetId: 'u1' })),
    ).toBe('balance.self_grant');
    expect(
      resolveDisplayAction(entry({ action: 'balance.token_grant', actorId: 'u1', targetId: 'u2' })),
    ).toBe('balance.departmental_distribution');
  });
});
