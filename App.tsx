
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Truck, Droplets, History, PlusCircle, 
  BarChart3, AlertTriangle, Zap, TrendingUp, Box, 
  CheckCircle2, Trash2, X, Settings2, ArrowDownCircle, ArrowUpCircle,
  Download, Save, Upload, ShieldCheck, RefreshCcw, Database, FileSpreadsheet, User,
  Lock, LogOut, ShieldAlert, Key, Pencil, Cloud, CloudUpload, CloudDownload, Settings, Copy, Info, Share2, AlertCircle, UserPlus, Eye, EyeOff, Gauge
} from 'lucide-react';
import { 
  TipoVeiculo, MedidaUso, TipoMovimento, VeiculoEquipamento, 
  MovimentoTanque, Tanque, AppUser 
} from './types';
import { db } from './db';
import { cloudService } from './services/cloudService';

const CAPACITY_BRITAGEM = 11000;
const CAPACITY_OBRA = 3000;
const CLOUD_KEY_STORAGE = 'fueltrack_cloud_master_key';
const CLOUD_BIN_STORAGE = 'fueltrack_cloud_bin_id';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'fleet' | 'movements' | 'tank' | 'reports' | 'users'>('dashboard');
  const [isDbReady, setIsDbReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [showCloudSettings, setShowCloudSettings] = useState(false);
  const [masterKey, setMasterKey] = useState(localStorage.getItem(CLOUD_KEY_STORAGE) || import.meta.env.VITE_JSONBIN_MASTER_KEY || '');
  const [binId, setBinId] = useState(localStorage.getItem(CLOUD_BIN_STORAGE) || import.meta.env.VITE_JSONBIN_BIN_ID || '');
  const [lastSync, setLastSync] = useState<string | null>(localStorage.getItem('fueltrack_last_sync_ts'));
  const [isAutoSync, setIsAutoSync] = useState(localStorage.getItem('fueltrack_auto_sync') !== 'false');
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [vehicles, setVehicles] = useState<VeiculoEquipamento[]>([]);
  const [movements, setMovements] = useState<MovimentoTanque[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [tanks, setTanks] = useState<Tanque[]>([
    { id: 'britagem', nome: 'Tanque Britagem', capacidade_litros: CAPACITY_BRITAGEM, saldo_atual: 0 },
    { id: 'obra', nome: 'Tanque Obra', capacidade_litros: CAPACITY_OBRA, saldo_atual: 0 }
  ]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await db.init();
        await refreshData();
        setIsDbReady(true);
      } catch (err) {
        console.error("Erro ao iniciar DB:", err);
      }
      const savedUser = sessionStorage.getItem('fueltrack_session');
      if (savedUser) setCurrentUser(JSON.parse(savedUser));
    };
    init();
  }, []);

  const refreshData = async () => {
    const v = await db.getAll<VeiculoEquipamento>('veiculos');
    const m = await db.getAll<MovimentoTanque>('movements');
    const u = await db.getAll<AppUser>('users');
    const sortedMovements = [...m].sort((a, b) => new Date(b.data_hora).getTime() - new Date(a.data_hora).getTime());
    
    // Garantir que a leitura atual dos veículos reflita o último movimento
    const updatedVehicles = v.map(vehicle => {
      const vehicleMovements = sortedMovements.filter(mov => mov.veiculo_id === vehicle.id && mov.tipo_movimento === TipoMovimento.CONSUMO);
      if (vehicleMovements.length > 0) {
        const lastMov = vehicleMovements[0];
        return {
          ...vehicle,
          odometro_atual: lastMov.km_informado ?? vehicle.odometro_atual,
          horimetro_atual: lastMov.horimetro_informado ?? vehicle.horimetro_atual
        };
      }
      return {
        ...vehicle,
        odometro_atual: vehicle.odometro_inicial ?? vehicle.odometro_atual,
        horimetro_atual: vehicle.horimetro_inicial ?? vehicle.horimetro_atual
      };
    });

    const balanceBritagem = m.filter(mov => 
      mov.tanque_id === 'britagem' || 
      (!mov.tanque_id && mov.tipo_movimento === TipoMovimento.ENTRADA_BRITAGEM)
    ).reduce((acc, curr) => acc + curr.litros, 0);

    const balanceObra = m.filter(mov => 
      mov.tanque_id === 'obra' || 
      (!mov.tanque_id && mov.tipo_movimento === TipoMovimento.ENTRADA_OBRA)
    ).reduce((acc, curr) => acc + curr.litros, 0);
    
    setVehicles(updatedVehicles);
    setUsers(u);
    setMovements(sortedMovements);
    
    const updatedTanks: Tanque[] = [
      { id: 'britagem', nome: 'Tanque Britagem', capacidade_litros: CAPACITY_BRITAGEM, saldo_atual: balanceBritagem },
      { id: 'obra', nome: 'Tanque Obra', capacidade_litros: CAPACITY_OBRA, saldo_atual: balanceObra }
    ];
    setTanks(updatedTanks);
    await db.put('tanque', updatedTanks);
  };

  const triggerAutoSync = async () => {
    if (!isAutoSync || !masterKey.trim() || !binId.trim()) return;
    try {
      const data = await db.exportAllData();
      await cloudService.sync(data, masterKey.trim(), binId.trim());
      const now = new Date().toLocaleString();
      setLastSync(now);
      localStorage.setItem('fueltrack_last_sync_ts', now);
    } catch (e) {
      console.warn("Auto-sync background failed:", e);
    }
  };

  const handleCloudSync = async (mode: 'upload' | 'download') => {
    if (!masterKey.trim()) {
      setShowCloudSettings(true);
      return;
    }
    setIsCloudSyncing(true);
    try {
      if (mode === 'upload') {
        const data = await db.exportAllData();
        const newBinId = await cloudService.sync(data, masterKey.trim(), binId?.trim() || undefined);
        setBinId(newBinId);
        localStorage.setItem(CLOUD_BIN_STORAGE, newBinId);
        const now = new Date().toLocaleString();
        setLastSync(now);
        localStorage.setItem('fueltrack_last_sync_ts', now);
        alert("Sincronização realizada!");
      } else {
        if (!binId) return alert("Nenhum Código de Frota registrado.");
        const content = await cloudService.download(masterKey.trim(), binId.trim());
        if (confirm("Deseja substituir os dados locais?")) {
          await db.importAllData(content);
          await refreshData();
          setLastSync(new Date().toLocaleString());
          alert("Dados baixados!");
        }
      }
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    } finally {
      setIsCloudSyncing(false);
    }
  };

  if (!isDbReady) return <LoadingScreen />;
  if (!currentUser) return <LoginView onLogin={(u: AppUser) => { setCurrentUser(u); sessionStorage.setItem('fueltrack_session', JSON.stringify(u)); }} users={users} />;

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#F8FAFC] text-[#1E293B]">
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-100"><Droplets size={20} className="text-white" /></div>
          <h1 className="text-lg font-bold">FuelTrack</h1>
        </div>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          {isSidebarOpen ? <X size={24} /> : <Settings2 size={24} />}
        </button>
      </div>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      <nav className={`
        fixed md:sticky top-0 left-0 h-screen w-72 bg-white border-r border-slate-200 p-6 flex flex-col z-50 transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="hidden md:flex items-center gap-3 mb-8">
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-lg shadow-blue-100"><Droplets size={24} className="text-white" /></div>
          <div><h1 className="text-xl font-bold leading-tight">FuelTrack</h1><span className="text-[10px] font-bold text-blue-600 tracking-widest uppercase">Gestão Inteligente</span></div>
        </div>

        <div className="mb-6 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100">
           <div className="flex items-center justify-between mb-3">
             <div className="flex items-center gap-2 text-indigo-600">
               <Cloud size={16} />
               <span className="text-[10px] font-black uppercase tracking-widest">Nuvem Direta</span>
               {masterKey && binId ? (
                 <span className="flex h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
               ) : (
                 <span className="flex h-1.5 w-1.5 rounded-full bg-slate-300"></span>
               )}
             </div>
             <button onClick={() => setShowCloudSettings(true)} className="p-1 text-indigo-400 hover:text-indigo-600"><Settings size={14} /></button>
           </div>
           
           <div className="mt-3 pt-3 border-t border-indigo-100/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database size={12} className="text-blue-500" />
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-tighter">Servidor Central</span>
              </div>
              <span className="flex h-1.5 w-1.5 rounded-full bg-green-500"></span>
           </div>
           <div className="grid grid-cols-2 gap-2 mt-3">
             <button onClick={() => handleCloudSync('download')} disabled={isCloudSyncing} className="flex items-center justify-center gap-2 bg-white border border-indigo-200 p-2 rounded-lg text-[9px] font-black text-indigo-600 hover:bg-indigo-100 uppercase transition-all disabled:opacity-50">
               {isCloudSyncing ? <RefreshCcw size={12} className="animate-spin" /> : <CloudDownload size={12} />} Baixar
             </button>
             <button onClick={() => handleCloudSync('upload')} disabled={isCloudSyncing} className="flex items-center justify-center gap-2 bg-indigo-600 p-2 rounded-lg text-[9px] font-black text-white hover:bg-indigo-700 uppercase transition-all shadow-sm disabled:opacity-50">
               {isCloudSyncing ? <RefreshCcw size={12} className="animate-spin" /> : <CloudUpload size={12} />} Enviar
             </button>
           </div>
           {lastSync && <p className="mt-2 text-[8px] text-slate-400 font-bold uppercase text-center">Última Sinc: {lastSync}</p>}
        </div>

        <ul className="space-y-1 flex-1">
          <SidebarItem icon={<LayoutDashboard size={18} />} label="Painel" active={activeTab === 'dashboard'} onClick={() => { setActiveTab('dashboard'); setIsSidebarOpen(false); }} />
          <SidebarItem icon={<Truck size={18} />} label="Frota e Ativos" active={activeTab === 'fleet'} onClick={() => { setActiveTab('fleet'); setIsSidebarOpen(false); }} />
          <SidebarItem icon={<History size={18} />} label="Movimentação" active={activeTab === 'movements'} onClick={() => { setActiveTab('movements'); setIsSidebarOpen(false); }} />
          <SidebarItem icon={<BarChart3 size={18} />} label="Relatórios" active={activeTab === 'reports'} onClick={() => { setActiveTab('reports'); setIsSidebarOpen(false); }} />
          <SidebarItem icon={<Box size={18} />} label="Estoque Tanque" active={activeTab === 'tank'} onClick={() => { setActiveTab('tank'); setIsSidebarOpen(false); }} />
          {currentUser.role === 'admin' && <SidebarItem icon={<ShieldAlert size={18} />} label="Usuários" active={activeTab === 'users'} onClick={() => { setActiveTab('users'); setIsSidebarOpen(false); }} />}
        </ul>
        
        <div className="mt-4 pt-6 border-t border-slate-100 flex items-center justify-between">
           <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">{currentUser.name.charAt(0)}</div>
              <div className="max-w-[120px] overflow-hidden">
                <p className="text-[10px] font-black uppercase text-slate-900 truncate">{currentUser.name}</p>
                <p className="text-[8px] font-bold text-slate-400 uppercase">{currentUser.role}</p>
              </div>
           </div>
           <button onClick={() => { sessionStorage.removeItem('fueltrack_session'); window.location.reload(); }} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><LogOut size={18} /></button>
        </div>
      </nav>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        {activeTab === 'dashboard' && <DashboardView tanks={tanks} movements={movements} vehicles={vehicles} />}
        {activeTab === 'fleet' && <FleetView vehicles={vehicles} users={users} currentUser={currentUser} onAdd={async (v:any) => { await db.put('veiculos', {...v, id: v.id || Math.random().toString(36).substr(2,9), usuario_id: currentUser.id}); await refreshData(); triggerAutoSync(); }} onEdit={async (v:any) => { await db.put('veiculos', v); await refreshData(); triggerAutoSync(); }} onDelete={async (id:string, skipConfirm: boolean = false) => { if(skipConfirm || confirm('Deseja excluir este ativo permanentemente?')){ try { await db.delete('veiculos', id); await refreshData(); triggerAutoSync(); } catch(e) { alert("Erro ao excluir ativo."); } } }} />}
        {activeTab === 'movements' && <MovementsView movements={movements} vehicles={vehicles} users={users} currentUser={currentUser} addMovement={async (m:any) => {
          const v = vehicles.find(vi => vi.id === m.veiculo_id);
          await db.put('movements', {...m, id: m.id || Math.random().toString(36).substr(2,9), usuario_id: currentUser.id});
          if(v && m.tipo_movimento === TipoMovimento.CONSUMO) await db.put('veiculos', {...v, odometro_atual: m.km_informado ?? v.odometro_atual, horimetro_atual: m.horimetro_informado ?? v.horimetro_atual});
          await refreshData();
          triggerAutoSync();
        }} deleteMovement={async (id: string, skipConfirm: boolean = false) => { 
          if(skipConfirm || confirm('Deseja excluir este lançamento permanentemente?')){ 
            try {
              await db.delete('movements', id); 
              await refreshData(); 
              triggerAutoSync();
            } catch (e) {
              alert("Erro ao excluir registro.");
            }
          } 
        }} editMovement={async (m: any) => { 
          try {
            await db.put('movements', m); 
            await refreshData(); 
            triggerAutoSync();
          } catch (e) {
            alert("Erro ao salvar alterações.");
          }
        }} />}
        {activeTab === 'reports' && <ReportsView movements={movements} vehicles={vehicles} users={users} />}
        {activeTab === 'tank' && <TankView tanks={tanks} movements={movements} onSync={refreshData} />}
        {activeTab === 'users' && currentUser.role === 'admin' && <UserManagementView users={users} onRefresh={async () => { await refreshData(); triggerAutoSync(); }} />}
      </main>

      {/* Cloud Settings Modal */}
      {showCloudSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[40px] p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black">Configuração Cloud</h3>
              <button onClick={() => setShowCloudSettings(false)} className="p-2 hover:bg-slate-100 rounded-full"><X size={24} /></button>
            </div>
            <div className="space-y-4">
              <p className="text-[10px] text-slate-400 font-bold uppercase leading-relaxed">
                As chaves são salvas localmente no seu navegador. Você também pode configurá-las via variáveis de ambiente (VITE_JSONBIN_MASTER_KEY).
              </p>
              <input type="password" placeholder="JSONBin Master Key" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={masterKey} onChange={e => setMasterKey(e.target.value)} />
              <input placeholder="Bin ID" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={binId} onChange={e => setBinId(e.target.value)} />
              
              <div className="flex items-center justify-between p-4 bg-blue-50 rounded-2xl border border-blue-100">
                <div className="flex items-center gap-3">
                  <RefreshCcw size={20} className={`text-blue-600 ${isAutoSync ? 'animate-spin-slow' : ''}`} />
                  <div>
                    <p className="text-xs font-black uppercase text-blue-900">Sincronização Automática</p>
                    <p className="text-[9px] font-bold text-blue-600 uppercase">Salvar na nuvem após cada alteração</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsAutoSync(!isAutoSync)}
                  className={`w-12 h-6 rounded-full transition-colors relative ${isAutoSync ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isAutoSync ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <button onClick={() => { 
                localStorage.setItem(CLOUD_KEY_STORAGE, masterKey); 
                localStorage.setItem(CLOUD_BIN_STORAGE, binId); 
                localStorage.setItem('fueltrack_auto_sync', String(isAutoSync));
                setShowCloudSettings(false); 
                alert('Configurações salvas!'); 
              }} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Added SidebarItem component to fix "Cannot find name 'SidebarItem'" errors.
function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all ${
          active 
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' 
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <span className={active ? 'text-white' : 'text-slate-400'}>{icon}</span>
        <span className="uppercase tracking-wide text-[11px] font-black">{label}</span>
      </button>
    </li>
  );
}

function LoadingScreen() {
  return <div className="h-screen w-full flex items-center justify-center bg-slate-50"><div className="flex flex-col items-center gap-4"><Database size={40} className="text-blue-600 animate-bounce" /><p className="font-black text-slate-400 uppercase text-[10px] tracking-widest">Iniciando FuelTrack...</p></div></div>;
}

function LoginView({ onLogin, users }: any) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-[40px] p-10 shadow-2xl text-center">
        <div className="bg-blue-600 w-16 h-16 rounded-[22px] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200"><Droplets className="text-white" size={32} /></div>
        <h2 className="text-3xl font-black mb-10">FuelTrack Pro</h2>
        <form onSubmit={e => { e.preventDefault(); const user = users.find((u:any) => u.login.toUpperCase() === login.toUpperCase() && u.password === password); user ? onLogin(user) : alert('Erro'); }} className="space-y-4 text-left">
          <input required placeholder="Login" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none" value={login} onChange={e => setLogin(e.target.value)} />
          <input required type="password" placeholder="Senha" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl">Entrar</button>
        </form>
      </div>
    </div>
  );
}

