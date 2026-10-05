import { describe, it, expect } from 'vitest';
import { transferBankDetails } from '../src/services/billing-bank.service.ts';
const valid = { bank: ' Bank ', holder: ' Owner ', identification: '001', accountType: 'Savings', accountNumber: '000123', instructions: ' Details ' };
describe('transfer destination validation', () => {
  it('keeps account numbers as strings and trims text without storing arbitrary fields', () => {
    expect(transferBankDetails({ ...valid, id: '1', active: true, password: 'never-store' })).toEqual({ bank: 'Bank', holder: 'Owner', identification: '001', accountType: 'Savings', accountNumber: '000123', instructions: 'Details' });
  });
  it.each(['bank', 'holder', 'identification', 'accountType', 'accountNumber'])('requires %s', field => {
    expect(() => transferBankDetails({ ...valid, [field]: ' ' })).toThrow();
    expect(() => transferBankDetails({ ...valid, [field]: 123 })).toThrow();
  });
  it('allows no instructions and rejects excessive text', () => {
    expect(transferBankDetails({ ...valid, instructions: undefined }).instructions).toBe('');
    expect(() => transferBankDetails({ ...valid, accountNumber: '0'.repeat(81) })).toThrow();
  });
});
