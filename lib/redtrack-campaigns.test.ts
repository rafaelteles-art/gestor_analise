import { describe, it, expect } from 'vitest';
import { mapRedTrackCampaigns } from './redtrack-campaigns';

describe('mapRedTrackCampaigns', () => {
  it('mapeia campos com fallbacks de title e status', () => {
    const rows = mapRedTrackCampaigns([
      { id: 1, title: 'Campanha A', status: 'active' },
      { id: 2 },
    ]);
    expect(rows).toEqual([
      { campaign_id: '1', campaign_name: 'Campanha A', status: 'active', is_selected: false },
      { campaign_id: '2', campaign_name: 'Campaign 2', status: 'unknown', is_selected: false },
    ]);
  });

  it('deduplica por campaign_id (última ocorrência vence) — o batch upsert não aceita a mesma chave 2x no mesmo INSERT', () => {
    const rows = mapRedTrackCampaigns([
      { id: '10', title: 'Antiga', status: 'paused' },
      { id: 10, title: 'Nova', status: 'active' },
    ]);
    expect(rows).toEqual([
      { campaign_id: '10', campaign_name: 'Nova', status: 'active', is_selected: false },
    ]);
  });

  it('lista vazia retorna vazio', () => {
    expect(mapRedTrackCampaigns([])).toEqual([]);
  });
});
