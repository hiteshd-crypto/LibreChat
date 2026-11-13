import { resolveDisplayMetadata } from './auditDisplay';

describe('resolveDisplayMetadata', () => {
  it('returns undefined metadata unchanged', () => {
    expect(resolveDisplayMetadata('balance.token_grant', undefined)).toBeUndefined();
  });

  it('leaves non-balance action metadata untouched', () => {
    const metadata = { capability: 'manage:department' };
    expect(resolveDisplayMetadata('grant.assigned', metadata)).toEqual(metadata);
    expect(resolveDisplayMetadata('department.created', metadata)).toEqual(metadata);
  });

  it('money-formats amount for a department pool grant', () => {
    const result = resolveDisplayMetadata(
      'balance.departmental_distribution',
      { kind: 'department_pool_grant', amount: 1_000_000 },
      'en-IN',
    );
    expect(result).toEqual({ kind: 'department_pool_grant', amount: '₹100.00' });
  });

  it('money-formats totalAmount and perRecipientAmount for a disbursement, leaving recipients untouched', () => {
    const result = resolveDisplayMetadata(
      'balance.internal_distribution',
      {
        kind: 'department_disbursement',
        recipientCount: 2,
        totalAmount: 20_000,
        perRecipientAmount: 10_000,
        recipients: 'u1,u2',
      },
      'en-IN',
    );
    expect(result).toEqual({
      kind: 'department_disbursement',
      recipientCount: 2,
      totalAmount: '₹2.00',
      perRecipientAmount: '₹1.00',
      recipients: 'u1,u2',
    });
  });

  it('money-formats amount for a department transfer, leaving userIds untouched', () => {
    const result = resolveDisplayMetadata(
      'balance.internal_distribution',
      { kind: 'department_transfer', fromUserId: 'u1', toUserId: 'u2', amount: 10_000 },
      'en-IN',
    );
    expect(result).toEqual({
      kind: 'department_transfer',
      fromUserId: 'u1',
      toUserId: 'u2',
      amount: '₹1.00',
    });
  });

  it('money-formats totalAmount and perParticipantAmount for a hierarchical/self grant', () => {
    const result = resolveDisplayMetadata(
      'balance.self_grant',
      {
        kind: 'self_grant',
        recipientCount: 1,
        totalAmount: 30_000,
        perParticipantAmount: 15_000,
        recipients: 'u1',
      },
      'en-IN',
    );
    expect(result).toEqual({
      kind: 'self_grant',
      recipientCount: 1,
      totalAmount: '₹3.00',
      perParticipantAmount: '₹1.50',
      recipients: 'u1',
    });
  });

  it('renames and money-formats balance.edited fields, keeping mode as-is', () => {
    const result = resolveDisplayMetadata(
      'balance.edited',
      { previousTokenCredits: 5000, newTokenCredits: 10_000, mode: 'cas' },
      'en-IN',
    );
    expect(result).toEqual({
      mode: 'cas',
      previousBalance: '₹0.50',
      newBalance: '₹1.00',
    });
  });
});
