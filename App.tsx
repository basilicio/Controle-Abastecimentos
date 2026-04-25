
import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Truck, Droplets, History, PlusCircle, 
  BarChart3, AlertTriangle, Box, 
  LogOut, ShieldAlert, Settings, AlertCircle, UserPlus, Gauge,
  Pencil, Trash2, X, RefreshCcw, Database, User, ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  orderBy,
  getDoc
} from 'firebase/firestore';
import { auth, db } from './src/lib/firebase';
import { 
  TipoVeiculo, MedidaUso, TipoMovimento, VeiculoEquipamento, 
  MovimentoTanque, Tanque, AppUser 
} from './types';

// Constants
const CAPACITY_BRITAGEM = 11000;
const CAPACITY_OBRA = 3000;

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'fleet' | 'movements' | 'tank' | 'reports' | 'users'>('dashboard');
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [vehicles, setVehicles] = useState<VeiculoEquipamento[]>([]);
  const [movements, setMovements] = useState<MovimentoTanque[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [tanks, setTanks] = useState<Tanque[]>([
    { id: 'britagem', nome: 'Tanque Britagem', capacidade_litros: CAPACITY_BRITAGEM, saldo_atual: 0 },
    { id: 'obra', nome: 'Tanque Obra', capacidade_litros: CAPACITY_OBRA, saldo_atual: 0 }
  ]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      // If we have a bypass user, don't let Auth listener reset it
      if (currentUser?.id === 'admin_master_bypass') return;

      if (firebaseUser) {
        // Use onSnapshot to handle the race condition between Auth and Firestore creation
        const userRef = doc(db, 'users', firebaseUser.uid);
        const unsubDoc = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            setCurrentUser(docSnap.data() as AppUser);
            setLoading(false);
          } else {
            // If we are in the middle of registration, wait for the doc
            // We don't set currentUser to null yet to avoid flickering LoginView
          }
        });
        return () => unsubDoc();
      } else {
        setCurrentUser(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Data Listeners
  useEffect(() => {
    if (!currentUser) return;

    const vQuery = query(collection(db, 'vehicles'));
    const mQuery = query(collection(db, 'movements'), orderBy('data_hora', 'desc'));
    const uQuery = query(collection(db, 'users'));

    const unsubV = onSnapshot(vQuery, (snap) => {
      setVehicles(snap.docs.map(d => ({ ...d.data(), id: d.id } as VeiculoEquipamento)));
    });

    const unsubM = onSnapshot(mQuery, (snap) => {
      const ms = snap.docs.map(d => ({ ...d.data(), id: d.id } as MovimentoTanque));
      setMovements(ms);
      
      // Calculate balanced tanks
      const balanceBritagem = ms.filter(mov => 
        mov.tanque_id === 'britagem' || mov.tipo_movimento === TipoMovimento.ENTRADA_BRITAGEM
      ).reduce((acc, curr) => acc + curr.litros, 0);

      const balanceObra = ms.filter(mov => 
        mov.tanque_id === 'obra' || mov.tipo_movimento === TipoMovimento.ENTRADA_OBRA
      ).reduce((acc, curr) => acc + curr.litros, 0);

      setTanks([
        { id: 'britagem', nome: 'Tanque Britagem', capacidade_litros: CAPACITY_BRITAGEM, saldo_atual: balanceBritagem },
        { id: 'obra', nome: 'Tanque Obra', capacidade_litros: CAPACITY_OBRA, saldo_atual: balanceObra }
      ]);
    });

    const unsubU = onSnapshot(uQuery, (snap) => {
      setUsers(snap.docs.map(d => ({ ...d.data(), id: d.id } as AppUser)));
    });

    return () => { unsubV(); unsubM(); unsubU(); };
  }, [currentUser]);

  const handleLogout = () => signOut(auth);

  if (loading) return <LoadingScreen />;
  if (!currentUser) return <LoginView setCurrentUser={setCurrentUser} />;

  // Approval screen
  if (!currentUser.approved && currentUser.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm bg-white rounded-[40px] p-10 shadow-2xl text-center">
          <div className="bg-amber-500 w-16 h-16 rounded-[22px] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-amber-200">
            <AlertTriangle className="text-white" size={32} />
          </div>
          <h2 className="text-2xl font-black mb-4">Aguardando Aprovação</h2>
          <p className="text-sm text-slate-500 font-medium leading-relaxed mb-8">
            Seu cadastro foi realizado com sucesso! Por favor, aguarde o Administrador aprovar seu acesso para começar a utilizar o sistema.
          </p>
          <button onClick={handleLogout} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl">
            Sair e Voltar depois
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#F8FAFC] text-[#1E293B]">
      {/* Sidebar Implementation */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        currentUser={currentUser} 
        onLogout={handleLogout}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
      />

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'dashboard' && <DashboardView tanks={tanks} movements={movements} vehicles={vehicles} />}
            {activeTab === 'fleet' && <FleetView vehicles={vehicles} users={users} currentUser={currentUser} />}
            {activeTab === 'movements' && <MovementsView movements={movements} vehicles={vehicles} users={users} currentUser={currentUser} />}
            {activeTab === 'reports' && <ReportsView movements={movements} vehicles={vehicles} users={users} />}
            {activeTab === 'tank' && <TankView tanks={tanks} movements={movements} />}
            {activeTab === 'users' && currentUser.role === 'admin' && <UserManagementView users={users} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

// Components

function Sidebar({ activeTab, setActiveTab, currentUser, onLogout, isSidebarOpen, setIsSidebarOpen }: any) {
  return (
    <>
      <div className="md:hidden bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-100"><Droplets size={20} className="text-white" /></div>
          <h1 className="text-lg font-bold">FuelTrack</h1>
        </div>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          {isSidebarOpen ? <X size={24} /> : <Settings size={24} />}
        </button>
      </div>

      <nav className={`
        fixed md:sticky top-0 left-0 h-screen w-72 bg-white border-r border-slate-200 p-6 flex flex-col z-50 transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="hidden md:flex items-center gap-3 mb-8">
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-lg shadow-blue-100"><Droplets size={24} className="text-white" /></div>
          <div><h1 className="text-xl font-bold leading-tight">FuelTrack</h1><span className="text-[10px] font-bold text-blue-600 tracking-widest uppercase">Cloud Persistence</span></div>
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
               <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">{(currentUser.name || 'U').charAt(0)}</div>
               <div className="max-w-[120px] overflow-hidden">
                 <p className="text-[10px] font-black uppercase text-slate-900 truncate">{currentUser.name}</p>
                 <p className="text-[8px] font-bold text-slate-400 uppercase">{currentUser.role}</p>
               </div>
            </div>
            <button onClick={onLogout} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><LogOut size={18} /></button>
        </div>
      </nav>
    </>
  );
}

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
                <div className="text-3xl md:text-5xl font-black text-slate-900 mb-2">{Math.max(0, t.saldo_atual).toLocaleString()} <span className="text-lg md:text-xl text-slate-300">L</span></div>
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

function FleetView({ vehicles, users, currentUser }: any) {
  const [showForm, setShowForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<any>(null);
  const [form, setForm] = useState({ tipo: TipoVeiculo.VEICULO, placa_ou_prefixo: '', modelo: '', usa_medida: MedidaUso.KM, odometro_atual: 0, horimetro_atual: 0 });

  const saveVehicle = async (v: any) => {
    try {
      const id = v.id || Math.random().toString(36).substr(2, 9);
      await setDoc(doc(db, 'vehicles', id), {
        ...v,
        id,
        usuario_id: v.usuario_id || currentUser.id,
        odometro_inicial: v.odometro_inicial ?? v.odometro_atual,
        horimetro_inicial: v.horimetro_inicial ?? v.horimetro_atual,
        ativo: true
      });
      setShowForm(false);
      setEditingVehicle(null);
    } catch (e) {
      alert("Erro ao salvar veículo. Verifique permissões.");
    }
  };

  const deleteVehicle = async (id: string) => {
    if (confirm('Excluir este ativo?')) {
      try {
        await deleteDoc(doc(db, 'vehicles', id));
      } catch (e) {
        alert("Erro ao excluir veículo.");
      }
    }
  };

  return (
    <div className="space-y-6 transition-all duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div><h2 className="text-2xl md:text-3xl font-black tracking-tight">Ativos Operacionais</h2></div>
        <button onClick={() => setShowForm(true)} className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg hover:bg-blue-700 transition-all"><PlusCircle size={18} /> Novo Ativo</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {vehicles.map((v: any) => (
          <motion.div 
            layout
            key={v.id} 
            className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 hover:shadow-md transition-shadow"
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-black uppercase text-slate-900 text-lg">{v.placa_ou_prefixo}</div>
                <div className="text-xs text-slate-400 font-bold uppercase">{v.modelo}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditingVehicle(v)} className="p-2 bg-slate-50 text-slate-400 rounded-xl hover:text-blue-600 transition-colors"><Pencil size={18} /></button>
                {currentUser.role === 'admin' && (
                  <button onClick={() => deleteVehicle(v.id)} className="p-2 bg-red-50 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-all"><Trash2 size={18} /></button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50">
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Inicial</div>
                <div className="font-bold text-slate-600">{v.usa_medida === MedidaUso.KM ? `${(v.odometro_inicial ?? 0).toLocaleString()} KM` : `${(v.horimetro_inicial ?? 0).toLocaleString()} H`}</div>
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Atual</div>
                <div className="font-bold text-blue-600">{v.usa_medida === MedidaUso.KM ? `${v.odometro_atual.toLocaleString()} KM` : `${v.horimetro_atual.toLocaleString()} H`}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Forms/Modals could be moved here for better organization */}
      {showForm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-black">Cadastrar Ativo</h3><button onClick={() => setShowForm(false)}><X size={20} /></button></div>
            <form onSubmit={e => { e.preventDefault(); saveVehicle(form); }} className="space-y-4">
              <select className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value as any, usa_medida: e.target.value === TipoVeiculo.VEICULO ? MedidaUso.KM : MedidaUso.HORIMETRO})}>
                <option value={TipoVeiculo.VEICULO}>Veículo (KM)</option>
                <option value={TipoVeiculo.EQUIPAMENTO}>Máquina (Hora)</option>
              </select>
              <input required placeholder="Placa / Prefixo" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold uppercase" value={form.placa_ou_prefixo} onChange={e => setForm({...form, placa_ou_prefixo: e.target.value.toUpperCase()})} />
              <input required placeholder="Modelo" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.modelo} onChange={e => setForm({...form, modelo: e.target.value})} />
              <input type="number" step="0.01" required placeholder="Leitura Inicial" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" onChange={e => setForm({...form, odometro_atual: form.usa_medida === MedidaUso.KM ? parseFloat(e.target.value) : 0, horimetro_atual: form.usa_medida === MedidaUso.HORIMETRO ? parseFloat(e.target.value) : 0})} />
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs">Salvar Ativo</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MovementsView({ movements, vehicles, currentUser }: any) {
  const [form, setForm] = useState({ tipo: TipoMovimento.CONSUMO, veiculoId: '', motorista: '', litros: '', leitura: '', tanqueId: 'britagem' as 'britagem' | 'obra' });

  const addMov = async (e: any) => {
    e.preventDefault();
    try {
      const id = Math.random().toString(36).substr(2, 9);
      const mov = {
        id,
        tipo_movimento: form.tipo,
        veiculo_id: form.tipo === TipoMovimento.CONSUMO ? form.veiculoId : null,
        tanque_id: form.tipo === TipoMovimento.CONSUMO ? form.tanqueId : (form.tipo === TipoMovimento.ENTRADA_BRITAGEM ? 'britagem' : 'obra'),
        litros: form.tipo === TipoMovimento.CONSUMO ? -Math.abs(parseFloat(form.litros)) : Math.abs(parseFloat(form.litros)),
        km_informado: form.tipo === TipoMovimento.CONSUMO ? parseFloat(form.leitura) : null,
        horimetro_informado: form.tipo === TipoMovimento.CONSUMO ? parseFloat(form.leitura) : null,
        motorista: form.motorista,
        data_hora: new Date().toISOString(),
        usuario_id: currentUser.id,
        observacoes: ''
      };

      await setDoc(doc(db, 'movements', id), mov);

      // Update vehicle reading
      if (form.tipo === TipoMovimento.CONSUMO && form.veiculoId) {
        const v = vehicles.find((vi:any) => vi.id === form.veiculoId);
        if (v) {
          await setDoc(doc(db, 'vehicles', v.id), {
            ...v,
            odometro_atual: v.usa_medida === MedidaUso.KM ? Math.max(v.odometro_atual, parseFloat(form.leitura)) : v.odometro_atual,
            horimetro_atual: v.usa_medida === MedidaUso.HORIMETRO ? Math.max(v.horimetro_atual, parseFloat(form.leitura)) : v.horimetro_atual
          });
        }
      }
      setForm({ ...form, litros: '', leitura: '' });
    } catch (e) {
      alert("Erro ao lançar movimento.");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
      <div className="lg:col-span-4">
        <div className="bg-white rounded-[32px] border border-slate-200 p-8 shadow-sm">
          <h3 className="text-xl font-black mb-6">Lançar Movimento</h3>
          <form onSubmit={addMov} className="space-y-4">
            <select className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value as any})}>
              <option value={TipoMovimento.CONSUMO}>Saída (Consumo)</option>
              <option value={TipoMovimento.ENTRADA_BRITAGEM}>Entrada Britagem</option>
              <option value={TipoMovimento.ENTRADA_OBRA}>Entrada Obra</option>
            </select>
            
            <input placeholder="Litros" required type="number" step="0.01" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-black text-2xl" value={form.litros} onChange={e => setForm({...form, litros: e.target.value})} />
            
            {form.tipo === TipoMovimento.CONSUMO && (
              <>
                <select required className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.veiculoId} onChange={e => setForm({...form, veiculoId: e.target.value})}>
                  <option value="">Selecione Ativo</option>
                  {vehicles.map((v:any) => <option key={v.id} value={v.id}>{v.placa_ou_prefixo}</option>)}
                </select>
                <input placeholder="Leitura (KM/H)" required type="number" step="0.01" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.leitura} onChange={e => setForm({...form, leitura: e.target.value})} />
                <input placeholder="Motorista" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.motorista} onChange={e => setForm({...form, motorista: e.target.value})} />
              </>
            )}
            <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase text-xs shadow-xl hover:bg-blue-700 transition-all">Lançar Registro</button>
          </form>
        </div>
      </div>
      <div className="lg:col-span-8 space-y-4">
        {movements.map((m: any) => (
          <div key={m.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex justify-between items-center">
             <div>
                <div className="text-[10px] font-black text-slate-400 uppercase">{new Date(m.data_hora).toLocaleString()}</div>
                <div className="font-bold text-slate-900 uppercase">
                  {m.tipo_movimento === TipoMovimento.CONSUMO ? `Saída: ${vehicles.find((v:any) => v.id === m.veiculo_id)?.placa_ou_prefixo || '?'}` : 'Entrada de Combustível'}
                </div>
                <div className="text-[9px] font-black text-blue-500 uppercase">{m.tipo_movimento} | Tanque: {m.tanque_id}</div>
             </div>
             <div className={`text-xl font-black ${m.litros > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {m.litros > 0 ? '+' : ''}{m.litros.toLocaleString()} L
             </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TankView({ tanks }: any) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {tanks.map((t: any) => {
        const percent = Math.min(100, (t.saldo_atual / t.capacidade_litros) * 100);
        return (
          <div key={t.id} className="bg-white p-10 rounded-[44px] border border-slate-200 shadow-sm flex flex-col items-center">
            <Box size={48} className="text-blue-600 mb-6" />
            <h3 className="text-2xl font-black text-slate-900 uppercase mb-8">{t.nome}</h3>
            <div className="w-full bg-slate-100 h-6 rounded-full overflow-hidden border border-slate-200 mb-4">
               <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                className={`h-full ${percent < 15 ? 'bg-red-500' : 'bg-blue-600'}`} 
               />
            </div>
            <div className="flex justify-between w-full text-[10px] font-black text-slate-400 uppercase">
               <span>0 L</span>
               <span>{Math.max(0, t.saldo_atual).toLocaleString()} L</span>
               <span>{t.capacidade_litros.toLocaleString()} L</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReportsView({ movements, vehicles }: any) {
  // Simplified report list
  return (
    <div className="bg-white p-10 rounded-[44px] border border-slate-200 shadow-sm">
      <h2 className="text-2xl font-black mb-8 flex items-center gap-3"><BarChart3 className="text-blue-600" /> Rendimento por Ativo</h2>
      <div className="space-y-4">
        {vehicles.map((v: any) => {
          const vMs = movements.filter((m:any) => m.veiculo_id === v.id);
          const totalL = Math.abs(vMs.reduce((acc:number, curr:any) => acc + curr.litros, 0));
          return (
            <div key={v.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
              <div>
                <div className="font-black uppercase">{v.placa_ou_prefixo}</div>
                <div className="text-[10px] text-slate-400 font-bold uppercase">{v.modelo}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black">{totalL.toLocaleString()} L</div>
                <div className="text-[10px] font-black text-blue-500 uppercase">Total Consumido</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UserManagementView({ users }: any) {
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  
  const toggleApproval = async (user: AppUser) => {
    try {
      await setDoc(doc(db, 'users', user.id), {
        ...user,
        approved: !user.approved
      });
    } catch (e) {
      alert("Erro ao alterar status de aprovação.");
    }
  };

  const saveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await setDoc(doc(db, 'users', editingUser.id), editingUser);
      setEditingUser(null);
    } catch (e) {
      alert("Erro ao salvar usuário.");
    }
  };

  const deleteUser = async (id: string) => {
    if (id === auth.currentUser?.uid) return alert("Você não pode excluir a si mesmo.");
    if (confirm("Excluir este usuário?")) {
      try {
        await deleteDoc(doc(db, 'users', id));
      } catch (e) {
        alert("Erro ao excluir usuário.");
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-black tracking-tight">Gestão de Equipe</h2>
        <p className="text-[10px] font-black uppercase text-slate-400">Controle de acesso ao FuelTrack</p>
      </div>
      <div className="bg-white rounded-[44px] border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Status</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Nome</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Perfil</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">E-mail</th>
              <th className="px-8 py-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u: any) => (
              <tr key={u.id} className={!u.approved ? 'bg-amber-50/30' : ''}>
                <td className="px-8 py-6">
                  {u.approved ? (
                    <span className="flex items-center gap-1.5 text-green-600 text-[10px] font-black uppercase"><ShieldCheck size={14} /> Ativo</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-amber-500 text-[10px] font-black uppercase"><AlertCircle size={14} /> Pendente</span>
                  )}
                </td>
                <td className="px-8 py-6 font-black uppercase text-slate-700">{u.name}</td>
                <td className="px-8 py-6">
                  <span className={`text-[9px] font-black px-2 py-1 rounded border uppercase ${u.role === 'admin' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-8 py-6 text-slate-400 text-xs font-bold leading-none">{u.login}@corp.com</td>
                <td className="px-8 py-6 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button 
                      onClick={() => toggleApproval(u)}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                        u.approved ? 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-600 text-white shadow-md shadow-green-100'
                      }`}
                    >
                      {u.approved ? 'Bloquear' : 'Aprovar'}
                    </button>
                    <button onClick={() => setEditingUser(u)} className="p-2 text-slate-300 hover:text-blue-600 transition-colors"><Pencil size={18} /></button>
                    {u.id !== auth.currentUser?.uid && (
                      <button onClick={() => deleteUser(u.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Editar Colaborador</h3>
            <form onSubmit={saveUser} className="space-y-4">
              <input required placeholder="Nome" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.name} onChange={e => setEditingUser({...editingUser, name: e.target.value})} />
              <select className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}>
                <option value="operador">Operador</option>
                <option value="admin">Administrador</option>
              </select>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase">Salvar</button>
              <button type="button" onClick={() => setEditingUser(null)} className="w-full py-2 font-bold text-slate-400">Cancelar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function LoginView({ setCurrentUser }: { setCurrentUser: (user: AppUser | null) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      
      // Check if user profile exists in Firestore
      const userRef = doc(db, 'users', result.user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        const isAdmin = result.user.email === 'admin@fueltrack.com' || result.user.email === 'basilicio@gmail.com';
        await setDoc(userRef, {
          id: result.user.uid,
          name: result.user.displayName || result.user.email?.split('@')[0] || 'Usuário',
          login: result.user.email?.split('@')[0] || 'user',
          role: isAdmin ? 'admin' : 'operador',
          approved: isAdmin
        });
      }
    } catch (e: any) {
      setError('Falha ao entrar com Google. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // Direct Admin Bypass for Google Org restrictions
      if (email === 'admin@fueltrack.com' && password === 'admin123') {
        const adminUser: AppUser = {
          id: 'admin_master_bypass',
          name: 'Administrador Mestre',
          login: 'admin',
          role: 'admin',
          approved: true,
          password: ''
        };
        // Persist to firestore even if auth fails
        await setDoc(doc(db, 'users', adminUser.id), adminUser);
        setCurrentUser(adminUser);
        setLoading(false);
        return;
      }

      if (isRegistering) {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const isAdmin = email === 'admin@fueltrack.com' || email === 'basilicio@gmail.com';
        await setDoc(doc(db, 'users', credential.user.uid), {
          id: credential.user.uid,
          name: name || email.split('@')[0],
          login: email.split('@')[0],
          role: isAdmin ? 'admin' : 'operador',
          approved: isAdmin // Admin is auto-approved
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e: any) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        setError('E-mail ou senha incorretos.');
      } else if (e.code === 'auth/email-already-in-use') {
        setError('Este e-mail já está cadastrado.');
      } else if (e.code === 'auth/operation-not-allowed') {
        setError('Acesso por e-mail/senha desativado. Use "Entrar com Google".');
      } else {
        setError('Erro na autenticação. Verifique os dados.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-[40px] p-10 shadow-2xl text-center">
        <div className="bg-blue-600 w-16 h-16 rounded-[22px] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200"><Droplets className="text-white" size={32} /></div>
        <h2 className="text-3xl font-black mb-2">FuelTrack Pro</h2>
        <p className="text-[10px] font-black uppercase text-slate-400 mb-10 tracking-widest">{isRegistering ? 'Criar Nova Conta' : 'Acesso Restrito'}</p>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={18} />
            <p className="text-[10px] font-black uppercase tracking-tight text-left">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <form onSubmit={handleAuth} className="space-y-4 text-left">
            {isRegistering && (
              <input required placeholder="Seu Nome Completo" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm" value={name} onChange={e => setName(e.target.value)} />
            )}
            <input required type="email" placeholder="E-mail Corporativo" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm" value={email} onChange={e => setEmail(e.target.value)} />
            <input required type="password" placeholder="Senha" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm" value={password} onChange={e => setPassword(e.target.value)} />
            <button disabled={loading} type="submit" className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl hover:bg-black transition-colors disabled:opacity-50">
              {loading ? 'Processando...' : (isRegistering ? 'Cadastrar Minha Conta' : 'Entrar Agora')}
            </button>
          </form>

          {!isRegistering && (
            <button 
              onClick={() => {
                const adminUser: AppUser = {
                  id: 'admin_demo',
                  name: 'Administrador Demo',
                  login: 'admin',
                  role: 'admin',
                  approved: true,
                  password: ''
                };
                setCurrentUser(adminUser);
              }}
              className="w-full border-2 border-blue-600 text-blue-600 py-4 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-blue-50 transition-colors"
            >
              Entrar como Admin (Demo)
            </button>
          )}
        </div>

        <button 
          onClick={() => { setIsRegistering(!isRegistering); setError(''); }} 
          className="mt-6 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 transition-colors"
        >
          {isRegistering ? 'Já tenho conta? Fazer Login' : 'Primeiro Acesso? Começar Aqui'}
        </button>

        <p className="mt-8 text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-loose">Segurança Criptografada<br/>Google Cloud Platform</p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return <div className="h-screen w-full flex items-center justify-center bg-slate-50"><div className="flex flex-col items-center gap-4"><RefreshCcw size={40} className="text-blue-600 animate-spin" /><p className="font-black text-slate-400 uppercase text-[10px] tracking-widest leading-loose">Autenticando Cloud...</p></div></div>;
}
