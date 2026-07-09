export type RtSyncCampaign = { campaign_id: string; campaign_name: string };
export type RtSyncTask = { camp: RtSyncCampaign; day: string };

// Lista determinística de pares (campanha, dia): campanhas na ordem recebida
// (query ordena por nome), dias em ordem cronológica. O sync em fatias
// (startTask) indexa esta sequência — a mesma entrada tem que produzir a mesma
// lista entre uma fatia e a próxima.
export function buildRtSyncTasks(campaigns: RtSyncCampaign[], days: string[]): RtSyncTask[] {
  const tasks: RtSyncTask[] = [];
  for (const camp of campaigns) {
    for (const day of days) {
      tasks.push({ camp, day });
    }
  }
  return tasks;
}