function FleetView({ vehicles, users, onAdd, onEdit, onDelete, currentUser }: any) {
  const [showForm, setShowForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<any>(null);
  const [form, setForm] = useState({ tipo: TipoVeiculo.VEICULO, placa_ou_prefixo: '', modelo: '', usa_medida: MedidaUso.KM, odometro_atual: 0, horimetro_atual: 0 });
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div><h2 className="text-2xl md:text-3xl font-black tracking-tight">Ativos Operacionais</h2></div>
        <button onClick={() => setShowForm(true)} className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg"><PlusCircle size={18} /> Novo Ativo</button>
      </div>
      
      {/* Table for Desktop, Cards for Mobile */}
      <div className="hidden md:block bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Ativo / Responsável</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Leitura Inicial</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Leitura Atual</th>
              <th className="px-8 py-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.map((v: any) => {
              const u = users.find((ui:any) => ui.id === v.usuario_id);
              return (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-8 py-6"><div className="font-black uppercase text-slate-900">{v.placa_ou_prefixo}</div><div className="text-[10px] text-slate-400 font-bold uppercase">{v.modelo}</div><div className="text-[8px] font-black text-blue-500 uppercase mt-1">Por: {u?.name || 'N/A'}</div></td>
                  <td className="px-8 py-6 text-center font-bold text-slate-400">{v.usa_medida === MedidaUso.KM ? `${(v.odometro_inicial ?? v.odometro_atual ?? 0).toLocaleString()} KM` : `${(v.horimetro_inicial ?? v.horimetro_atual ?? 0).toLocaleString()} H`}</td>
                  <td className="px-8 py-6 text-center font-bold text-slate-700">{v.usa_medida === MedidaUso.KM ? `${v.odometro_atual.toLocaleString()} KM` : `${v.horimetro_atual.toLocaleString()} H`}</td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setEditingVehicle(v)} className="p-2 text-slate-300 hover:text-blue-500 transition-colors" title="Editar">
                        <Pencil size={18} />
                      </button>
                      {currentUser.role === 'admin' && (
                        <button onClick={() => onDelete(v.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors" title="Excluir">
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-4">
        {vehicles.map((v: any) => {
          const u = users.find((ui:any) => ui.id === v.usuario_id);
          return (
            <div key={v.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-black uppercase text-slate-900 text-lg">{v.placa_ou_prefixo}</div>
                  <div className="text-xs text-slate-400 font-bold uppercase">{v.modelo}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingVehicle(v)} className="p-2 bg-slate-50 text-slate-400 rounded-xl"><Pencil size={18} /></button>
                  {currentUser.role === 'admin' && (
                    <button onClick={() => onDelete(v.id)} className="p-2 bg-red-50 text-red-400 rounded-xl"><Trash2 size={18} /></button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50">
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Inicial</div>
                  <div className="font-bold text-slate-600">{v.usa_medida === MedidaUso.KM ? `${(v.odometro_inicial ?? v.odometro_atual ?? 0).toLocaleString()} KM` : `${(v.horimetro_inicial ?? v.horimetro_atual ?? 0).toLocaleString()} H`}</div>
                </div>
                <div>
                  <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Atual</div>
                  <div className="font-bold text-blue-600">{v.usa_medida === MedidaUso.KM ? `${v.odometro_atual.toLocaleString()} KM` : `${v.horimetro_atual.toLocaleString()} H`}</div>
                </div>
              </div>
              <div className="text-[10px] font-black text-slate-300 uppercase">Responsável: {u?.name || 'N/A'}</div>
            </div>
          );
        })}
      </div>
      
      {/* New Asset Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-black">Cadastrar Ativo</h3><button onClick={() => setShowForm(false)}><X size={20} /></button></div>
            <form onSubmit={e => { 
              e.preventDefault(); 
              const finalForm = {
                ...form,
                odometro_inicial: form.odometro_atual,
                horimetro_inicial: form.horimetro_atual
              };
              onAdd(finalForm); 
              setShowForm(false); 
            }} className="space-y-4">
              <select className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value as any, usa_medida: e.target.value === TipoVeiculo.VEICULO ? MedidaUso.KM : MedidaUso.HORIMETRO})}>
                <option value={TipoVeiculo.VEICULO}>Veículo (KM)</option>
                <option value={TipoVeiculo.EQUIPAMENTO}>Máquina (Hora)</option>
              </select>
              <input required placeholder="Placa / Prefixo" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold uppercase" value={form.placa_ou_prefixo} onChange={e => setForm({...form, placa_ou_prefixo: e.target.value.toUpperCase()})} />
              <input required placeholder="Modelo" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.modelo} onChange={e => setForm({...form, modelo: e.target.value})} />
              <input type="number" step="0.01" required placeholder="Leitura Inicial" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.usa_medida === MedidaUso.KM ? form.odometro_atual : form.horimetro_atual} onChange={e => setForm({...form, odometro_atual: form.usa_medida === MedidaUso.KM ? parseFloat(e.target.value) : 0, horimetro_atual: form.usa_medida === MedidaUso.HORIMETRO ? parseFloat(e.target.value) : 0})} />
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs">Salvar Ativo</button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Asset Modal */}
      {editingVehicle && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black">Editar Ativo</h3>
              <button onClick={() => setEditingVehicle(null)}><X size={20} /></button>
            </div>
            <form onSubmit={e => { 
              e.preventDefault(); 
              onEdit(editingVehicle); 
              setEditingVehicle(null); 
            }} className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Placa / Prefixo</label>
                <input 
                  required 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold uppercase" 
                  value={editingVehicle.placa_ou_prefixo} 
                  onChange={e => setEditingVehicle({...editingVehicle, placa_ou_prefixo: e.target.value.toUpperCase()})} 
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Modelo</label>
                <input 
                  required 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" 
                  value={editingVehicle.modelo} 
                  onChange={e => setEditingVehicle({...editingVehicle, modelo: e.target.value})} 
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Leitura Inicial</label>
                <input 
                  type="number" 
                  step="0.01" 
                  required 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" 
                  value={editingVehicle.usa_medida === MedidaUso.KM ? (editingVehicle.odometro_inicial ?? 0) : (editingVehicle.horimetro_inicial ?? 0)} 
                  onChange={e => setEditingVehicle({
                    ...editingVehicle, 
                    odometro_inicial: editingVehicle.usa_medida === MedidaUso.KM ? parseFloat(e.target.value) : editingVehicle.odometro_inicial,
                    horimetro_inicial: editingVehicle.usa_medida === MedidaUso.HORIMETRO ? parseFloat(e.target.value) : editingVehicle.horimetro_inicial
                  })} 
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Leitura Atual</label>
                <input 
                  type="number" 
                  step="0.01" 
                  required 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" 
                  value={editingVehicle.usa_medida === MedidaUso.KM ? (editingVehicle.odometro_atual ?? 0) : (editingVehicle.horimetro_atual ?? 0)} 
                  onChange={e => setEditingVehicle({
                    ...editingVehicle, 
                    odometro_atual: editingVehicle.usa_medida === MedidaUso.KM ? parseFloat(e.target.value) : editingVehicle.odometro_atual,
                    horimetro_atual: editingVehicle.usa_medida === MedidaUso.HORIMETRO ? parseFloat(e.target.value) : editingVehicle.horimetro_atual
                  })} 
                />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs shadow-lg mt-4">
                Salvar Alterações
              </button>

              {currentUser.role === 'admin' && (
                <div className="pt-4 border-t border-slate-100 mt-4">
                  <button 
                    type="button" 
                    onClick={() => {
                      onDelete(editingVehicle.id, true);
                      setEditingVehicle(null);
                    }} 
                    className="w-full bg-red-50 text-red-600 py-3 rounded-2xl font-black uppercase text-[10px] hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                  >
                    <Trash2 size={14} /> Excluir Ativo
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MovementsView({ movements, vehicles, users, addMovement, deleteMovement, editMovement, currentUser }: any) {
  const [form, setForm] = useState({ tipo: TipoMovimento.CONSUMO, veiculoId: '', motorista: '', litros: '', leitura: '', tanqueId: 'britagem' as 'britagem' | 'obra' });
  const [editingMovement, setEditingMovement] = useState<any>(null);
  const isSaida = form.tipo === TipoMovimento.CONSUMO;

  // Função para calcular performance
  const getPerformanceData = (currentMov: any) => {
    if (currentMov.tipo_movimento !== TipoMovimento.CONSUMO) return { perf: null, prev: null };
    
    const vehicle = vehicles.find((v:any) => v.id === currentMov.veiculo_id);
    if (!vehicle) return { perf: null, prev: null };

    const vMovements = movements
      .filter((m: any) => m.veiculo_id === currentMov.veiculo_id && new Date(m.data_hora) < new Date(currentMov.data_hora))
      .sort((a: any, b: any) => new Date(b.data_hora).getTime() - new Date(a.data_hora).getTime());
    
    let prevReading = 0;
    if (vMovements.length === 0) {
      prevReading = vehicle.usa_medida === MedidaUso.KM ? (vehicle.odometro_inicial ?? vehicle.odometro_atual ?? 0) : (vehicle.horimetro_inicial ?? vehicle.horimetro_atual ?? 0);
    } else {
      prevReading = vMovements[0].km_informado || vMovements[0].horimetro_informado || 0;
    }
    
    const currReading = currentMov.km_informado || currentMov.horimetro_informado || 0;
    const diff = currReading - prevReading;
    const litrosAbs = Math.abs(currentMov.litros);

    let perfStr = "N/A";
    if (diff > 0) {
      if (vehicle.usa_medida === MedidaUso.KM) {
        perfStr = `${(diff / litrosAbs).toFixed(2)} KM/L`;
      } else {
        perfStr = `${(litrosAbs / (diff || 1)).toFixed(2)} L/H`;
      }
    } else if (diff < 0) {
      perfStr = "Erro Leitura";
    }

    return { perf: perfStr, prev: prevReading };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
      <div className="lg:col-span-4"><div className="bg-white rounded-[32px] border border-slate-200 p-8 shadow-sm sticky top-8">
        <h3 className="text-xl font-black mb-6">Registrar Movimento</h3>
        <form onSubmit={e => { 
          e.preventDefault(); 
          addMovement({ 
            tipo_movimento: form.tipo, 
            veiculo_id: isSaida ? form.veiculoId : undefined, 
            tanque_id: form.tipo === TipoMovimento.ENTRADA_BRITAGEM ? 'britagem' : 
                       form.tipo === TipoMovimento.ENTRADA_OBRA ? 'obra' : 
                       form.tanqueId,
            motorista: isSaida ? form.motorista : undefined, 
            litros: isSaida ? -parseFloat(form.litros) : parseFloat(form.litros), 
            km_informado: isSaida ? parseFloat(form.leitura) : undefined, 
            horimetro_informado: isSaida ? parseFloat(form.leitura) : undefined, 
            data_hora: new Date().toISOString(), 
            observacoes: '', 
            usuario_id: currentUser.id 
          }); 
          setForm({ ...form, litros: '', leitura: '' }); 
        }} className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 block">Tipo de Movimento</label>
            <select 
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold"
              value={form.tipo}
              onChange={e => setForm({...form, tipo: e.target.value as TipoMovimento})}
            >
              <option value={TipoMovimento.CONSUMO}>Saída (Consumo)</option>
              <option value={TipoMovimento.ENTRADA_BRITAGEM}>Entrada Britagem</option>
              <option value={TipoMovimento.ENTRADA_OBRA}>Entrada Obra</option>
            </select>
          </div>

          {form.tipo === TipoMovimento.CONSUMO && (
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 block">Tanque Origem/Destino</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold"
                value={form.tanqueId}
                onChange={e => setForm({...form, tanqueId: e.target.value as any})}
              >
                <option value="britagem">Tanque Britagem (11.000L)</option>
                <option value="obra">Tanque Obra (3.000L)</option>
              </select>
            </div>
          )}

          <input placeholder="Volume (Litros)" required type="number" step="0.01" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-black text-2xl" value={form.litros} onChange={e => setForm({...form, litros: e.target.value})} />
          {isSaida && (
            <div className="space-y-4">
              <select required className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.veiculoId} onChange={e => setForm({...form, veiculoId: e.target.value})}>
                <option value="">Selecione Ativo</option>
                {vehicles.map((v:any) => <option key={v.id} value={v.id}>{v.placa_ou_prefixo}</option>)}
              </select>
              <input placeholder="Leitura (KM ou H)" required type="number" step="0.01" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.leitura} onChange={e => setForm({...form, leitura: e.target.value})} />
              <input placeholder="Motorista" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.motorista} onChange={e => setForm({...form, motorista: e.target.value})} />
            </div>
          )}
          <button type="submit" className={`w-full ${isSaida ? 'bg-slate-900' : 'bg-green-600'} text-white py-5 rounded-2xl font-black uppercase text-xs shadow-xl`}>Lançar Agora</button>
        </form>
      </div></div>
      <div className="lg:col-span-8 bg-white rounded-[32px] border border-slate-200 overflow-hidden shadow-sm">
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">Data / Lançador</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">Motorista</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Leitura (Ant → Atu)</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Rendimento</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Volume</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.map((m:any) => {
                const u = users.find((ui:any) => ui.id === m.usuario_id);
                const { perf, prev } = getPerformanceData(m);
                const reading = m.km_informado || m.horimetro_informado || 0;
                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="text-[11px] font-bold text-slate-500">{new Date(m.data_hora).toLocaleDateString()}</div>
                      <div className="text-[9px] font-black text-blue-500 uppercase">Por: {u?.name || 'Sistema'}</div>
                      <div className={`text-[8px] font-black uppercase mt-1 ${m.tipo_movimento === TipoMovimento.CONSUMO ? 'text-red-400' : 'text-green-500'}`}>
                        {m.tipo_movimento === TipoMovimento.ENTRADA_BRITAGEM ? 'Entrada Britagem' : 
                         m.tipo_movimento === TipoMovimento.ENTRADA_OBRA ? 'Entrada Obra' : 'Consumo'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-[10px] font-black text-slate-700 uppercase">{m.motorista || '-'}</div>
                    </td>
                    <td className="px-6 py-4 text-center font-bold text-slate-600 text-[10px]">
                      {reading > 0 ? (
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-slate-400">{prev?.toLocaleString() || '0'}</span>
                          <span className="text-blue-400">→</span>
                          <span>{reading.toLocaleString()}</span>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {perf ? <div className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg inline-block">{perf}</div> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className={`px-6 py-4 text-right font-black ${m.litros > 0 ? 'text-green-600' : 'text-red-500'}`}>{m.litros.toLocaleString()} L</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditingMovement(m)} className="p-2 text-slate-300 hover:text-blue-500 transition-colors" title="Editar">
                          <Pencil size={18} />
                        </button>
                        {currentUser.role === 'admin' && (
                          <button onClick={() => deleteMovement(m.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors" title="Excluir">
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {movements.map((m:any) => {
            const u = users.find((ui:any) => ui.id === m.usuario_id);
            const { perf, prev } = getPerformanceData(m);
            const reading = m.km_informado || m.horimetro_informado || 0;
            return (
              <div key={m.id} className="p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase">{new Date(m.data_hora).toLocaleDateString()}</div>
                    <div className="text-xs font-black text-blue-500 uppercase">Por: {u?.name || 'Sistema'}</div>
                    <div className={`text-[9px] font-black uppercase mt-1 ${m.tipo_movimento === TipoMovimento.CONSUMO ? 'text-red-400' : 'text-green-500'}`}>
                      {m.tipo_movimento === TipoMovimento.ENTRADA_BRITAGEM ? 'Entrada Britagem' : 
                       m.tipo_movimento === TipoMovimento.ENTRADA_OBRA ? 'Entrada Obra' : 'Consumo'}
                    </div>
                  </div>
                  <div className={`text-xl font-black ${m.litros > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {m.litros > 0 ? '+' : ''}{m.litros.toLocaleString()} L
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[9px] font-black text-slate-400 uppercase">Motorista</div>
                    <div className="text-xs font-bold uppercase">{m.motorista || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-black text-slate-400 uppercase">Rendimento</div>
                    <div className="text-xs font-black text-indigo-600">{perf || '-'}</div>
                  </div>
                </div>

                {reading > 0 && (
                  <div className="bg-slate-50 p-3 rounded-xl flex items-center justify-between">
                    <div className="text-[9px] font-black text-slate-400 uppercase">Leitura</div>
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <span className="text-slate-400">{prev?.toLocaleString() || '0'}</span>
                      <span className="text-blue-400">→</span>
                      <span className="text-slate-700">{reading.toLocaleString()}</span>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setEditingMovement(m)} className="flex-1 bg-slate-50 text-slate-400 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest"><Pencil size={14} /> Editar</button>
                  {currentUser.role === 'admin' && (
                    <button onClick={() => deleteMovement(m.id)} className="flex-1 bg-red-50 text-red-400 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest"><Trash2 size={14} /> Excluir</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Movement Modal */}
      {editingMovement && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black">Corrigir Lançamento</h3>
              <button onClick={() => setEditingMovement(null)}><X size={20} /></button>
            </div>
            <form onSubmit={e => { 
              e.preventDefault(); 
              editMovement(editingMovement); 
              setEditingMovement(null); 
            }} className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Tipo de Movimento</label>
                <select 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold"
                  value={editingMovement.tipo_movimento}
                  onChange={e => {
                    const newTipo = e.target.value as TipoMovimento;
                    const wasSaida = editingMovement.tipo_movimento === TipoMovimento.CONSUMO;
                    const isNowSaida = newTipo === TipoMovimento.CONSUMO;
                    let newLitros = editingMovement.litros;
                    
                    if (wasSaida && !isNowSaida) newLitros = Math.abs(newLitros);
                    if (!wasSaida && isNowSaida) newLitros = -Math.abs(newLitros);
                    
                    setEditingMovement({...editingMovement, tipo_movimento: newTipo, litros: newLitros});
                  }}
                >
                  <option value={TipoMovimento.CONSUMO}>Saída (Consumo)</option>
                  <option value={TipoMovimento.ENTRADA_BRITAGEM}>Entrada Britagem</option>
                  <option value={TipoMovimento.ENTRADA_OBRA}>Entrada Obra</option>
                </select>
              </div>

              {editingMovement.tipo_movimento === TipoMovimento.CONSUMO && (
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Tanque Origem/Destino</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold"
                    value={editingMovement.tanque_id || 'britagem'}
                    onChange={e => setEditingMovement({...editingMovement, tanque_id: e.target.value as any})}
                  >
                    <option value="britagem">Tanque Britagem (11.000L)</option>
                    <option value="obra">Tanque Obra (3.000L)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Volume (Litros)</label>
                <input 
                  required 
                  type="number" 
                  step="0.01" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" 
                  value={Math.abs(editingMovement.litros)} 
                  onChange={e => setEditingMovement({...editingMovement, litros: editingMovement.litros < 0 ? -parseFloat(e.target.value) : parseFloat(e.target.value)})} 
                />
              </div>
              
              {editingMovement.tipo_movimento === TipoMovimento.CONSUMO && (
                <>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Leitura (KM ou H)</label>
                    <input 
                      required 
                      type="number" 
                      step="0.01" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" 
                      value={editingMovement.km_informado || editingMovement.horimetro_informado || ''} 
                      onChange={e => setEditingMovement({...editingMovement, km_informado: parseFloat(e.target.value), horimetro_informado: parseFloat(e.target.value)})} 
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Motorista</label>
                    <input 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" 
                      value={editingMovement.motorista || ''} 
                      onChange={e => setEditingMovement({...editingMovement, motorista: e.target.value})} 
                    />
                  </div>
                </>
              )}
              
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs shadow-lg mt-4">
                Salvar Alterações
              </button>
              
              <div className="pt-4 border-t border-slate-100 mt-4">
                <button 
                  type="button" 
                  onClick={() => {
                    deleteMovement(editingMovement.id, true);
                    setEditingMovement(null);
                  }} 
                  className="w-full bg-red-50 text-red-600 py-3 rounded-2xl font-black uppercase text-[10px] hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} /> Excluir Lançamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardView({ tanks, movements, vehicles }: any) {
  const totalLitersConsumidos = Math.abs(movements.filter((m: any) => m.litros < 0).reduce((acc: number, curr: any) => acc + curr.litros, 0));
  
  return (
    <div className="space-y-6">
      <header><h2 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tight">Status da Frota</h2></header>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {tanks.map((t: any) => {
          const percent = Math.min(100, Math.max(0, (t.saldo_atual / t.capacidade_litros) * 100));
          return (
            <div key={t.id} className="md:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 md:p-8 flex items-center justify-between shadow-sm">
              <div className="space-y-1">
                <h3 className="text-slate-400 text-[10px] font-black uppercase mb-1 tracking-widest">{t.nome}</h3>
                <div className="text-3xl md:text-5xl font-black text-slate-900 mb-2">{t.saldo_atual.toLocaleString()} <span className="text-lg md:text-xl text-slate-300">L</span></div>
                <div className="text-[10px] font-black text-blue-600 uppercase">Capacidade: {t.capacidade_litros.toLocaleString()} L</div>
              </div>
              <div className="w-16 h-16 md:w-20 md:h-20 relative">
                <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                  <circle cx="18" cy="18" r="16" fill="none" className="text-slate-100" strokeWidth="4" stroke="currentColor" />
                  <circle cx="18" cy="18" r="16" fill="none" className={percent < 15 ? 'text-red-500' : 'text-blue-600'} strokeWidth="4" strokeDasharray={`${percent}, 100`} strokeLinecap="round" stroke="currentColor" />
                </svg>
              </div>
            </div>
          );
        })}
        <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm flex flex-row md:flex-col items-center md:items-start justify-between">
          <Truck className="text-blue-600" size={32} />
          <div className="text-right md:text-left">
            <div className="text-[10px] font-black text-slate-400 uppercase">Frota Ativa</div>
            <div className="text-2xl md:text-3xl font-black">{vehicles.length} Ativos</div>
          </div>
        </div>
        <div className="bg-slate-900 rounded-3xl p-6 md:p-8 text-white shadow-xl flex flex-row md:flex-col items-center md:items-start justify-between">
          <Droplets className="text-blue-500" size={32} />
          <div className="text-right md:text-left">
            <div className="text-[10px] font-black opacity-60 uppercase">Total Consumido</div>
            <div className="text-2xl md:text-3xl font-black">{totalLitersConsumidos.toLocaleString()} L</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportsView({ movements, vehicles, users }: any) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const summaryByVehicle = vehicles.map((v: any) => {
    const vMovs = movements
      .filter((m: any) => m.veiculo_id === v.id)
      .sort((a: any, b: any) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime());
    
    const totalLiters = Math.abs(vMovs.reduce((acc: number, curr: any) => acc + curr.litros, 0));
    
    const initialReading = v.usa_medida === MedidaUso.KM ? (v.odometro_inicial ?? v.odometro_atual ?? 0) : (v.horimetro_inicial ?? v.horimetro_atual ?? 0);
    const lastReading = vMovs.length > 0 ? (vMovs[vMovs.length - 1].km_informado || vMovs[vMovs.length - 1].horimetro_informado || 0) : initialReading;
    
    // Total
    const diffTotal = lastReading - initialReading;

    // Mensal
    const movsBeforeMonth = vMovs.filter((m: any) => new Date(m.data_hora) < startOfMonth);
    const readingStartMonth = movsBeforeMonth.length > 0 
      ? (movsBeforeMonth[movsBeforeMonth.length - 1].km_informado || movsBeforeMonth[movsBeforeMonth.length - 1].horimetro_informado || 0)
      : initialReading;
    const movsInMonth = vMovs.filter((m: any) => new Date(m.data_hora) >= startOfMonth);
    const readingEndMonth = movsInMonth.length > 0
      ? (movsInMonth[movsInMonth.length - 1].km_informado || movsInMonth[movsInMonth.length - 1].horimetro_informado || 0)
      : readingStartMonth;
    const diffMonth = readingEndMonth - readingStartMonth;

    // Anual
    const movsBeforeYear = vMovs.filter((m: any) => new Date(m.data_hora) < startOfYear);
    const readingStartYear = movsBeforeYear.length > 0
      ? (movsBeforeYear[movsBeforeYear.length - 1].km_informado || movsBeforeYear[movsBeforeYear.length - 1].horimetro_informado || 0)
      : initialReading;
    const movsInYear = vMovs.filter((m: any) => new Date(m.data_hora) >= startOfYear);
    const readingEndYear = movsInYear.length > 0
      ? (movsInYear[movsInYear.length - 1].km_informado || movsInYear[movsInYear.length - 1].horimetro_informado || 0)
      : readingStartYear;
    const diffYear = readingEndYear - readingStartYear;
    
    let media = "N/A";
    if (totalLiters > 0 && diffTotal > 0) {
      media = v.usa_medida === MedidaUso.KM ? `${(diffTotal / totalLiters).toFixed(2)} KM/L` : `${(totalLiters / diffTotal).toFixed(2)} L/H`;
    }

    return { ...v, totalLiters, media, diffTotal, diffMonth, diffYear };
  });

  return (
    <div className="bg-white p-6 md:p-10 rounded-[32px] border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3 mb-8">
        <BarChart3 className="text-blue-600" size={28} />
        <h2 className="text-xl md:text-2xl font-black tracking-tight">Relatório de Performance e Uso</h2>
      </div>
      
      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">Ativo</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Uso Total</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Uso Mensal</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Uso Anual</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Consumo Total</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Média Geral</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summaryByVehicle.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-6 py-5">
                  <div className="font-black uppercase text-sm">{s.placa_ou_prefixo}</div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase">{s.modelo}</div>
                </td>
                <td className="px-6 py-5 text-center font-bold text-slate-600">
                  {s.diffTotal.toLocaleString()} {s.usa_medida === MedidaUso.KM ? 'KM' : 'H'}
                </td>
                <td className="px-6 py-5 text-center font-bold text-slate-500">
                  {s.diffMonth.toLocaleString()} {s.usa_medida === MedidaUso.KM ? 'KM' : 'H'}
                </td>
                <td className="px-6 py-5 text-center font-bold text-slate-500">
                  {s.diffYear.toLocaleString()} {s.usa_medida === MedidaUso.KM ? 'KM' : 'H'}
                </td>
                <td className="px-6 py-5 text-center font-bold text-slate-700">{s.totalLiters.toLocaleString()} L</td>
                <td className="px-6 py-5 text-center">
                  <div className="bg-blue-50 text-blue-600 text-xs font-black px-3 py-1.5 rounded-full inline-block">
                    {s.media}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {summaryByVehicle.map(s => (
          <div key={s.id} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-black uppercase text-base">{s.placa_ou_prefixo}</div>
                <div className="text-[10px] text-slate-400 font-bold uppercase">{s.modelo}</div>
              </div>
              <div className="bg-blue-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase">
                {s.media}
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-200/50">
              <div className="text-center">
                <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Total</div>
                <div className="text-[10px] font-bold text-slate-700">{s.diffTotal.toLocaleString()}{s.usa_medida === MedidaUso.KM ? 'K' : 'H'}</div>
              </div>
              <div className="text-center border-x border-slate-200/50">
                <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Mensal</div>
                <div className="text-[10px] font-bold text-slate-700">{s.diffMonth.toLocaleString()}{s.usa_medida === MedidaUso.KM ? 'K' : 'H'}</div>
              </div>
              <div className="text-center">
                <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Anual</div>
                <div className="text-[10px] font-bold text-slate-700">{s.diffYear.toLocaleString()}{s.usa_medida === MedidaUso.KM ? 'K' : 'H'}</div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Consumo Total</span>
              <span className="text-sm font-black text-slate-900">{s.totalLiters.toLocaleString()} L</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TankView({ tanks, movements }: any) {
  const entradas = movements.filter((m: any) => m.tipo_movimento !== TipoMovimento.CONSUMO).slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
        {tanks.map((t: any) => {
          const percent = Math.min(100, Math.max(0, (t.saldo_atual / t.capacidade_litros) * 100));
          return (
            <div key={t.id} className="bg-white p-6 md:p-10 rounded-[32px] md:rounded-[44px] border border-slate-200 shadow-sm flex flex-col items-center">
              <Box size={48} className="text-blue-600 mb-6" />
              <h3 className="text-xl md:text-2xl font-black text-slate-900 uppercase tracking-tighter mb-8 text-center">{t.nome}</h3>
              <div className="w-full bg-slate-100 h-6 rounded-full overflow-hidden border border-slate-200 mb-4">
                <div className={`h-full transition-all duration-1000 ${percent < 15 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${percent}%` }} />
              </div>
              <div className="flex justify-between w-full text-[9px] md:text-[10px] font-black text-slate-400 uppercase px-1">
                <span>0 L</span>
                <span>{t.saldo_atual.toLocaleString()} L Disponível</span>
                <span>{t.capacidade_litros.toLocaleString()} L</span>
              </div>
              <div className="mt-8 p-6 bg-slate-50 rounded-3xl w-full text-center">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Espaço Livre</div>
                <div className="text-2xl md:text-3xl font-black text-slate-700">{(t.capacidade_litros - t.saldo_atual).toLocaleString()} L</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="bg-white p-6 md:p-10 rounded-[32px] md:rounded-[44px] border border-slate-200 shadow-sm">
        <h3 className="text-lg md:text-xl font-black mb-6 flex items-center gap-2"><ArrowDownCircle className="text-green-600" /> Entradas Recentes</h3>
        <div className="space-y-4">
          {entradas.length > 0 ? entradas.map((e: any) => (
            <div key={e.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div>
                <div className="text-[10px] font-bold text-slate-500">{new Date(e.data_hora).toLocaleDateString()}</div>
                <div className="text-xs font-black text-slate-900 uppercase">
                  {e.tipo_movimento === TipoMovimento.ENTRADA_BRITAGEM ? 'Entrada Britagem' : 'Entrada Obra'}
                </div>
                <div className="text-[8px] font-black text-blue-500 uppercase mt-0.5">
                  Tanque: {e.tanque_id || (e.tipo_movimento === TipoMovimento.ENTRADA_OBRA ? 'obra' : 'britagem')}
                </div>
              </div>
              <div className="text-base md:text-lg font-black text-green-600">+{e.litros.toLocaleString()} L</div>
            </div>
          )) : <div className="text-center py-10 text-slate-400 font-bold uppercase text-[10px]">Nenhuma entrada registrada.</div>}
        </div>
      </div>
    </div>
  );
}

function UserManagementView({ users, onRefresh }: { users: AppUser[], onRefresh: () => Promise<void> | void }) {
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ name: '', login: '', password: '', role: 'operador' as 'admin' | 'operador' });
  const togglePass = (id: string) => setShowPass(prev => ({...prev, [id]: !prev[id]}));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); await db.put('users', { ...form, id: Math.random().toString(36).substr(2, 9) }); setShowForm(false); setForm({ name: '', login: '', password: '', role: 'operador' }); onRefresh(); alert("OK!"); };
  const submitEdit = async (e: React.FormEvent) => { e.preventDefault(); if (editingUser) { await db.put('users', editingUser); setEditingUser(null); onRefresh(); alert("Usuário atualizado!"); } };
  const del = async (id: string) => { if (id === 'admin-id') return; if (confirm("Excluir?")) { await db.delete('users', id); onRefresh(); } };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div><h2 className="text-2xl md:text-3xl font-black tracking-tight">Equipe</h2></div>
        <button onClick={() => setShowForm(true)} className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase shadow-lg flex items-center justify-center gap-2"><UserPlus size={18} /> Novo Usuário</button>
      </div>
      
      {/* Desktop Table */}
      <div className="hidden md:block bg-white rounded-[32px] border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr><th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome / Login</th><th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase text-center">Perfil</th><th className="px-8 py-5">Senha</th><th className="px-8 py-5"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-8 py-6"><div className="font-black uppercase text-slate-900 text-sm">{u.name}</div><div className="text-[10px] font-bold text-slate-400 lowercase">@{u.login}</div></td>
                <td className="px-8 py-6 text-center"><span className={`text-[9px] font-black px-2 py-1 rounded border uppercase ${u.role === 'admin' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>{u.role}</span></td>
                <td className="px-8 py-6 flex items-center gap-2"><span className="font-mono text-sm">{showPass[u.id] ? u.password : '••••••••'}</span><button onClick={() => togglePass(u.id)} className="text-slate-300">{showPass[u.id] ? <EyeOff size={14} /> : <Eye size={14} />}</button></td>
                <td className="px-8 py-6 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setEditingUser(u)} className="text-slate-300 hover:text-blue-500 transition-colors" title="Editar">
                      <Pencil size={18} />
                    </button>
                    <button onClick={() => del(u.id)} className="text-slate-200 hover:text-red-500 transition-colors" title="Excluir">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {users.map(u => (
          <div key={u.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-black uppercase text-slate-900 text-base">{u.name}</div>
                <div className="text-[10px] font-bold text-slate-400 lowercase">@{u.login}</div>
              </div>
              <span className={`text-[9px] font-black px-2 py-1 rounded border uppercase ${u.role === 'admin' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>{u.role}</span>
            </div>
            
            <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{showPass[u.id] ? u.password : '••••••••'}</span>
                <button onClick={() => togglePass(u.id)} className="text-slate-300">{showPass[u.id] ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditingUser(u)} className="p-2 text-slate-400 hover:text-blue-500"><Pencil size={18} /></button>
                <button onClick={() => del(u.id)} className="p-2 text-slate-300 hover:text-red-500"><Trash2 size={18} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {showForm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Novo Colaborador</h3>
            <form onSubmit={submit} className="space-y-4">
              <input required placeholder="Nome Completo" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              <input required placeholder="Login" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.login} onChange={e => setForm({...form, login: e.target.value})} />
              <input required placeholder="Senha" type="password" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
              <select className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.role} onChange={e => setForm({...form, role: e.target.value as any})}>
                <option value="operador">Operador</option>
                <option value="admin">Administrador</option>
              </select>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase">Criar</button>
              <button type="button" onClick={() => setShowForm(false)} className="w-full py-2 font-bold text-slate-400">Cancelar</button>
            </form>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Editar Colaborador</h3>
            <form onSubmit={submitEdit} className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Nome Completo</label>
                <input required className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.name} onChange={e => setEditingUser({...editingUser, name: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Login</label>
                <input required className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.login} onChange={e => setEditingUser({...editingUser, login: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Senha</label>
                <input required type="text" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.password} onChange={e => setEditingUser({...editingUser, password: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Perfil</label>
                <select className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}>
                  <option value="operador">Operador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase mt-4">Salvar Alterações</button>
              <button type="button" onClick={() => setEditingUser(null)} className="w-full py-2 font-bold text-slate-400">Cancelar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
