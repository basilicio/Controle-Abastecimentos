
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, Truck, Droplets, History, PlusCircle, 
  BarChart3, AlertTriangle, Box, 
  LogOut, ShieldAlert, Settings, AlertCircle, UserPlus, Gauge,
  Pencil, Trash2, X, RefreshCcw, Database, User, ShieldCheck,
  FileSpreadsheet, Calendar
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
import { doc, getDoc, setDoc, deleteDoc, orderBy, onSnapshot, collection, query, getDocFromServer } from 'firebase/firestore';
import { auth, db } from './src/lib/firebase';
import { 
  TipoVeiculo, MedidaUso, TipoMovimento, VeiculoEquipamento, 
  MovimentoTanque, Tanque, AppUser 
} from './types';

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}


// Constants
const CAPACITY_BRITAGEM = 11000;
const CAPACITY_OBRA = 3000;

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'fleet' | 'movements' | 'tank' | 'reports' | 'users' | 'audit'>('dashboard');
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [vehicles, setVehicles] = useState<VeiculoEquipamento[]>([]);
  const [movements, setMovements] = useState<MovimentoTanque[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
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
        }, (error) => {
           handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
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
    const lQuery = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'));

    const unsubV = onSnapshot(vQuery, (snap) => {
      setVehicles(snap.docs.map(d => ({ ...d.data(), id: d.id } as VeiculoEquipamento)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'vehicles');
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
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'movements');
    });

    const unsubU = onSnapshot(uQuery, (snap) => {
      setUsers(snap.docs.map(d => ({ ...d.data(), id: d.id } as AppUser)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    const unsubL = onSnapshot(lQuery, (snap) => {
      setLogs(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'audit_logs');
    });

    return () => { unsubV(); unsubM(); unsubU(); unsubL(); };
  }, [currentUser]);

  const handleLogout = () => {
    if (currentUser?.id === 'admin_master_bypass') {
      setCurrentUser(null);
    } else {
      signOut(auth).then(() => setCurrentUser(null));
    }
  };

  const logAction = async (type: string, oldData: any, newData: any) => {
    if (!currentUser) return;
    try {
      const logId = Math.random().toString(36).substr(2, 12);
      await setDoc(doc(db, 'audit_logs', logId), {
        id: logId,
        type,
        oldData,
        newData,
        timestamp: new Date().toISOString(),
        userId: currentUser.id,
        userName: currentUser.name
      });
    } catch (e) {
      console.error("Erro ao registrar log de auditoria", e);
    }
  };

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
            {activeTab === 'fleet' && <FleetView vehicles={vehicles} users={users} currentUser={currentUser} logAction={logAction} />}
            {activeTab === 'movements' && <MovementsView movements={movements} vehicles={vehicles} users={users} currentUser={currentUser} logAction={logAction} />}
            {activeTab === 'reports' && <ReportsView movements={movements} vehicles={vehicles} users={users} />}
            {activeTab === 'tank' && <TankView tanks={tanks} movements={movements} />}
            {activeTab === 'users' && currentUser.role === 'admin' && <UserManagementView users={users} logAction={logAction} />}
            {activeTab === 'audit' && currentUser.role === 'admin' && <AuditView logs={logs} logAction={logAction} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function AuditView({ logs, logAction }: any) {
  const undoAction = async (log: any) => {
    if (!confirm('Deseja realmente desfazer esta ação?')) return;
    
    try {
      if (log.type === 'VEHICLE_EDIT' || log.type === 'VEHICLE_DELETE') {
        await setDoc(doc(db, 'vehicles', log.oldData.id), log.oldData);
      } else if (log.type === 'MOVEMENT_DELETE') {
        await setDoc(doc(db, 'movements', log.oldData.id), log.oldData);
      } else if (log.type === 'USER_DELETE') {
        await setDoc(doc(db, 'users', log.oldData.id), log.oldData);
      }
      
      await deleteDoc(doc(db, 'audit_logs', log.id));
      alert("Ação desfeita com sucesso!");
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `undo_log/${log.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black tracking-tight">Histórico de Alterações</h2>
          <p className="text-[10px] font-black uppercase text-slate-400">Auditoria e Recuperação de Dados</p>
        </div>
      </div>

      <div className="bg-white rounded-[44px] border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left font-sans">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Data</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Usuário</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Ação</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Detalhes</th>
              <th className="px-8 py-5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l: any) => (
              <tr key={l.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-8 py-6">
                  <div className="text-xs font-bold text-slate-700">{new Date(l.timestamp).toLocaleString()}</div>
                </td>
                <td className="px-8 py-6">
                   <div className="text-[10px] font-black uppercase text-blue-600">{l.userName}</div>
                </td>
                <td className="px-8 py-6">
                  <span className={`text-[9px] font-black px-2 py-1 rounded border uppercase ${
                    l.type.includes('DELETE') ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100'
                  }`}>
                    {l.type === 'VEHICLE_EDIT' && 'Edição de Ativo'}
                    {l.type === 'VEHICLE_DELETE' && 'Exclusão de Ativo'}
                    {l.type === 'MOVEMENT_DELETE' && 'Exclusão de Movimento'}
                  </span>
                </td>
                <td className="px-8 py-6">
                   <div className="text-[10px] font-bold text-slate-400 uppercase max-w-xs truncate">
                     {l.oldData?.placa_ou_prefixo || l.oldData?.modelo || 'Registro de Combustível'}
                   </div>
                </td>
                <td className="px-8 py-6 text-right">
                  <button 
                    onClick={() => undoAction(l)}
                    className="flex items-center gap-2 ml-auto bg-slate-900 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-black transition-all shadow-sm"
                  >
                    <RefreshCcw size={14} /> Desfazer
                  </button>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-8 py-20 text-center text-slate-300 font-black uppercase text-xs tracking-widest">Nenhuma alteração registrada</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
          {currentUser.role === 'admin' && <SidebarItem icon={<Database size={18} />} label="Auditoria" active={activeTab === 'audit'} onClick={() => { setActiveTab('audit'); setIsSidebarOpen(false); }} />}
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

function FleetView({ vehicles, users, currentUser, logAction }: any) {
  const [showForm, setShowForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<any>(null);
  const [form, setForm] = useState({ tipo: TipoVeiculo.VEICULO, placa_ou_prefixo: '', modelo: '', usa_medida: MedidaUso.KM, odometro_atual: 0, horimetro_atual: 0 });

  const sortedVehicles = useMemo(() => {
    return [...vehicles].sort((a, b) => a.placa_ou_prefixo.localeCompare(b.placa_ou_prefixo));
  }, [vehicles]);

  const saveVehicle = async (v: any) => {
    try {
      const isUpdate = !!v.id;
      const oldVehicle = isUpdate ? vehicles.find((veh: any) => veh.id === v.id) : null;
      const id = v.id || Math.random().toString(36).substr(2, 9);
      
      const vehicleToSave = {
        ...v,
        id,
        usuario_id: v.usuario_id || currentUser.id,
        odometro_inicial: v.odometro_inicial ?? v.odometro_atual,
        horimetro_inicial: v.horimetro_inicial ?? v.horimetro_atual,
        ativo: true
      };

      await setDoc(doc(db, 'vehicles', id), vehicleToSave);
      
      if (isUpdate && oldVehicle) {
        // Log ONLY if there was a change
        if (JSON.stringify(oldVehicle) !== JSON.stringify(vehicleToSave)) {
          await logAction('VEHICLE_EDIT', oldVehicle, vehicleToSave);
        }
      }

      setShowForm(false);
      setEditingVehicle(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'vehicles');
    }
  };

  const deleteVehicle = async (id: string) => {
    const v = vehicles.find((veh: any) => veh.id === id);
    if (!v) return;
    if (confirm('Excluir este ativo?')) {
      try {
        await deleteDoc(doc(db, 'vehicles', id));
        await logAction('VEHICLE_DELETE', v, null);
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `vehicles/${id}`);
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
        {sortedVehicles.map((v: any) => (
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

      {/* Forms/Modals */}
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

      {editingVehicle && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black">Editar Ativo</h3>
              <button onClick={() => setEditingVehicle(null)}><X size={20} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); saveVehicle(editingVehicle); }} className="space-y-4">
              <input required placeholder="Placa / Prefixo" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold uppercase" value={editingVehicle.placa_ou_prefixo} onChange={e => setEditingVehicle({...editingVehicle, placa_ou_prefixo: e.target.value.toUpperCase()})} />
              <input required placeholder="Modelo" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={editingVehicle.modelo} onChange={e => setEditingVehicle({...editingVehicle, modelo: e.target.value})} />
              
              {currentUser.role === 'admin' && (
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 space-y-3">
                  <div className="flex items-center gap-2 text-amber-600 mb-1">
                    <ShieldAlert size={14} />
                    <span className="text-[10px] font-black uppercase">Correção Administrativa</span>
                  </div>
                  <div>
                    <label className="text-[8px] font-black uppercase text-slate-400 ml-2">Leitura Atual ({editingVehicle.usa_medida})</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      className="w-full bg-white border border-amber-200 rounded-xl px-4 py-2.5 font-bold text-sm" 
                      value={editingVehicle.usa_medida === MedidaUso.KM ? editingVehicle.odometro_atual : editingVehicle.horimetro_atual} 
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        if (editingVehicle.usa_medida === MedidaUso.KM) {
                          setEditingVehicle({...editingVehicle, odometro_atual: val});
                        } else {
                          setEditingVehicle({...editingVehicle, horimetro_atual: val});
                        }
                      }} 
                    />
                  </div>
                </div>
              )}
              
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs">Atualizar Ativo</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MovementsView({ movements, vehicles, currentUser, logAction }: any) {
  const [form, setForm] = useState({ tipo: TipoMovimento.CONSUMO, veiculoId: '', motorista: '', litros: '', leitura: '', tanqueId: 'britagem' as 'britagem' | 'obra' });
  const [editingMovement, setEditingMovement] = useState<any>(null);

  const deleteMovement = async (m: any) => {
    if (confirm('Excluir este lançamento?')) {
      try {
        await deleteDoc(doc(db, 'movements', m.id));
        await logAction('MOVEMENT_DELETE', m, null);
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `movements/${m.id}`);
      }
    }
  };

  const saveEditedMovement = async (e: any) => {
    e.preventDefault();
    try {
      const oldM = movements.find((m: any) => m.id === editingMovement.id);
      await setDoc(doc(db, 'movements', editingMovement.id), editingMovement);
      await logAction('MOVEMENT_EDIT', oldM, editingMovement);
      setEditingMovement(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `movements/${editingMovement.id}`);
    }
  };

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
      handleFirestoreError(e, OperationType.WRITE, 'movements');
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
             {currentUser.role === 'admin' && (
               <div className="flex items-center gap-2 ml-4">
                 <button onClick={() => setEditingMovement(m)} className="p-2 text-slate-300 hover:text-blue-500 transition-colors">
                   <Pencil size={16} />
                 </button>
                 <button onClick={() => deleteMovement(m)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                   <Trash2 size={16} />
                 </button>
               </div>
             )}
          </div>
        ))}
      </div>

      {editingMovement && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Editar Lançamento</h3>
            <form onSubmit={saveEditedMovement} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Litros</label>
                <input required type="number" step="0.01" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={Math.abs(editingMovement.litros)} onChange={e => setEditingMovement({...editingMovement, litros: editingMovement.litros < 0 ? -Math.abs(parseFloat(e.target.value)) : Math.abs(parseFloat(e.target.value))})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">KM/Horímetro</label>
                <input type="number" step="0.01" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingMovement.km_informado || editingMovement.horimetro_informado || ''} onChange={e => {
                  const val = parseFloat(e.target.value);
                  if (editingMovement.km_informado !== undefined) setEditingMovement({...editingMovement, km_informado: val});
                  else setEditingMovement({...editingMovement, horimetro_informado: val});
                }} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Data/Hora</label>
                <input type="datetime-local" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingMovement.data_hora.substring(0, 16)} onChange={e => setEditingMovement({...editingMovement, data_hora: e.target.value})} />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs">Salvar Alterações</button>
              <button type="button" onClick={() => setEditingMovement(null)} className="w-full py-2 font-bold text-slate-400">Cancelar</button>
            </form>
          </div>
        </div>
      )}
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
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('all');

  const filteredMovements = useMemo(() => {
    let filtered = movements.filter((m: any) => {
      const date = m.data_hora.split('T')[0];
      return date >= startDate && date <= endDate;
    });

    if (selectedVehicleId !== 'all') {
      filtered = filtered.filter((m: any) => m.veiculo_id === selectedVehicleId);
    }

    // Sort descending by date (Point 1)
    return [...filtered].sort((a, b) => new Date(b.data_hora).getTime() - new Date(a.data_hora).getTime());
  }, [movements, startDate, endDate, selectedVehicleId]);

  const calculateMetric = (m: any, prevM: any, vehicle: any) => {
    if (!prevM || !m || !vehicle) return null;
    
    const liters = Math.abs(m.litros);
    if (liters === 0) return null;

    if (vehicle.usa_medida === MedidaUso.KM) {
      if (m.km_informado && prevM.km_informado) {
        const diff = m.km_informado - prevM.km_informado;
        if (diff <= 0) return null;
        return (diff / liters).toFixed(2) + ' KM/L';
      }
    } else {
      if (m.horimetro_informado && prevM.horimetro_informado) {
        const diff = m.horimetro_informado - prevM.horimetro_informado;
        if (diff <= 0) return null;
        // User asked for Litros/Hora
        return (liters / diff).toFixed(2) + ' L/H';
      }
    }
    return null;
  };

  const exportToExcel = () => {
    const data = filteredMovements.map((m: any) => {
      const vehicle = vehicles.find((v: any) => v.id === m.veiculo_id);
      return {
        'Data/Hora': new Date(m.data_hora).toLocaleString(),
        'Tipo': m.tipo_movimento,
        'Tanque': m.tanque_id,
        'Ativo': vehicle ? vehicle.placa_ou_prefixo : 'N/A',
        'Modelo': vehicle ? vehicle.modelo : 'N/A',
        'Litros': m.litros,
        'Leitura (KM/H)': m.km_informado || m.horimetro_informado || '',
        'Motorista': m.motorista || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Movimentações');
    XLSX.writeFile(workbook, `Relatorio_FuelTrack_${startDate}_a_${endDate}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
          <div>
            <h2 className="text-2xl font-black flex items-center gap-3"><BarChart3 className="text-blue-600" /> Relatórios de Consumo</h2>
            <p className="text-[10px] font-black uppercase text-slate-400 mt-1">Análise de rendimento e exportação</p>
          </div>
          <button 
            onClick={exportToExcel}
            className="w-full md:w-auto bg-green-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-green-100 hover:bg-green-700 transition-all"
          >
            <FileSpreadsheet size={18} /> Exportar Excel
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-100">
           <div className="space-y-1">
             <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Data Inicial</label>
             <div className="relative">
               <Calendar className="absolute left-4 top-3.5 text-slate-400" size={18} />
               <input 
                type="date" 
                className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500/20" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)} 
               />
             </div>
           </div>
           <div className="space-y-1">
             <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Data Final</label>
             <div className="relative">
               <Calendar className="absolute left-4 top-3.5 text-slate-400" size={18} />
               <input 
                type="date" 
                className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500/20" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)} 
               />
             </div>
           </div>
           <div className="space-y-1">
             <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Filtrar Ativo</label>
             <div className="relative">
               <Truck className="absolute left-4 top-3.5 text-slate-400" size={18} />
               <select 
                className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none" 
                value={selectedVehicleId} 
                onChange={e => setSelectedVehicleId(e.target.value)}
               >
                 <option value="all">Todos os Ativos</option>
                 {vehicles.map((v: any) => (
                   <option key={v.id} value={v.id}>{v.placa_ou_prefixo} - {v.modelo}</option>
                 ))}
               </select>
             </div>
           </div>
        </div>

        {selectedVehicleId === 'all' ? (
          <div className="space-y-4">
            <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Consumo Geral por Ativo</h3>
            {vehicles.map((v: any) => {
              const vMs = filteredMovements.filter((m:any) => m.veiculo_id === v.id);
              const sortedVMs = [...vMs].sort((a,b) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime());
              const totalL = Math.abs(vMs.reduce((acc:number, curr:any) => acc + curr.litros, 0));
              
              let periodMetric = 'N/A';
              if (sortedVMs.length >= 2) {
                const first = sortedVMs[0];
                const last = sortedVMs[sortedVMs.length - 1];
                const totalPeriodL = Math.abs(sortedVMs.reduce((acc:number, curr:any) => acc + curr.litros, 0));
                
                if (v.usa_medida === MedidaUso.KM) {
                  const diff = (last.km_informado ?? 0) - (first.km_informado ?? 0);
                  if (diff > 0 && totalPeriodL > 0) periodMetric = (diff / totalPeriodL).toFixed(2) + ' KM/L';
                } else {
                  const diff = (last.horimetro_informado ?? 0) - (first.horimetro_informado ?? 0);
                  if (diff > 0 && totalPeriodL > 0) periodMetric = (totalPeriodL / diff).toFixed(2) + ' L/H';
                }
              }

              return (
                <div key={v.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100/50">
                  <div>
                    <div className="font-black uppercase text-slate-700">{v.placa_ou_prefixo}</div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase">{v.modelo}</div>
                    <div className="text-[9px] font-black text-amber-500 uppercase mt-1">Média: {periodMetric}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black text-slate-900">{totalL.toLocaleString()} <span className="text-xs text-slate-300">L</span></div>
                    <div className="text-[8px] font-black text-blue-500 uppercase tracking-tighter">Total no período</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Histórico de Abastecimentos</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-slate-100">
                  <tr>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400">Data/Hora</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400">Motorista</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Leitura</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Litros</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Rendimento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredMovements.map((m: any, idx: number) => {
                    const vehicle = vehicles.find((v: any) => v.id === m.veiculo_id);
                    // To get the metric, we need the PREVIOUS movement in chronological order 
                    // (since current list is DESC, the previous chronological is idx + 1)
                    // But we must be careful: the list is filtered. 
                    // For better precision, we'd need to find the movement just before this one in the master list.
                    
                    const vehicleAllMovements = movements
                      .filter((allM: any) => allM.veiculo_id === m.veiculo_id)
                      .sort((a: any, b: any) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime());
                    
                    const currentIdx = vehicleAllMovements.findIndex((allM: any) => allM.id === m.id);
                    const prevM = currentIdx > 0 ? vehicleAllMovements[currentIdx - 1] : null;
                    const metric = calculateMetric(m, prevM, vehicle);

                    return (
                      <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-4 text-xs font-bold text-slate-600">
                          {new Date(m.data_hora).toLocaleDateString()} <span className="text-slate-300 ml-1">{new Date(m.data_hora).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </td>
                        <td className="py-4 text-[10px] font-black uppercase text-slate-400">
                          {m.motorista || '-'}
                        </td>
                        <td className="py-4 text-right text-xs font-bold text-slate-600">
                          {m.km_informado?.toLocaleString() || m.horimetro_informado?.toLocaleString() || '-'} 
                          <span className="text-[8px] ml-1 text-slate-300 uppercase">{vehicle?.usa_medida}</span>
                        </td>
                        <td className="py-4 text-right text-xs font-black text-slate-900">
                          {Math.abs(m.litros).toLocaleString()} L
                        </td>
                        <td className="py-4 text-right">
                          {metric ? (
                            <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100">{metric}</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-200 uppercase">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredMovements.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-20 text-center text-[10px] font-black uppercase text-slate-300 tracking-widest">Nenhum registro encontrado no período</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserManagementView({ users, logAction }: any) {
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUser, setNewUser] = useState<Partial<AppUser>>({ name: '', login: '', password: '', role: 'operador', approved: true });
  
  const toggleApproval = async (user: AppUser) => {
    try {
      await setDoc(doc(db, 'users', user.id), {
        ...user,
        approved: !user.approved
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.id}`);
    }
  };

  const saveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await setDoc(doc(db, 'users', editingUser.id), editingUser);
      setEditingUser(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${editingUser.id}`);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const id = Math.random().toString(36).substr(2, 9);
      const userToSave = { ...newUser, id } as AppUser;
      await setDoc(doc(db, 'users', id), userToSave);
      setShowAddForm(false);
      setNewUser({ name: '', login: '', password: '', role: 'operador', approved: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'users');
    }
  };

  const deleteUser = async (id: string) => {
    if (id === 'admin_master_bypass') return alert("O administrador mestre não pode ser removido.");
    const u = users.find((user: any) => user.id === id);
    if (!u) return;
    if (confirm("Excluir este usuário?")) {
      try {
        await deleteDoc(doc(db, 'users', id));
        await logAction('USER_DELETE', u, null);
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `users/${id}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black tracking-tight">Gestão de Equipe</h2>
          <p className="text-[10px] font-black uppercase text-slate-400">Controle de acesso interno</p>
        </div>
        <button onClick={() => setShowAddForm(true)} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-2 shadow-lg hover:bg-blue-700 transition-all">
          <UserPlus size={18} /> Novo Usuário
        </button>
      </div>

      <div className="bg-white rounded-[44px] border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Status</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Nome</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Usuário / ID</th>
              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Senha</th>
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
                    <span className="flex items-center gap-1.5 text-amber-500 text-[10px] font-black uppercase"><AlertCircle size={14} /> Bloqueado</span>
                  )}
                </td>
                <td className="px-8 py-6 font-black uppercase text-slate-700">{u.name}</td>
                <td className="px-8 py-6">
                  <div className="text-xs font-bold text-slate-600">{u.login}</div>
                  <div className={`text-[8px] font-black px-1.5 py-0.5 rounded border inline-block mt-1 uppercase ${u.role === 'admin' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                    {u.role}
                  </div>
                </td>
                <td className="px-8 py-6 text-slate-300 font-mono text-xs select-all hover:text-slate-600 transition-colors">
                  {u.password || '******'}
                </td>
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
                    <button onClick={() => deleteUser(u.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Cadastrar Usuário</h3>
            <form onSubmit={handleAddUser} className="space-y-4">
              <input required placeholder="Nome Completo" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} />
              <input required placeholder="Login (ex: pedro)" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={newUser.login} onChange={e => setNewUser({...newUser, login: e.target.value})} />
              <input required placeholder="Senha de Acesso" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
              <select className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as any})}>
                <option value="operador">Operador (Apenas lançar)</option>
                <option value="admin">Administrador (Acesso Total)</option>
              </select>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs">Criar Usuário</button>
              <button type="button" onClick={() => setShowAddForm(false)} className="w-full py-2 font-bold text-slate-400">Cancelar</button>
            </form>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Editar Usuário</h3>
            <form onSubmit={saveUser} className="space-y-4">
              <input required placeholder="Nome" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.name} onChange={e => setEditingUser({...editingUser, name: e.target.value})} />
              <input required placeholder="Senha" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.password} onChange={e => setEditingUser({...editingUser, password: e.target.value})} />
              <select className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingUser.role} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}>
                <option value="operador">Operador</option>
                <option value="admin">Administrador</option>
              </select>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase shadow-lg">Salvar Alterações</button>
              <button type="button" onClick={() => setEditingUser(null)} className="w-full py-2 font-bold text-slate-400">Cancelar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function LoginView({ setCurrentUser }: { setCurrentUser: (user: AppUser | null) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      // 1. Master Admin Bypass
      if (login === 'admin' && password === 'admin') {
        const adminUser: AppUser = {
          id: 'admin_master_bypass',
          name: 'Administrador Mestre',
          login: 'admin',
          role: 'admin',
          approved: true,
          password: 'admin'
        };
        try {
          await setDoc(doc(db, 'users', adminUser.id), adminUser);
          setCurrentUser(adminUser);
          setLoading(false);
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `users/${adminUser.id}`);
        }
        return;
      }

      // 2. Database Lookup for other users
      const usersRef = collection(db, 'users');
      const uQuery = query(usersRef);
      
      const unsubscribe = onSnapshot(uQuery, (snap) => {
        const found = snap.docs.find(d => {
          const u = d.data();
          return u.login === login && u.password === password;
        });

        if (found) {
          const userData = found.data() as AppUser;
          if (!userData.approved) {
            setError('Sua conta ainda não foi aprovada pelo administrador.');
            setLoading(false);
          } else {
            setCurrentUser(userData);
            setLoading(false);
          }
        } else {
          setError('Usuário ou senha incorretos.');
          setLoading(false);
        }
        unsubscribe(); 
      });

    } catch (e: any) {
      setError('Erro ao validar acesso. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-[40px] p-10 shadow-2xl text-center">
        <div className="bg-blue-600 w-16 h-16 rounded-[22px] flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200"><Droplets className="text-white" size={32} /></div>
        <h2 className="text-3xl font-black mb-2">FuelTrack Pro</h2>
        <p className="text-[10px] font-black uppercase text-slate-400 mb-10 tracking-widest">Acesso Restrito</p>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={18} />
            <p className="text-[10px] font-black uppercase tracking-tight text-left">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <form onSubmit={handleAuth} className="space-y-4 text-left">
            <input required type="text" placeholder="Usuário" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm" value={login} onChange={e => setLogin(e.target.value)} />
            <input required type="password" placeholder="Senha" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm" value={password} onChange={e => setPassword(e.target.value)} />
            <button disabled={loading} type="submit" className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl hover:bg-black transition-colors disabled:opacity-50">
              {loading ? 'Validando...' : 'Entrar Agora'}
            </button>
          </form>
        </div>

        <p className="mt-12 text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-loose">Segurança Criptografada<br/>Interface Administrativa</p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return <div className="h-screen w-full flex items-center justify-center bg-slate-50"><div className="flex flex-col items-center gap-4"><RefreshCcw size={40} className="text-blue-600 animate-spin" /><p className="font-black text-slate-400 uppercase text-[10px] tracking-widest leading-loose">Autenticando Cloud...</p></div></div>;
}
