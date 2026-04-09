import React from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  DollarSign, 
  ArrowUpRight, 
  ArrowDownRight,
  RefreshCw,
  Activity
} from 'lucide-react';

// Fake mock data for the prototype
const campaignData = [
  { id: 1, name: 'Q4 Retargeting - US', platform: 'Meta Ads', spend: 3240, cpa: 12.5, conv: 259, roas: 3.2, trend: 'up' },
  { id: 2, name: 'Lookalike 1% - EU', platform: 'Meta Ads', spend: 4100, cpa: 15.2, conv: 269, roas: 2.1, trend: 'down' },
  { id: 3, name: 'Cold Traffic Scaling', platform: 'RedTrack', spend: 8500, cpa: 22.1, conv: 384, roas: 1.8, trend: 'up' },
  { id: 4, name: 'Brand Awareness', platform: 'Meta Ads', spend: 1200, cpa: 5.4, conv: 222, roas: 4.5, trend: 'up' },
  { id: 5, name: 'Affiliate Push - Black Friday', platform: 'RedTrack', spend: 5400, cpa: 18.9, conv: 285, roas: 2.6, trend: 'down' },
];

const StatCard = ({ title, value, icon: Icon, trend, trendValue }: { title: string, value: string, icon: any, trend: 'up'|'down', trendValue: string }) => (
  <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-2xl p-6 hover:bg-gray-800/80 transition-all duration-300 shadow-xl shadow-black/20">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-gray-400 text-sm font-medium mb-1">{title}</p>
        <h3 className="text-3xl font-bold text-white tracking-tight">{value}</h3>
      </div>
      <div className="p-3 bg-indigo-500/10 rounded-xl">
        <Icon className="w-6 h-6 text-indigo-400" />
      </div>
    </div>
    <div className="mt-4 flex items-center gap-2">
      <span className={`flex items-center text-sm font-medium ${trend === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}>
        {trend === 'up' ? <ArrowUpRight className="w-4 h-4 mr-1" /> : <ArrowDownRight className="w-4 h-4 mr-1" />}
        {trendValue}
      </span>
      <span className="text-gray-500 text-sm">vs last week</span>
    </div>
  </div>
);

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-[#0A0A0B] text-gray-100 p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between mb-12 gap-4">
        <div>
          <h1 className="text-4xl font-extrabold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-tight">
            Ads & Analytics
          </h1>
          <p className="text-gray-400 mt-2">Unified dashboard for Meta Ads and RedTrack performance.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl text-sm font-medium text-gray-300 transition-colors">
            <RefreshCw className="w-4 h-4" />
            Sync Data
          </button>
          <button className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 rounded-xl text-sm font-medium text-white transition-all">
            <Activity className="w-4 h-4" />
            Generate Report
          </button>
        </div>
      </header>

      {/* Main Stats */}
      <main className="max-w-7xl mx-auto space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Ad Spend" value="$22,440" icon={DollarSign} trend="up" trendValue="12.5%" />
          <StatCard title="Total Conversions" value="1,419" icon={Users} trend="up" trendValue="8.2%" />
          <StatCard title="Average CPA" value="$15.81" icon={BarChart3} trend="down" trendValue="3.1%" />
          <StatCard title="Overall ROAS" value="2.8x" icon={TrendingUp} trend="up" trendValue="0.4x" />
        </div>

        {/* Campaigns Table */}
        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-800 rounded-3xl overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-gray-800 flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Active Campaigns Overview</h2>
            <div className="flex gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
                <Activity className="w-3.5 h-3.5" /> Meta
              </span>
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold">
                RedTrack
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-900/60 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 font-medium">Campaign Name</th>
                  <th className="px-6 py-4 font-medium">Platform</th>
                  <th className="px-6 py-4 font-medium">Spend</th>
                  <th className="px-6 py-4 font-medium">CPA</th>
                  <th className="px-6 py-4 font-medium">Conversions</th>
                  <th className="px-6 py-4 font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {campaignData.map((camp) => (
                  <tr key={camp.id} className="hover:bg-gray-800/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-200 group-hover:text-indigo-300 transition-colors">{camp.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                        camp.platform === 'Meta Ads' 
                          ? 'bg-blue-500/10 text-blue-400' 
                          : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {camp.platform}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-300">${camp.spend.toLocaleString()}</td>
                    <td className="px-6 py-4 text-gray-300">${camp.cpa}</td>
                    <td className="px-6 py-4 text-gray-300">{camp.conv}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-200">{camp.roas}x</span>
                        {camp.trend === 'up' ? (
                          <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-rose-400" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
