import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchMetaMetrics } from '@/lib/meta';
import { fetchRedTrackMetrics } from '@/lib/redtrack';

export async function POST(request: Request) {
  try {
    // Para simplificar no protótipo, puxamos os dados de "ontem" ou podemos fixar uma data
    const today = new Date();
    today.setDate(today.getDate() - 1); // Yesterday
    const dateStr = today.toISOString().split('T')[0]; 

    // 1. Extrair os Dados (Em paralelo)
    console.log(`Buscando métricas da data: ${dateStr}`);
    
    // Consulta QUAIS contas do Meta Ads o usuário habilitou para sincronizar
    const { data: accounts } = await supabase
      .from('meta_ad_accounts')
      .select('account_id')
      .eq('is_selected', true);
      
    const selectedAccounts = accounts?.map(a => a.account_id.replace('act_', 'act_')) || [];
    
    // Dispara requests para o Meta (para cada conta selecionada) e para o RedTrack
    // Dispara requests para o Meta (para cada conta selecionada) e para o RedTrack
    const metaPromises = selectedAccounts.map(accId => fetchMetaMetrics(accId, dateStr, dateStr));
    
    const [metaDataArrays, redtrackData] = await Promise.all([
      Promise.all(metaPromises),
      fetchRedTrackMetrics(dateStr, dateStr, [])
    ]);
    
    // O Meta retorna um array por conta. Precisamos achatar todos numa lista só.
    const metaData = metaDataArrays.flat();

    // 2. Inserir (ou atualizar) Meta Ads no Supabase
    let metaCount = 0;
    if (metaData.length > 0) {
      const { error, count } = await supabase
        .from('meta_ads_metrics')
        .upsert(metaData, { onConflict: 'date,campaign_id' }); // Ignora duplicação se rodar 2x
        
      if (error) console.error("Erro ao salvar dados do Meta no Supabase:", error);
      metaCount = metaData.length;
    }

    // 3. Inserir (ou atualizar) RedTrack no Supabase
    let redtrackCount = 0;
    if (redtrackData.length > 0) {
      const { error } = await supabase
        .from('redtrack_metrics')
        .upsert(redtrackData, { onConflict: 'date,campaign_id' });
        
      if (error) console.error("Erro ao salvar dados do RedTrack no Supabase:", error);
      redtrackCount = redtrackData.length;
    }

    return NextResponse.json({
      success: true,
      message: `Sincronização Finalizada. ${metaCount} campanhas do Meta e ${redtrackCount} do RedTrack salvas.`,
      records: { metaData, redtrackData } // retornamos o payload para verificar
    });

  } catch (error: any) {
    console.error("Critical Sync Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
