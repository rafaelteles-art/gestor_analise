import { describe, it, expect } from 'vitest';
import { diffProfiles } from './profile-diff';

describe('diffProfiles', () => {
  it('detecta rename pelo mesmo token', () => {
    const d = diffProfiles([{ name: 'P154', token: 'A' }], [{ name: 'P154 LABEL', token: 'A' }]);
    expect(d).toEqual({ renamed: [{ from: 'P154', to: 'P154 LABEL' }], changedToken: [], added: [] });
  });

  it('detecta rename com token novo quando o System User é o mesmo', () => {
    const identity = new Map([['A', 'su-1'], ['B', 'su-1']]);
    const d = diffProfiles([{ name: 'P154', token: 'A' }], [{ name: 'P154 LABEL', token: 'B' }], identity);
    expect(d.renamed).toEqual([{ from: 'P154', to: 'P154 LABEL' }]);
    expect(d.added).toEqual([]);
  });

  it('troca de token com mesmo nome não é rename', () => {
    const d = diffProfiles([{ name: 'P154', token: 'A' }], [{ name: 'P154', token: 'B' }]);
    expect(d).toEqual({ renamed: [], changedToken: ['P154'], added: [] });
  });

  it('perfil sem identidade em comum é novo; perfil intocado não aparece', () => {
    const d = diffProfiles(
      [{ name: 'p106', token: 'X' }],
      [{ name: 'p106', token: 'X' }, { name: 'P300', token: 'Z' }],
    );
    expect(d).toEqual({ renamed: [], changedToken: [], added: ['P300'] });
  });

  it('não reaproveita o mesmo perfil antigo em dois renames', () => {
    const d = diffProfiles(
      [{ name: 'P1', token: 'A' }],
      [{ name: 'P1a', token: 'A' }, { name: 'P1b', token: 'A' }],
    );
    expect(d.renamed).toEqual([{ from: 'P1', to: 'P1a' }]);
    expect(d.added).toEqual(['P1b']);
  });
});
