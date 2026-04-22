import { describe, it, expect } from 'vitest';
import { pickAdapter } from '../src/platform.js';

describe('pickAdapter', () => {
  const base44 = { platformName: 'Base44', matchHost: (h) => h.endsWith('base44.app') };
  const lovable = { platformName: 'Lovable', matchHost: (h) => h.endsWith('lovable.dev') };
  const bolt = { platformName: 'Bolt', matchHost: (h) => h.endsWith('bolt.new') };
  const adapters = [base44, lovable, bolt];

  it('picks the right adapter by hostname', () => {
    expect(pickAdapter(adapters, 'app.base44.app')?.platformName).toBe('Base44');
    expect(pickAdapter(adapters, 'lovable.dev')?.platformName).toBe('Lovable');
    expect(pickAdapter(adapters, 'bolt.new')?.platformName).toBe('Bolt');
  });

  it('returns null for unknown hosts', () => {
    expect(pickAdapter(adapters, 'github.com')).toBeNull();
  });

  it('tolerates adapters that throw', () => {
    const broken = {
      platformName: 'Broken',
      matchHost: () => {
        throw new Error('boom');
      },
    };
    expect(pickAdapter([broken, base44], 'app.base44.app')?.platformName).toBe('Base44');
  });
});
