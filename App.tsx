
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, Truck, Droplets, History, PlusCircle, 
  BarChart3, AlertTriangle, Box, 
  LogOut, ShieldAlert, Settings, AlertCircle, UserPlus, Gauge,
  Pencil, Trash2, X, RefreshCcw, Database, User, ShieldCheck,
  FileSpreadsheet, Calendar, Wrench, Camera, Image, Video
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
import { doc, getDoc, setDoc, deleteDoc, orderBy, onSnapshot, collection, query } from 'firebase/firestore';
import { auth, db } from './src/lib/firebase';
import { 
  TipoVeiculo, MedidaUso, TipoMovimento, VeiculoEquipamento, 
  MovimentoTanque, Tanque, AppUser 
} from './types';

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

export function getMaintenanceAlerts(vehicles: VeiculoEquipamento[]) {
  const alerts: { vehicle: VeiculoEquipamento; type: 'tacografo' | 'oleo'; message: string; severity: 'warning' | 'danger'; daysLeft?: number; kmLeft?: number; hoursLeft?: number }[] = [];
  
  vehicles.forEach(v => {
    if (!v.controle_manutencao) return;
    
    // 1. Tacógrafo validity check
    if (v.tacografo_validade) {
      const expDate = new Date(v.tacografo_validade + 'T00:00:00');
      const today = new Date();
      expDate.setHours(0,0,0,0);
      today.setHours(0,0,0,0);
      
      const diffTime = expDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 15) {
        alerts.push({
          vehicle: v,
          type: 'tacografo',
          message: diffDays < 0 
            ? `Tacógrafo vencido há ${Math.abs(diffDays)} dias (${new Date(v.tacografo_validade + 'T00:00:00').toLocaleDateString('pt-BR')})`
            : `Tacógrafo vence em ${diffDays} dias (${new Date(v.tacografo_validade + 'T00:00:00').toLocaleDateString('pt-BR')})`,
          severity: diffDays < 0 ? 'danger' : 'warning',
          daysLeft: diffDays
        });
      }
    }
    
    // 2. Oil change check
    const odoAtual = v.odometro_atual ?? 0;
    const horAtual = v.horimetro_atual ?? 0;
    
    if (v.usa_medida === MedidaUso.KM) {
      if (v.oleo_km_proxima) {
        const kmLeft = v.oleo_km_proxima - odoAtual;
        if (kmLeft <= 1000) {
          alerts.push({
            vehicle: v,
            type: 'oleo',
            message: kmLeft < 0 
              ? `Troca de óleo vencida há ${Math.abs(kmLeft).toLocaleString()} KM (Limite: ${v.oleo_km_proxima.toLocaleString()} KM / Atual: ${odoAtual.toLocaleString()} KM)`
              : `Troca de óleo próxima! Faltam apenas ${kmLeft.toLocaleString()} KM (Limite: ${v.oleo_km_proxima.toLocaleString()} KM)`,
            severity: kmLeft < 0 ? 'danger' : 'warning',
            kmLeft
          });
        }
      }
    } else {
      // Equipment using Hours
      if (v.oleo_horas_proxima) {
        const hoursLeft = v.oleo_horas_proxima - horAtual;
        if (hoursLeft <= 50) {
          alerts.push({
            vehicle: v,
            type: 'oleo',
            message: hoursLeft < 0 
              ? `Troca de óleo vencida há ${Math.abs(hoursLeft).toLocaleString()} horas (Limite: ${v.oleo_horas_proxima.toLocaleString()} H / Atual: ${horAtual.toLocaleString()} H)`
              : `Troca de óleo próxima! Faltam apenas ${hoursLeft.toLocaleString()} horas (Limite: ${v.oleo_horas_proxima.toLocaleString()} H)`,
            severity: hoursLeft < 0 ? 'danger' : 'warning',
            hoursLeft
          });
        }
      }
    }
  });
  
  return alerts;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'fleet' | 'movements' | 'tank' | 'reports' | 'users' | 'audit' | 'maintenance'>('dashboard');
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [vehicles, setVehicles] = useState<VeiculoEquipamento[]>([]);
  const [movements, setMovements] = useState<MovimentoTanque[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [tanks, setTanks] = useState<Tanque[]>([
    { id: 'britagem', nome: 'Tanque Britagem', capacidade_litros: CAPACITY_BRITAGEM, saldo_atual: 0 },
    { id: 'wagner', nome: 'Tanque Wagner', capacidade_litros: 5000, saldo_atual: 0 },
    { id: 'marcus', nome: 'Tanque Marcus', capacidade_litros: 5000, saldo_atual: 0 },
    { id: 'paulo', nome: 'Tanque Paulo', capacidade_litros: 5000, saldo_atual: 0 },
    { id: 'matheus', nome: 'Tanque Matheus', capacidade_litros: 5000, saldo_atual: 0 },
    { id: 'obra', nome: 'Tanque Obra', capacidade_litros: CAPACITY_OBRA, saldo_atual: 0 },
    { id: 'arla', nome: 'Tanque Arla', capacidade_litros: 3000, saldo_atual: 0 }
  ]);

  const maintenanceAlerts = useMemo(() => getMaintenanceAlerts(vehicles), [vehicles]);

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
      
      // Calculate balanced tanks dynamically
      setTanks(prevTanks => prevTanks.map(tank => {
        if (tank.id === 'arla') {
          const balance = ms.reduce((acc, curr) => acc + (curr.arla_litros || 0), 0);
          return { ...tank, saldo_atual: balance };
        }
        const balance = ms
          .filter(mov => mov.tanque_id === tank.id)
          .reduce((acc, curr) => acc + (curr.litros || 0), 0);
        return { ...tank, saldo_atual: balance };
      }));
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
        alertsCount={maintenanceAlerts.length}
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
            {activeTab === 'dashboard' && <DashboardView tanks={tanks} movements={movements} vehicles={vehicles} setActiveTab={setActiveTab} />}
            {activeTab === 'fleet' && <FleetView vehicles={vehicles} users={users} currentUser={currentUser} logAction={logAction} />}
            {activeTab === 'movements' && <MovementsView movements={movements} vehicles={vehicles} tanks={tanks} users={users} currentUser={currentUser} logAction={logAction} />}
            {activeTab === 'reports' && <ReportsView movements={movements} vehicles={vehicles} tanks={tanks} currentUser={currentUser} logAction={logAction} />}
            {activeTab === 'tank' && <TankView tanks={tanks} movements={movements} />}
            {activeTab === 'users' && currentUser.role === 'admin' && <UserManagementView users={users} logAction={logAction} />}
            {activeTab === 'audit' && currentUser.role === 'admin' && <AuditView logs={logs} logAction={logAction} />}
            {activeTab === 'maintenance' && <MaintenanceView vehicles={vehicles} currentUser={currentUser} logAction={logAction} />}
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
      } else if (log.type === 'MOVEMENT_DELETE' || log.type === 'MOVEMENT_EDIT') {
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
                    {l.type === 'MOVEMENT_EDIT' && 'Edição de Movimento'}
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

function Sidebar({ activeTab, setActiveTab, currentUser, onLogout, isSidebarOpen, setIsSidebarOpen, alertsCount = 0 }: any) {
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
          <SidebarItem icon={<Wrench size={18} />} label="Manutenção" active={activeTab === 'maintenance'} onClick={() => { setActiveTab('maintenance'); setIsSidebarOpen(false); }} badge={
            alertsCount > 0 ? (
              <span className="bg-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                {alertsCount}
              </span>
            ) : undefined
          } />
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

function SidebarItem({ icon, label, active, onClick, badge }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, badge?: React.ReactNode }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-bold transition-all ${
          active 
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' 
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className={active ? 'text-white' : 'text-slate-400'}>{icon}</span>
          <span className="uppercase tracking-wide text-[11px] font-black">{label}</span>
        </div>
        {badge}
      </button>
    </li>
  );
}

function DashboardView({ tanks, movements, vehicles, setActiveTab }: any) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const monthStr = now.toISOString().substring(0, 7);
  const yearStr = now.getFullYear().toString();

  const totalConsumedToday = Math.abs(movements.filter((m: any) => m.litros < 0 && m.data_hora.startsWith(todayStr)).reduce((acc: number, curr: any) => acc + curr.litros, 0));
  const totalConsumedMonth = Math.abs(movements.filter((m: any) => m.litros < 0 && m.data_hora.startsWith(monthStr)).reduce((acc: number, curr: any) => acc + curr.litros, 0));
  const totalConsumedYear = Math.abs(movements.filter((m: any) => m.litros < 0 && m.data_hora.startsWith(yearStr)).reduce((acc: number, curr: any) => acc + curr.litros, 0));
  
  const totalArlaToday = Math.abs(movements.filter((m: any) => (m.arla_litros || 0) < 0 && m.data_hora.startsWith(todayStr)).reduce((acc: number, curr: any) => acc + (curr.arla_litros || 0), 0));
  const totalArlaMonth = Math.abs(movements.filter((m: any) => (m.arla_litros || 0) < 0 && m.data_hora.startsWith(monthStr)).reduce((acc: number, curr: any) => acc + (curr.arla_litros || 0), 0));
  const totalArlaYear = Math.abs(movements.filter((m: any) => (m.arla_litros || 0) < 0 && m.data_hora.startsWith(yearStr)).reduce((acc: number, curr: any) => acc + (curr.arla_litros || 0), 0));

  const alerts = useMemo(() => getMaintenanceAlerts(vehicles), [vehicles]);

  return (
    <div className="space-y-6">
      <header><h2 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tight">Status da Frota</h2></header>
      
      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500 text-white p-2.5 rounded-2xl shrink-0">
              <AlertTriangle size={20} className="animate-pulse" />
            </div>
            <div>
              <div className="text-[10px] font-black text-amber-800 uppercase tracking-wider">Avisos de Manutenção Pendentes</div>
              <div className="text-sm font-bold text-slate-700 mt-0.5">Existem {alerts.length} ativos com alertas de tacógrafo ou óleo pendentes.</div>
            </div>
          </div>
          <button 
            onClick={() => setActiveTab('maintenance')}
            className="w-full sm:w-auto text-[10px] font-black uppercase text-amber-700 bg-amber-100/50 hover:bg-amber-100 px-4 py-2.5 rounded-xl transition-all text-center shrink-0"
          >
            Ver Detalhes
          </button>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Consumo Hoje</div>
          <div className="text-3xl font-black text-blue-600">{totalConsumedToday.toLocaleString()} <span className="text-sm text-slate-300">L</span></div>
          <div className="text-xs font-black text-cyan-600 mt-1 uppercase tracking-wider">Arla: {totalArlaToday.toLocaleString()} L</div>
          <div className="mt-2 h-1 w-12 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600" style={{ width: '60%' }}></div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Consumo Mensal</div>
          <div className="text-3xl font-black text-slate-900">{totalConsumedMonth.toLocaleString()} <span className="text-sm text-slate-300">L</span></div>
          <div className="text-xs font-black text-cyan-600 mt-1 uppercase tracking-wider">Arla: {totalArlaMonth.toLocaleString()} L</div>
          <div className="text-[9px] font-black text-slate-400 mt-2 uppercase">Competência: {new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(now)}</div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Consumo Anual</div>
          <div className="text-3xl font-black text-slate-900">{totalConsumedYear.toLocaleString()} <span className="text-sm text-slate-300">L</span></div>
          <div className="text-xs font-black text-cyan-600 mt-1 uppercase tracking-wider">Arla: {totalArlaYear.toLocaleString()} L</div>
          <div className="text-[9px] font-black text-slate-400 mt-2 uppercase">Acumulado {yearStr}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
        {tanks.sort((a, b) => a.nome.localeCompare(b.nome)).map((t: any) => {
          const percent = Math.min(100, Math.max(0, (t.saldo_atual / t.capacidade_litros) * 100));
          return (
            <div key={t.id} className="md:col-span-3 lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 md:p-8 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
              <div className="space-y-1">
                <h3 className="text-slate-400 text-[10px] font-black uppercase mb-1 tracking-widest">{t.nome}</h3>
                <div className="text-2xl md:text-4xl font-black text-slate-900 mb-2">{Math.max(0, t.saldo_atual).toLocaleString()} <span className="text-sm md:text-base text-slate-300">L</span></div>
                <div className={`text-[10px] font-black uppercase ${t.id === 'arla' ? 'text-cyan-600' : 'text-blue-600'}`}>Capacidade: {t.capacidade_litros.toLocaleString()} L</div>
              </div>
              <div className="w-14 h-14 md:w-16 md:h-16 relative">
                <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                  <circle cx="18" cy="18" r="16" fill="none" className="text-slate-100" strokeWidth="4" stroke="currentColor" />
                  <circle cx="18" cy="18" r="16" fill="none" className={percent < 15 ? 'text-red-500' : (t.id === 'arla' ? 'text-cyan-500' : 'text-blue-600')} strokeWidth="4" strokeDasharray={`${percent}, 100`} strokeLinecap="round" stroke="currentColor" />
                </svg>
              </div>
            </div>
          );
        })}
        <div className="md:col-span-3 lg:col-span-3 bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm flex flex-row md:flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            <Truck className="text-blue-600" size={32} />
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase">Frota Ativa</div>
              <div className="text-2xl font-black">{vehicles.length} Ativos</div>
            </div>
          </div>
        </div>
        <div className="md:col-span-3 lg:col-span-3 bg-slate-900 rounded-3xl p-6 md:p-8 text-white shadow-xl flex flex-row md:flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            <Droplets className="text-blue-500" size={32} />
            <div className="space-y-1">
              <div className="text-[10px] font-black opacity-60 uppercase">Saldos Totais</div>
              <div className="text-xl font-black">Diesel: {tanks.filter((t: any) => t.id !== 'arla').reduce((acc: any, t: any) => acc + t.saldo_atual, 0).toLocaleString()} L</div>
              <div className="text-sm font-black text-cyan-400">Arla: {tanks.filter((t: any) => t.id === 'arla').reduce((acc: any, t: any) => acc + t.saldo_atual, 0).toLocaleString()} L</div>
            </div>
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
                <div className="font-bold text-blue-600">{v.usa_medida === MedidaUso.KM ? `${(v.odometro_atual ?? 0).toLocaleString()} KM` : `${(v.horimetro_atual ?? 0).toLocaleString()} H`}</div>
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

const resizeAndCompressImage = (file: File, maxWidth = 800, maxHeight = 800): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        } else {
          resolve(event.target?.result as string);
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

function MovementsView({ movements, vehicles, tanks, currentUser, logAction }: any) {
  const [form, setForm] = useState({ tipo: TipoMovimento.CONSUMO, veiculoId: '', motorista: '', litros: '', arlaLitros: '', leitura: '', tanqueId: 'britagem' });
  const [totalValue, setTotalValue] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<string>('');
  const [freightValue, setFreightValue] = useState<string>('');
  const [arlaTotalValue, setArlaTotalValue] = useState<string>('');
  const [arlaUnitPrice, setArlaUnitPrice] = useState<string>('');
  const [editingMovement, setEditingMovement] = useState<any>(null);
  const [dataLancamento, setDataLancamento] = useState<string>('');
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const [successMovDetails, setSuccessMovDetails] = useState<any>(null);
  const [fotoLeitura, setFotoLeitura] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  const handleUnitPriceInput = (val: string) => {
    setUnitPrice(val);
    const lits = parseFloat(form.litros) || 0;
    const unitPriceNum = parseFloat(val) || 0;
    const freightNum = parseFloat(freightValue) || 0;
    if (lits > 0 && unitPriceNum > 0) {
      setTotalValue((unitPriceNum * lits + freightNum).toFixed(2));
    }
  };

  const handleFreightInput = (val: string) => {
    setFreightValue(val);
    const lits = parseFloat(form.litros) || 0;
    const unitPriceNum = parseFloat(unitPrice) || 0;
    const freightNum = parseFloat(val) || 0;
    if (lits > 0 && unitPriceNum > 0) {
      setTotalValue((unitPriceNum * lits + freightNum).toFixed(2));
    }
  };

  const handleTotalNFInput = (val: string) => {
    setTotalValue(val);
    const lits = parseFloat(form.litros) || 0;
    const totalNum = parseFloat(val) || 0;
    const freightNum = parseFloat(freightValue) || 0;
    if (lits > 0 && totalNum > 0) {
      const dieselPart = totalNum - freightNum;
      setUnitPrice(dieselPart > 0 ? (dieselPart / lits).toFixed(3) : '0.000');
    }
  };

  const handleArlaUnitPriceInput = (val: string) => {
    setArlaUnitPrice(val);
    const lits = parseFloat(form.arlaLitros) || 0;
    const unitPriceNum = parseFloat(val) || 0;
    if (lits > 0 && unitPriceNum > 0) {
      setArlaTotalValue((unitPriceNum * lits).toFixed(2));
    }
  };

  const handleArlaTotalNFInput = (val: string) => {
    setArlaTotalValue(val);
    const lits = parseFloat(form.arlaLitros) || 0;
    const totalNum = parseFloat(val) || 0;
    if (lits > 0 && totalNum > 0) {
      setArlaUnitPrice((totalNum / lits).toFixed(3));
    }
  };
  
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
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

    return filtered;
  }, [movements, startDate, endDate, selectedVehicleId]);

  const deleteMovement = async (m: any) => {
    if (confirm('Deseja realmente excluir este lançamento? Esta ação não pode ser desfeita.')) {
      try {
        await deleteDoc(doc(db, 'movements', m.id));
        await logAction('MOVEMENT_DELETE', m, null);
        // Feedback success is implicit as Firestore will sync and UI will update
      } catch (e: any) {
        console.error("Delete error:", e);
        alert(`Erro ao excluir: ${e.message || 'Verifique suas permissões'}`);
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
      const dieselLitros = parseFloat(form.litros) || 0;
      const arlaLitros = parseFloat(form.arlaLitros) || 0;

      if (form.tanqueId === 'arla') {
        if (arlaLitros === 0) {
          alert("Por favor, insira a quantidade de Arla.");
          return;
        }
      } else {
        if (dieselLitros === 0 && arlaLitros === 0) {
          alert("Por favor, insira a quantidade de Diesel ou de Arla.");
          return;
        }
      }

      const id = Math.random().toString(36).substr(2, 9);
      const mov = {
        id,
        tipo_movimento: form.tipo,
        veiculo_id: form.tipo === TipoMovimento.CONSUMO ? form.veiculoId : null,
        tanque_id: form.tipo === TipoMovimento.CONSUMO ? form.tanqueId : form.tanqueId, // Always use form.tanqueId
        litros: form.tipo === TipoMovimento.CONSUMO ? -Math.abs(dieselLitros) : Math.abs(dieselLitros),
        arla_litros: form.tipo === TipoMovimento.CONSUMO ? -Math.abs(arlaLitros) : Math.abs(arlaLitros),
        km_informado: form.tipo === TipoMovimento.CONSUMO ? parseFloat(form.leitura) : null,
        horimetro_informado: form.tipo === TipoMovimento.CONSUMO ? parseFloat(form.leitura) : null,
        motorista: form.motorista,
        data_hora: dataLancamento ? new Date(dataLancamento).toISOString() : new Date().toISOString(),
        usuario_id: currentUser.id,
        valor_total: totalValue ? parseFloat(totalValue) : null,
        valor_unitario: unitPrice ? parseFloat(unitPrice) : null,
        valor_frete: freightValue ? parseFloat(freightValue) : null,
        arla_valor_total: arlaTotalValue ? parseFloat(arlaTotalValue) : null,
        arla_valor_unitario: arlaUnitPrice ? parseFloat(arlaUnitPrice) : null,
        observacoes: '',
        foto_leitura: form.tipo === TipoMovimento.CONSUMO ? (fotoLeitura || null) : null
      };

      await setDoc(doc(db, 'movements', id), mov);

      // Automatic transfer logic (Point 2)
      if (form.tipo === TipoMovimento.CONSUMO && form.tanqueId === 'britagem' && form.veiculoId) {
        const v = vehicles.find((vi:any) => vi.id === form.veiculoId);
        if (v) {
          const placa = v.placa_ou_prefixo.toUpperCase();
          let targetTankId = '';
          
          if (placa.includes('APOIO 1') || placa.includes('PAULO')) targetTankId = 'paulo';
          else if (placa.includes('APOIO 2') || placa.includes('MARCUS')) targetTankId = 'marcus';
          else if (placa.includes('APOIO 3') || placa.includes('WAGNER')) targetTankId = 'wagner';
          else if (placa.includes('APOIO 4') || placa.includes('MATHEUS')) targetTankId = 'matheus';

          if (targetTankId) {
            const transferId = Math.random().toString(36).substr(2, 9);
            const transferMov = {
              ...mov,
              id: transferId,
              tanque_id: targetTankId,
              tipo_movimento: TipoMovimento.ENTRADA,
              litros: Math.abs(dieselLitros),
              arla_litros: Math.abs(arlaLitros),
              veiculo_id: null,
              observacoes: `Transferência automática via ${v.placa_ou_prefixo}`
            };
            await setDoc(doc(db, 'movements', transferId), transferMov);
          }
        }
      }

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

      // Store success details for the confirmation modal
      const veiculoObj = form.tipo === TipoMovimento.CONSUMO ? vehicles.find((vi: any) => vi.id === form.veiculoId) : null;
      setSuccessMovDetails({
        tipo: form.tipo,
        tanque: form.tanqueId,
        diesel: dieselLitros,
        arla: arlaLitros,
        veiculo: veiculoObj ? `${veiculoObj.placa_ou_prefixo} - ${veiculoObj.modelo}` : null,
        leitura: form.tipo === TipoMovimento.CONSUMO ? form.leitura : null,
        motorista: form.tipo === TipoMovimento.CONSUMO ? form.motorista : null,
        foto_leitura: form.tipo === TipoMovimento.CONSUMO ? (fotoLeitura || null) : null
      });
      setShowSuccessModal(true);

      // Reset all form and state fields to keep them clean for the next entry
      setForm({
        tipo: form.tipo,
        veiculoId: '',
        motorista: '',
        litros: '',
        arlaLitros: '',
        leitura: '',
        tanqueId: 'britagem'
      });
      setTotalValue('');
      setUnitPrice('');
      setFreightValue('');
      setArlaTotalValue('');
      setArlaUnitPrice('');
      setDataLancamento('');
      setFotoLeitura('');
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
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Tipo de Operação</label>
              <select className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value as any})}>
                <option value={TipoMovimento.CONSUMO}>Saída (Abastecimento)</option>
                <option value={TipoMovimento.ENTRADA}>Entrada de Diesel (NF)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Data/Hora de Lançamento (Opcional)</label>
              <input 
                type="datetime-local" 
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold font-mono text-xs text-slate-700" 
                value={dataLancamento} 
                onChange={e => setDataLancamento(e.target.value)} 
              />
              <p className="text-[8px] font-black text-slate-400 ml-2 uppercase tracking-tighter">Deixe vazio para utilizar a data/hora corrente de hoje</p>
            </div>

            {form.tipo === TipoMovimento.ENTRADA && (
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Tanque de Destino</label>
                <select className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.tanqueId} onChange={e => {
                  const newTankId = e.target.value;
                  if (newTankId === 'arla') {
                    setForm({
                      ...form,
                      tanqueId: newTankId,
                      litros: ''
                    });
                    setTotalValue('');
                    setUnitPrice('');
                    setFreightValue('');
                  } else {
                    setForm({
                      ...form,
                      tanqueId: newTankId
                    });
                  }
                }}>
                  <option value="britagem">Tanque Britagem</option>
                  <option value="wagner">Tanque Wagner</option>
                  <option value="marcus">Tanque Marcus</option>
                  <option value="paulo">Tanque Paulo</option>
                  <option value="matheus">Tanque Matheus</option>
                  <option value="obra">Tanque Obra</option>
                  <option value="arla">Tanque Arla</option>
                </select>
              </div>
            )}

            <div className="space-y-4">
              {form.tanqueId !== 'arla' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Quantidade de Diesel (Litros)</label>
                  <input 
                    placeholder="0,00 L" 
                    type="number" 
                    step="0.01" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-black text-2xl focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" 
                    value={form.litros} 
                    onChange={e => {
                      const val = e.target.value;
                      setForm({...form, litros: val});
                      const lits = parseFloat(val) || 0;
                      if (lits > 0) {
                        if (unitPrice) {
                          const unitPriceNum = parseFloat(unitPrice) || 0;
                          const freightNum = parseFloat(freightValue) || 0;
                          setTotalValue((unitPriceNum * lits + freightNum).toFixed(2));
                        } else if (totalValue) {
                          const totalNum = parseFloat(totalValue) || 0;
                          const freightNum = parseFloat(freightValue) || 0;
                          const dieselPart = totalNum - freightNum;
                          setUnitPrice(dieselPart > 0 ? (dieselPart / lits).toFixed(3) : '0.000');
                        }
                      }
                    }} 
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-cyan-600 ml-2">Quantidade de Arla (Litros)</label>
                <input 
                  placeholder="0,00 L" 
                  type="number" 
                  step="0.01" 
                  className="w-full bg-slate-50 border border-cyan-200 rounded-2xl px-5 py-4 font-black text-2xl text-cyan-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none" 
                  value={form.arlaLitros} 
                  onChange={e => {
                    const val = e.target.value;
                    setForm({...form, arlaLitros: val});
                    const lits = parseFloat(val) || 0;
                    if (lits > 0) {
                      if (arlaUnitPrice) {
                        const unitPriceNum = parseFloat(arlaUnitPrice) || 0;
                        setArlaTotalValue((unitPriceNum * lits).toFixed(2));
                      } else if (arlaTotalValue) {
                        const totalNum = parseFloat(arlaTotalValue) || 0;
                        setArlaUnitPrice((totalNum / lits).toFixed(3));
                      }
                    }
                  }} 
                />
              </div>
            </div>

            {(form.tipo === TipoMovimento.ENTRADA || form.tipo === TipoMovimento.ENTRADA_BRITAGEM || form.tipo === TipoMovimento.ENTRADA_OBRA) && (
              <div className="space-y-4">
                {(parseFloat(form.litros) || 0) > 0 && (
                  <div className="p-5 bg-gradient-to-br from-blue-50/70 to-indigo-50/50 border border-blue-100 rounded-2xl space-y-4 shadow-inner">
                    <div className="text-[10px] font-black uppercase text-blue-500 tracking-wider">Custo do Diesel</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                         <label className="text-[8px] font-black uppercase text-slate-400">Preço Unitário (R$/L)</label>
                         <input 
                           type="number" 
                           step="0.001" 
                           placeholder="R$ 0,000" 
                           className="w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold" 
                           value={unitPrice} 
                           onChange={e => handleUnitPriceInput(e.target.value)} 
                         />
                      </div>
                      <div className="space-y-1">
                         <label className="text-[8px] font-black uppercase text-slate-400">Valor do Frete (R$)</label>
                         <input 
                           type="number" 
                           step="0.01" 
                           placeholder="R$ 0,00" 
                           className="w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold" 
                           value={freightValue} 
                           onChange={e => handleFreightInput(e.target.value)} 
                         />
                      </div>
                    </div>
                    <div className="space-y-1">
                       <label className="text-[8px] font-black uppercase text-slate-400">Valor Total NF Diesel (R$)</label>
                       <input 
                         type="number" 
                         step="0.01" 
                         placeholder="R$ 0,00" 
                         className="w-full bg-white border border-blue-100 rounded-xl px-3 py-2 text-xs font-bold" 
                         value={totalValue} 
                         onChange={e => handleTotalNFInput(e.target.value)} 
                       />
                    </div>
                  </div>
                )}

                {(parseFloat(form.arlaLitros) || 0) > 0 && (
                  <div className="p-5 bg-gradient-to-br from-cyan-50/70 to-teal-50/50 border border-cyan-100 rounded-2xl space-y-4 shadow-inner">
                    <div className="text-[10px] font-black uppercase text-cyan-600 tracking-wider">Custo do Arla</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                         <label className="text-[8px] font-black uppercase text-slate-400">Preço Unitário (R$/L)</label>
                         <input 
                           type="number" 
                           step="0.001" 
                           placeholder="R$ 0,000" 
                           className="w-full bg-white border border-cyan-100 rounded-xl px-3 py-2 text-xs font-bold" 
                           value={arlaUnitPrice} 
                           onChange={e => handleArlaUnitPriceInput(e.target.value)} 
                         />
                      </div>
                      <div className="space-y-1">
                         <label className="text-[8px] font-black uppercase text-slate-400">Valor Total Arla (R$)</label>
                         <input 
                           type="number" 
                           step="0.01" 
                           placeholder="R$ 0,00" 
                           className="w-full bg-white border border-cyan-100 rounded-xl px-3 py-2 text-xs font-bold" 
                           value={arlaTotalValue} 
                           onChange={e => handleArlaTotalNFInput(e.target.value)} 
                         />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {form.tipo === TipoMovimento.CONSUMO && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Tanque de Origem</label>
                  <select required className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-bold" value={form.tanqueId} onChange={e => {
                    const newTankId = e.target.value;
                    if (newTankId === 'arla') {
                      setForm({
                        ...form,
                        tanqueId: newTankId,
                        litros: ''
                      });
                    } else {
                      setForm({
                        ...form,
                        tanqueId: newTankId
                      });
                    }
                  }}>
                    <option value="britagem">Tanque Britagem</option>
                    <option value="wagner">Tanque Wagner</option>
                    <option value="marcus">Tanque Marcus</option>
                    <option value="paulo">Tanque Paulo</option>
                    <option value="matheus">Tanque Matheus</option>
                    <option value="obra">Tanque Obra</option>
                    <option value="arla">Tanque Arla</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Ativo</label>
                  <select required className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.veiculoId} onChange={e => setForm({...form, veiculoId: e.target.value})}>
                    <option value="">Selecione Ativo</option>
                    {[...vehicles].sort((a, b) => a.placa_ou_prefixo.localeCompare(b.placa_ou_prefixo)).map((v:any) => <option key={v.id} value={v.id}>{v.placa_ou_prefixo} - {v.modelo}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Leitura Atual (KM/H)</label>
                  <input placeholder="000.00" required type="number" step="0.01" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.leitura} onChange={e => setForm({...form, leitura: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Motorista / Operador</label>
                  <input placeholder="Nome completo" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={form.motorista} onChange={e => setForm({...form, motorista: e.target.value})} />
                </div>
                
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Foto da Leitura (Bomba/Painel) - Opcional</label>
                  {fotoLeitura ? (
                    <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-2 flex flex-col items-center">
                      <img src={fotoLeitura} alt="Foto leitura" className="max-h-48 object-contain rounded-xl w-full" referrerPolicy="no-referrer" />
                      <button 
                        type="button" 
                        onClick={() => setFotoLeitura('')} 
                        className="mt-2 text-xs font-black text-red-500 uppercase tracking-wider flex items-center gap-1 hover:text-red-700 transition-colors"
                      >
                        <Trash2 size={12} /> Remover Foto
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col items-center justify-center p-4 border border-dashed border-slate-300 rounded-2xl cursor-pointer hover:bg-slate-50 transition-all text-center">
                        <Camera className="text-slate-400 mb-1" size={20} />
                        <span className="text-[9px] font-black uppercase text-slate-500">Tirar Foto</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          capture="environment" 
                          className="hidden" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const compressed = await resizeAndCompressImage(file);
                                setFotoLeitura(compressed);
                              } catch (err) {
                                console.error("Error processing camera image:", err);
                              }
                            }
                          }} 
                        />
                      </label>
                      <label className="flex flex-col items-center justify-center p-4 border border-dashed border-slate-300 rounded-2xl cursor-pointer hover:bg-slate-50 transition-all text-center">
                        <Image className="text-slate-400 mb-1" size={20} />
                        <span className="text-[9px] font-black uppercase text-slate-500">Galeria</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const compressed = await resizeAndCompressImage(file);
                                setFotoLeitura(compressed);
                              } catch (err) {
                                console.error("Error processing gallery image:", err);
                              }
                            }
                          }} 
                        />
                      </label>
                    </div>
                  )}
                </div>
              </>
            )}
            <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase text-xs shadow-xl hover:bg-blue-700 transition-all">Lançar Registro</button>
          </form>
        </div>
      </div>
      <div className="lg:col-span-8 space-y-4">
        {/* Filters and List Header */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Período</label>
              <div className="flex items-center gap-2">
                <input type="date" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold" value={startDate} onChange={e => setStartDate(e.target.value)} />
                <span className="text-slate-300">/</span>
                <input type="date" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Ativo</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold" 
                value={selectedVehicleId} 
                onChange={e => setSelectedVehicleId(e.target.value)}
              >
                <option value="all">Todos os Ativos</option>
                {[...vehicles].sort((a, b) => a.placa_ou_prefixo.localeCompare(b.placa_ou_prefixo)).map((v: any) => (
                  <option key={v.id} value={v.id}>{v.placa_ou_prefixo} - {v.modelo}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {filteredMovements.map((m: any) => (
          <div key={m.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex justify-between items-center">
             <div className="flex items-center gap-4 flex-1 min-w-0">
                {m.foto_leitura && (
                  <button 
                    onClick={() => setViewingPhoto(m.foto_leitura)} 
                    className="flex-shrink-0 relative group focus:outline-none"
                    title="Ver foto do leitor"
                  >
                    <img 
                      src={m.foto_leitura} 
                      alt="Miniatura Leitura" 
                      className="w-14 h-14 object-cover rounded-2xl border border-slate-200 shadow-sm group-hover:brightness-90 transition-all duration-200" 
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-slate-950/20 opacity-0 group-hover:opacity-100 rounded-2xl flex items-center justify-center transition-opacity duration-200">
                      <Camera size={14} className="text-white" />
                    </div>
                  </button>
                )}
                <div className="min-w-0">
                   <div className="text-[10px] font-black text-slate-400 uppercase">{new Date(m.data_hora).toLocaleString()}</div>
                   <div className="font-bold text-slate-900 uppercase truncate">
                     {m.tipo_movimento === TipoMovimento.CONSUMO 
                       ? `Saída: ${vehicles.find((v:any) => v.id === m.veiculo_id)?.placa_ou_prefixo || '?'}` 
                       : (m.tanque_id === 'arla' ? 'Entrada de Arla' : 'Entrada de Combustível')}
                   </div>
                   <div className="text-[9px] font-black text-blue-500 uppercase">
                     {m.tipo_movimento} | Tanque: {tanks.find((t:any) => t.id === m.tanque_id)?.nome || m.tanque_id}
                   </div>
                   {m.observacoes && (
                     <div className="text-[9px] font-bold text-amber-500 uppercase mt-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 inline-block">
                       {m.observacoes}
                     </div>
                   )}
                </div>
             </div>
             <div className="text-right flex-shrink-0">
                {m.litros !== undefined && m.litros !== null && m.litros !== 0 && (
                  <div className={`text-xl font-black ${m.litros > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {m.litros > 0 ? '+' : ''}{(m.litros ?? 0).toLocaleString()} L Diesel
                  </div>
                )}
                {m.arla_litros !== undefined && m.arla_litros !== null && m.arla_litros !== 0 && (
                  <div className={`text-sm font-bold ${m.arla_litros > 0 ? 'text-cyan-600' : 'text-cyan-500'}`}>
                    {m.arla_litros > 0 ? '+' : ''}{(m.arla_litros ?? 0).toLocaleString()} L Arla
                  </div>
                )}
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
        {filteredMovements.length === 0 && (
          <div className="p-20 text-center text-slate-300 font-black uppercase text-xs tracking-widest bg-white rounded-3xl border border-dashed border-slate-200">
            Nenhum lançamento encontrado
          </div>
        )}
      </div>

      {editingMovement && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Editar Lançamento</h3>
            <form onSubmit={saveEditedMovement} className="space-y-4">
              {editingMovement.tanque_id !== 'arla' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Litros (Diesel)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                    value={Math.abs(editingMovement.litros || 0)} 
                    onChange={e => {
                      const lits = Math.abs(parseFloat(e.target.value)) || 0;
                      if (editingMovement.tipo_movimento === TipoMovimento.CONSUMO) {
                        setEditingMovement({...editingMovement, litros: -lits});
                      } else {
                        const fVal = parseFloat(editingMovement.valor_frete) || 0;
                        const uVal = parseFloat(editingMovement.valor_unitario) || 0;
                        setEditingMovement({
                          ...editingMovement,
                          litros: lits,
                          valor_total: parseFloat((uVal * lits + fVal).toFixed(2))
                        });
                      }
                    }} 
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-cyan-600 ml-2">Litros (Arla)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="w-full bg-slate-50 border border-cyan-200 rounded-2xl px-5 py-3.5 font-bold text-cyan-700" 
                  value={Math.abs(editingMovement.arla_litros || 0)} 
                  onChange={e => {
                    const arlaLits = Math.abs(parseFloat(e.target.value)) || 0;
                    if (editingMovement.tipo_movimento === TipoMovimento.CONSUMO) {
                      setEditingMovement({...editingMovement, arla_litros: -arlaLits});
                    } else {
                      const uVal = parseFloat(editingMovement.arla_valor_unitario) || 0;
                      setEditingMovement({
                        ...editingMovement,
                        arla_litros: arlaLits,
                        arla_valor_total: parseFloat((uVal * arlaLits).toFixed(2))
                      });
                    }
                  }} 
                />
              </div>

              {(editingMovement.tipo_movimento === TipoMovimento.ENTRADA || 
                editingMovement.tipo_movimento === TipoMovimento.ENTRADA_BRITAGEM || 
                editingMovement.tipo_movimento === TipoMovimento.ENTRADA_OBRA) ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Preço Unitário (R$/L)</label>
                    <input 
                      type="number" 
                      step="0.001" 
                      className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                      value={editingMovement.valor_unitario || ''} 
                      onChange={e => {
                        const unit = parseFloat(e.target.value) || 0;
                        const lits = Math.abs(editingMovement.litros) || 0;
                        const fr = parseFloat(editingMovement.valor_frete) || 0;
                        setEditingMovement({
                          ...editingMovement,
                          valor_unitario: unit,
                          valor_total: parseFloat((unit * lits + fr).toFixed(2))
                        });
                      }} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Valor do Frete (R$)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                      value={editingMovement.valor_frete || ''} 
                      onChange={e => {
                        const fr = parseFloat(e.target.value) || 0;
                        const unit = parseFloat(editingMovement.valor_unitario) || 0;
                        const lits = Math.abs(editingMovement.litros) || 0;
                        setEditingMovement({
                          ...editingMovement,
                          valor_frete: fr,
                          valor_total: parseFloat((unit * lits + fr).toFixed(2))
                        });
                      }} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Valor Total NF (R$)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                      value={editingMovement.valor_total || ''} 
                      onChange={e => {
                        const tot = parseFloat(e.target.value) || 0;
                        const fr = parseFloat(editingMovement.valor_frete) || 0;
                        const lits = Math.abs(editingMovement.litros) || 0;
                        const unit = lits > 0 ? parseFloat(((tot - fr) / lits).toFixed(3)) : 0;
                        setEditingMovement({
                          ...editingMovement,
                          valor_total: tot,
                          valor_unitario: unit > 0 ? unit : 0
                        });
                      }} 
                    />
                  </div>

                  <div className="p-3 bg-cyan-50/50 border border-cyan-100 rounded-2xl space-y-3 mt-2">
                    <div className="text-[9px] font-black uppercase text-cyan-600">Arla Financeiro</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[8px] font-black uppercase text-slate-400">Arla Unitário (R$/L)</label>
                        <input 
                          type="number" 
                          step="0.001" 
                          className="w-full bg-white border border-cyan-100 rounded-xl px-3 py-1.5 text-xs font-bold" 
                          value={editingMovement.arla_valor_unitario || ''} 
                          onChange={e => {
                            const unit = parseFloat(e.target.value) || 0;
                            const lits = Math.abs(editingMovement.arla_litros) || 0;
                            setEditingMovement({
                              ...editingMovement,
                              arla_valor_unitario: unit,
                              arla_valor_total: parseFloat((unit * lits).toFixed(2))
                            });
                          }} 
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black uppercase text-slate-400">Arla Total (R$)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          className="w-full bg-white border border-cyan-100 rounded-xl px-3 py-1.5 text-xs font-bold" 
                          value={editingMovement.arla_valor_total || ''} 
                          onChange={e => {
                            const tot = parseFloat(e.target.value) || 0;
                            const lits = Math.abs(editingMovement.arla_litros) || 0;
                            const unit = lits > 0 ? parseFloat((tot / lits).toFixed(3)) : 0;
                            setEditingMovement({
                              ...editingMovement,
                              arla_valor_total: tot,
                              arla_valor_unitario: unit > 0 ? unit : 0
                            });
                          }} 
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">KM/Horímetro</label>
                    <input type="number" step="0.01" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingMovement.km_informado || editingMovement.horimetro_informado || ''} onChange={e => {
                      const val = parseFloat(e.target.value);
                      if (editingMovement.km_informado !== undefined) setEditingMovement({...editingMovement, km_informado: val});
                      else setEditingMovement({...editingMovement, horimetro_informado: val});
                    }} />
                  </div>
                  {editingMovement.tipo_movimento === TipoMovimento.CONSUMO && (
                    currentUser?.role === 'admin' ? (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Ativo (Admin)</label>
                        <select 
                          required 
                          className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                          value={editingMovement.veiculo_id || ''} 
                          onChange={e => setEditingMovement({...editingMovement, veiculo_id: e.target.value})}
                        >
                          <option value="">Selecione Ativo</option>
                          {[...vehicles].sort((a, b) => a.placa_ou_prefixo.localeCompare(b.placa_ou_prefixo)).map((v:any) => (
                            <option key={v.id} value={v.id}>{v.placa_ou_prefixo} - {v.modelo}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Ativo</label>
                        <input 
                          type="text" 
                          readOnly 
                          disabled
                          className="w-full bg-slate-100 border text-slate-500 rounded-2xl px-5 py-3.5 font-bold" 
                          value={vehicles.find((v: any) => v.id === editingMovement.veiculo_id)?.placa_ou_prefixo || 'Nenhum'} 
                        />
                      </div>
                    )
                  )}
                  {editingMovement.tipo_movimento === TipoMovimento.CONSUMO && (
                    currentUser?.role === 'admin' ? (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Motorista / Condutor (Admin)</label>
                        <input 
                          type="text"
                          className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                          value={editingMovement.motorista || ''} 
                          onChange={e => setEditingMovement({...editingMovement, motorista: e.target.value})} 
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Motorista / Condutor</label>
                        <input 
                          type="text" 
                          readOnly 
                          disabled
                          className="w-full bg-slate-100 border text-slate-500 rounded-2xl px-5 py-3.5 font-bold" 
                          value={editingMovement.motorista || ''} 
                        />
                      </div>
                    )
                  )}
                </>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Tanque de Destino / Origem</label>
                <select className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingMovement.tanque_id} onChange={e => {
                  const newTankId = e.target.value;
                  if (newTankId === 'arla') {
                    setEditingMovement({
                      ...editingMovement,
                      tanque_id: newTankId,
                      litros: 0,
                      valor_total: null,
                      valor_unitario: null,
                      valor_frete: null
                    });
                  } else {
                    setEditingMovement({
                      ...editingMovement,
                      tanque_id: newTankId
                    });
                  }
                }}>
                  <option value="britagem">Tanque Britagem</option>
                  <option value="wagner">Tanque Wagner</option>
                  <option value="marcus">Tanque Marcus</option>
                  <option value="paulo">Tanque Paulo</option>
                  <option value="matheus">Tanque Matheus</option>
                  <option value="obra">Tanque Obra</option>
                  <option value="arla">Tanque Arla</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Observações</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                  value={editingMovement.observacoes || ''} 
                  onChange={e => setEditingMovement({...editingMovement, observacoes: e.target.value})} 
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Data/Hora</label>
                <input type="datetime-local" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingMovement.data_hora.substring(0, 16)} onChange={e => setEditingMovement({...editingMovement, data_hora: e.target.value})} />
              </div>

              {editingMovement.foto_leitura ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Foto da Leitura</label>
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-2 flex flex-col items-center">
                    <img src={editingMovement.foto_leitura} alt="Foto leitura" className="max-h-32 object-contain rounded-xl w-full" referrerPolicy="no-referrer" />
                    <button 
                      type="button" 
                      onClick={() => setEditingMovement({...editingMovement, foto_leitura: null})} 
                      className="mt-2 text-xs font-black text-red-500 uppercase tracking-wider flex items-center gap-1 hover:text-red-700 transition-colors"
                    >
                      <Trash2 size={12} /> Remover Foto
                    </button>
                  </div>
                </div>
              ) : (
                editingMovement.tipo_movimento === TipoMovimento.CONSUMO && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Adicionar Foto da Leitura</label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col items-center justify-center p-3 border border-dashed border-slate-300 rounded-2xl cursor-pointer hover:bg-slate-50 transition-all text-center">
                        <Camera className="text-slate-400 mb-1" size={16} />
                        <span className="text-[8px] font-black uppercase text-slate-500">Tirar Foto</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          capture="environment" 
                          className="hidden" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const compressed = await resizeAndCompressImage(file);
                                setEditingMovement({...editingMovement, foto_leitura: compressed});
                              } catch (err) {
                                console.error("Error processing camera image:", err);
                              }
                            }
                          }} 
                        />
                      </label>
                      <label className="flex flex-col items-center justify-center p-3 border border-dashed border-slate-300 rounded-2xl cursor-pointer hover:bg-slate-50 transition-all text-center">
                        <Image className="text-slate-400 mb-1" size={16} />
                        <span className="text-[8px] font-black uppercase text-slate-500">Galeria</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const compressed = await resizeAndCompressImage(file);
                                setEditingMovement({...editingMovement, foto_leitura: compressed});
                              } catch (err) {
                                console.error("Error processing gallery image:", err);
                              }
                            }
                          }} 
                        />
                      </label>
                    </div>
                  </div>
                )
              )}

              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs animate-pulse">Salvar Alterações</button>
              <button type="button" onClick={() => setEditingMovement(null)} className="w-full py-2 font-bold text-slate-400">Cancelar</button>
            </form>
          </div>
        </div>
      )}

      {showSuccessModal && successMovDetails && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl text-center border border-slate-100"
          >
            <div className="bg-green-100 text-green-600 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 shadow-inner">
              <ShieldCheck size={32} />
            </div>
            
            <h3 className="text-xl font-black text-slate-800 tracking-tight">Lançamento Confirmado!</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Lançamento efetuado com sucesso</p>
            
            <div className="my-6 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-left space-y-2">
              <div className="flex justify-between text-xs font-bold border-b border-slate-100 pb-1.5">
                <span className="text-slate-400 uppercase text-[9px] font-black">Operação</span>
                <span className="text-slate-700 uppercase font-extrabold">{successMovDetails.tipo === TipoMovimento.CONSUMO ? 'Saída (Abast.)' : 'Entrada (NF)'}</span>
              </div>
              
              {successMovDetails.veiculo && (
                <div className="flex justify-between text-xs font-bold border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400 uppercase text-[9px] font-black">Ativo</span>
                  <span className="text-slate-700 uppercase">{successMovDetails.veiculo}</span>
                </div>
              )}
              
              {successMovDetails.leitura && (
                <div className="flex justify-between text-xs font-bold border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400 uppercase text-[9px] font-black">Leitura</span>
                  <span className="text-slate-700 font-mono">{successMovDetails.leitura}</span>
                </div>
              )}

              {successMovDetails.diesel > 0 && (
                <div className="flex justify-between text-xs font-bold border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400 uppercase text-[9px] font-black">Diesel</span>
                  <span className="text-red-500 font-black">{(successMovDetails.diesel ?? 0).toLocaleString()} L</span>
                </div>
              )}

              {successMovDetails.arla > 0 && (
                <div className="flex justify-between text-xs font-bold border-b border-slate-100 pb-1.5">
                  <span className="text-slate-400 uppercase text-[9px] font-black">Arla</span>
                  <span className="text-cyan-600 font-black">{(successMovDetails.arla ?? 0).toLocaleString()} L</span>
                </div>
              )}

              {successMovDetails.motorista && (
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-400 uppercase text-[9px] font-black">Motorista</span>
                  <span className="text-slate-700 uppercase text-[10px] truncate max-w-[150px]">{successMovDetails.motorista}</span>
                </div>
              )}

              {successMovDetails.foto_leitura && (
                <div className="pt-2 border-t border-slate-100 flex flex-col items-center">
                  <span className="text-slate-400 uppercase text-[9px] font-black self-start mb-1">Comprovante de Leitura</span>
                  <img src={successMovDetails.foto_leitura} alt="Foto comprovante" className="max-h-32 object-contain rounded-xl w-full" referrerPolicy="no-referrer" />
                </div>
              )}
            </div>

            <button 
              onClick={() => {
                setShowSuccessModal(false);
                setSuccessMovDetails(null);
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-wider transition-all shadow-md hover:shadow-lg"
            >
              Confirmar e Prosseguir
            </button>
          </motion.div>
        </div>
      )}

      {viewingPhoto && (
        <div 
          className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex flex-col items-center justify-center p-4"
          onClick={() => setViewingPhoto(null)}
        >
          <div className="relative max-w-2xl w-full bg-black/40 rounded-3xl p-2 flex flex-col items-center">
            <button 
              onClick={() => setViewingPhoto(null)}
              className="absolute -top-12 right-2 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-all"
            >
              <X size={24} />
            </button>
            <img 
              src={viewingPhoto} 
              alt="Visualização da Leitura" 
              className="max-h-[75vh] max-w-full object-contain rounded-2xl" 
              onClick={(e) => e.stopPropagation()}
              referrerPolicy="no-referrer"
            />
            <p className="text-white/60 text-xs font-bold uppercase tracking-wider mt-4">Foto do Leitor de Combustível / Bomba</p>
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
        const percent = Math.min(100, Math.max(0, (t.saldo_atual / t.capacidade_litros) * 100));
        const isArla = t.id === 'arla';
        return (
          <div key={t.id} className="bg-white p-10 rounded-[44px] border border-slate-200 shadow-sm flex flex-col items-center">
            <Box size={48} className={`${isArla ? 'text-cyan-600' : 'text-blue-600'} mb-6`} />
            <h3 className="text-2xl font-black text-slate-900 uppercase mb-8">{t.nome}</h3>
            <div className="w-full bg-slate-100 h-6 rounded-full overflow-hidden border border-slate-200 mb-4">
               <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                className={`h-full ${percent < 15 ? 'bg-red-500' : (isArla ? 'bg-cyan-500' : 'bg-blue-600')}`} 
               />
            </div>
            <div className="flex justify-between w-full text-[10px] font-black text-slate-400 uppercase">
               <span>0 L</span>
               <span className={isArla ? 'text-cyan-600 font-bold' : 'text-blue-600 font-bold'}>{Math.max(0, t.saldo_atual).toLocaleString()} L</span>
               <span>{t.capacidade_litros.toLocaleString()} L</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReportsView({ movements, vehicles, tanks, currentUser, logAction }: any) {
  const [editingMovement, setEditingMovement] = useState<any>(null);
  const [reportTab, setReportTab] = useState<'consumption' | 'entries'>('consumption');

  const saveEditedMovement = async (e: any) => {
    e.preventDefault();
    try {
      const oldM = movements.find((m: any) => m.id === editingMovement.id);
      await setDoc(doc(db, 'movements', editingMovement.id), editingMovement);
      if (logAction) {
        await logAction('MOVEMENT_EDIT', oldM, editingMovement);
      }
      setEditingMovement(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `movements/${editingMovement.id}`);
    }
  };

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('all');
  const [selectedTankId, setSelectedTankId] = useState<string>('all');

  const filteredMovements = useMemo(() => {
    let filtered = movements.filter((m: any) => {
      const date = m.data_hora.split('T')[0];
      return date >= startDate && date <= endDate;
    });

    if (selectedTankId !== 'all') {
      filtered = filtered.filter((m: any) => m.tanque_id === selectedTankId);
    }

    if (reportTab === 'consumption') {
      filtered = filtered.filter((m: any) => m.tipo_movimento === TipoMovimento.CONSUMO);
      if (selectedVehicleId !== 'all') {
        filtered = filtered.filter((m: any) => m.veiculo_id === selectedVehicleId);
      }
    } else {
      filtered = filtered.filter((m: any) => 
        m.tipo_movimento === TipoMovimento.ENTRADA || 
        m.tipo_movimento === TipoMovimento.ENTRADA_BRITAGEM || 
        m.tipo_movimento === TipoMovimento.ENTRADA_OBRA
      );
    }

    // Sort descending by date
    return [...filtered].sort((a, b) => new Date(b.data_hora).getTime() - new Date(a.data_hora).getTime());
  }, [movements, startDate, endDate, selectedVehicleId, selectedTankId, reportTab]);

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
        return (liters / diff).toFixed(2) + ' L/H';
      }
    }
    return null;
  };

  const exportToExcel = () => {
    const workbook = XLSX.utils.book_new();

    const saidasData = movements
      .filter((m: any) => m.tipo_movimento === TipoMovimento.CONSUMO)
      .filter((m: any) => {
        const date = m.data_hora.split('T')[0];
        return date >= startDate && date <= endDate;
      })
      .map((m: any) => {
        const vehicle = vehicles.find((v: any) => v.id === m.veiculo_id);
        return {
          'Data/Hora': new Date(m.data_hora).toLocaleString(),
          'Tipo': m.tipo_movimento,
          'Tanque Origem': m.tanque_id,
          'Ativo (Placa/Fixo)': vehicle ? vehicle.placa_ou_prefixo : 'N/A',
          'Modelo': vehicle ? vehicle.modelo : 'N/A',
          'Litros Diesel': Math.abs(m.litros || 0),
          'Litros Arla': Math.abs(m.arla_litros || 0),
          'Leitura (KM/H)': m.km_informado || m.horimetro_informado || '',
          'Motorista': m.motorista || ''
        };
      });

    const entradasData = movements
      .filter((m: any) => [TipoMovimento.ENTRADA, TipoMovimento.ENTRADA_BRITAGEM, TipoMovimento.ENTRADA_OBRA].includes(m.tipo_movimento))
      .filter((m: any) => {
        const date = m.data_hora.split('T')[0];
        return date >= startDate && date <= endDate;
      })
      .map((m: any) => {
        return {
          'Data/Hora': m.data_hora ? new Date(m.data_hora).toLocaleString() : '',
          'Tipo': m.tipo_movimento,
          'Tanque Destino': m.tanque_id,
          'Litros Recebidos (Diesel)': Math.abs(m.litros || 0),
          'Litros Recebidos (Arla)': Math.abs(m.arla_litros || 0),
          'Preço Unitário (R$/L)': m.valor_unitario || 0,
          'Valor do Frete (R$)': m.valor_frete || 0,
          'Valor Total NF (R$)': m.valor_total || 0,
          'Observações': m.observacoes || ''
        };
      });

    const worksheetSaidas = XLSX.utils.json_to_sheet(saidasData);
    const worksheetEntradas = XLSX.utils.json_to_sheet(entradasData);

    XLSX.utils.book_append_sheet(workbook, worksheetSaidas, 'Consumo (Saídas)');
    XLSX.utils.book_append_sheet(workbook, worksheetEntradas, 'Entradas de Combustível');

    XLSX.writeFile(workbook, `Relatorio_FuelTrack_${startDate}_a_${endDate}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 border-b border-slate-100 pb-6">
          <div>
            <h2 className="text-2xl font-black flex items-center gap-3"><BarChart3 className="text-blue-600" /> Relatórios FuelTrack</h2>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setReportTab('consumption')}
                className={`px-4 py-1.5 font-black uppercase text-[9px] tracking-widest rounded-lg transition-all ${
                  reportTab === 'consumption'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                Saídas / Consumo
              </button>
              <button
                onClick={() => setReportTab('entries')}
                className={`px-4 py-1.5 font-black uppercase text-[9px] tracking-widest rounded-lg transition-all ${
                  reportTab === 'entries'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                Entradas (Frete / Preços)
              </button>
            </div>
          </div>
          <button 
            onClick={exportToExcel}
            className="w-full md:w-auto bg-green-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-green-100 hover:bg-green-700 transition-all border border-green-500/10"
          >
            <FileSpreadsheet size={18} /> Exportar Excel
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-100">
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
                 {[...vehicles].sort((a, b) => a.placa_ou_prefixo.localeCompare(b.placa_ou_prefixo)).map((v: any) => (
                   <option key={v.id} value={v.id}>{v.placa_ou_prefixo} - {v.modelo}</option>
                 ))}
               </select>
             </div>
           </div>
           <div className="space-y-1">
             <label className="text-[9px] font-black uppercase text-slate-400 ml-2">Filtrar Tanque</label>
             <div className="relative">
               <Box className="absolute left-4 top-3.5 text-slate-400" size={18} />
               <select 
                className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none" 
                value={selectedTankId} 
                onChange={e => setSelectedTankId(e.target.value)}
               >
                 <option value="all">Todos os Tanques</option>
                 <option value="britagem">Tanque Britagem</option>
                 <option value="wagner">Tanque Wagner</option>
                 <option value="marcus">Tanque Marcus</option>
                 <option value="paulo">Tanque Paulo</option>
                 <option value="matheus">Tanque Matheus</option>
                 <option value="obra">Tanque Obra</option>
               </select>
             </div>
           </div>
        </div>

        {reportTab === 'consumption' ? (
          selectedVehicleId === 'all' ? (
            <div className="space-y-4">
              <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Consumo Geral por Ativo</h3>
              {vehicles.map((v: any) => {
                const vMs = filteredMovements.filter((m: any) => m.veiculo_id === v.id);
                const sortedVMs = [...vMs].sort((a, b) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime());
                const totalL = Math.abs(vMs.reduce((acc: number, curr: any) => acc + curr.litros, 0));
                
                let periodMetric = 'N/A';
                const movementsWithReading = sortedVMs.filter(m => v.usa_medida === MedidaUso.KM ? (m.km_informado !== undefined && m.km_informado !== null) : (m.horimetro_informado !== undefined && m.horimetro_informado !== null));

                if (movementsWithReading.length >= 2) {
                  const first = movementsWithReading[0];
                  const last = movementsWithReading[movementsWithReading.length - 1];
                  
                  const inBetweenMovements = sortedVMs.filter(m => 
                     new Date(m.data_hora) >= new Date(first.data_hora) && 
                     new Date(m.data_hora) <= new Date(last.data_hora)
                  );
                  
                  const totalLitrosCalculo = Math.abs(inBetweenMovements.reduce((acc, curr, idx) => {
                    return idx === 0 ? acc : acc + curr.litros;
                  }, 0));

                  if (v.usa_medida === MedidaUso.KM) {
                    const diff = (last.km_informado ?? 0) - (first.km_informado ?? 0);
                    if (diff > 0 && totalLitrosCalculo > 0) periodMetric = (diff / totalLitrosCalculo).toFixed(2) + ' KM/L';
                  } else {
                    const diff = (last.horimetro_informado ?? 0) - (first.horimetro_informado ?? 0);
                    if (diff > 0 && totalLitrosCalculo > 0) periodMetric = (totalLitrosCalculo / diff).toFixed(2) + ' L/H';
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
                      {currentUser?.role === 'admin' && (
                        <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Ações</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredMovements.map((m: any, idx: number) => {
                      const vehicle = vehicles.find((v: any) => v.id === m.veiculo_id);
                      
                      const vehicleAllMovements = movements
                        .filter((allM: any) => allM.veiculo_id === m.veiculo_id)
                        .sort((a: any, b: any) => new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime());
                      
                      const currentIdx = vehicleAllMovements.findIndex((allM: any) => allM.id === m.id);
                      let prevM = null;
                      if (currentIdx > 0) {
                        for (let i = currentIdx - 1; i >= 0; i--) {
                          const checkM = vehicleAllMovements[i];
                          if (vehicle.usa_medida === MedidaUso.KM ? checkM.km_informado : checkM.horimetro_informado) {
                            prevM = checkM;
                            break;
                          }
                        }
                      }
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
                            {Math.abs(m.litros ?? 0).toLocaleString()} L
                          </td>
                          <td className="py-4 text-right">
                            {metric ? (
                              <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-100">{metric}</span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-200 uppercase">N/A</span>
                            )}
                          </td>
                          {currentUser?.role === 'admin' && (
                            <td className="py-4 text-right">
                              <button
                                onClick={() => setEditingMovement(m)}
                                className="bg-blue-50 text-blue-600 hover:bg-blue-100 p-2 rounded-xl transition-all inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest shadow-sm"
                              >
                                <Pencil size={12} /> Editar
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {filteredMovements.length === 0 && (
                      <tr>
                        <td colSpan={currentUser?.role === 'admin' ? 6 : 5} className="py-20 text-center text-[10px] font-black uppercase text-slate-300 tracking-widest">Nenhum registro encontrado no período</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Histórico de Entradas de Óleo Diesel (Abastecimento de Tanques)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-slate-100">
                  <tr>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400">Data/Hora</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400">Tanque de Destino</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Quantidade</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Preço Unitário (L)</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Valor Frete</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Valor Total (NF)</th>
                    <th className="pb-4 text-[9px] font-black uppercase text-slate-400">Observações</th>
                    {currentUser?.role === 'admin' && (
                      <th className="pb-4 text-[9px] font-black uppercase text-slate-400 text-right">Ações</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredMovements.map((m: any) => {
                    const tName = tanks.find((t: any) => t.id === m.tanque_id)?.nome || m.tanque_id;
                    const unitPriceVal = m.valor_unitario ? parseFloat(m.valor_unitario) : 0;
                    const freightVal = m.valor_frete ? parseFloat(m.valor_frete) : 0;
                    const totalVal = m.valor_total ? parseFloat(m.valor_total) : (unitPriceVal * Math.abs(m.litros) + freightVal);

                    return (
                      <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-4 text-xs font-bold text-slate-600">
                          {new Date(m.data_hora).toLocaleDateString()} <span className="text-slate-300 ml-1">{new Date(m.data_hora).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </td>
                        <td className="py-4 text-xs font-black uppercase text-blue-600">
                          {tName}
                        </td>
                        <td className="py-4 text-right text-xs font-black text-slate-900 font-mono">
                          {Math.abs(m.litros ?? 0).toLocaleString()} L
                        </td>
                        <td className="py-4 text-right text-xs font-bold text-slate-600 font-mono">
                          {unitPriceVal > 0 ? `R$ ${unitPriceVal.toFixed(3)}` : '-'}
                        </td>
                        <td className="py-4 text-right text-xs font-bold text-slate-600 font-mono">
                          {freightVal > 0 ? `R$ ${freightVal.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-'}
                        </td>
                        <td className="py-4 text-right text-xs font-black text-indigo-600 font-mono">
                          {totalVal > 0 ? `R$ ${totalVal.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-'}
                        </td>
                        <td className="py-4 text-xs font-semibold text-slate-500 max-w-xs truncate uppercase">
                          {m.observacoes || '-'}
                        </td>
                        {currentUser?.role === 'admin' && (
                          <td className="py-4 text-right">
                            <button
                              onClick={() => setEditingMovement(m)}
                              className="bg-blue-50 text-blue-600 hover:bg-blue-100 p-2 rounded-xl transition-all inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest shadow-sm"
                            >
                              <Pencil size={12} /> Editar
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filteredMovements.length === 0 && (
                    <tr>
                      <td colSpan={currentUser?.role === 'admin' ? 8 : 7} className="py-20 text-center text-[10px] font-black uppercase text-slate-300 tracking-widest">Nenhuma entrada de combustível registrada neste período</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {editingMovement && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Editar Lançamento</h3>
            <form onSubmit={saveEditedMovement} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Litros</label>
                <input 
                  required 
                  type="number" 
                  step="0.01" 
                  className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                  value={Math.abs(editingMovement.litros)} 
                  onChange={e => {
                    const lits = Math.abs(parseFloat(e.target.value)) || 0;
                    if (editingMovement.tipo_movimento === TipoMovimento.CONSUMO) {
                      setEditingMovement({...editingMovement, litros: -lits});
                    } else {
                      const fVal = parseFloat(editingMovement.valor_frete) || 0;
                      const uVal = parseFloat(editingMovement.valor_unitario) || 0;
                      setEditingMovement({
                        ...editingMovement,
                        litros: lits,
                        valor_total: parseFloat((uVal * lits + fVal).toFixed(2))
                      });
                    }
                  }} 
                />
              </div>

              {(editingMovement.tipo_movimento === TipoMovimento.ENTRADA || 
                editingMovement.tipo_movimento === TipoMovimento.ENTRADA_BRITAGEM || 
                editingMovement.tipo_movimento === TipoMovimento.ENTRADA_OBRA) ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Preço Unitário (R$/L)</label>
                    <input 
                      type="number" 
                      step="0.001" 
                      className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                      value={editingMovement.valor_unitario || ''} 
                      onChange={e => {
                        const unit = parseFloat(e.target.value) || 0;
                        const lits = Math.abs(editingMovement.litros) || 0;
                        const fr = parseFloat(editingMovement.valor_frete) || 0;
                        setEditingMovement({
                          ...editingMovement,
                          valor_unitario: unit,
                          valor_total: parseFloat((unit * lits + fr).toFixed(2))
                        });
                      }} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Valor do Frete (R$)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                      value={editingMovement.valor_frete || ''} 
                      onChange={e => {
                        const fr = parseFloat(e.target.value) || 0;
                        const unit = parseFloat(editingMovement.valor_unitario) || 0;
                        const lits = Math.abs(editingMovement.litros) || 0;
                        setEditingMovement({
                          ...editingMovement,
                          valor_frete: fr,
                          valor_total: parseFloat((unit * lits + fr).toFixed(2))
                        });
                      }} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Valor Total NF (R$)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                      value={editingMovement.valor_total || ''} 
                      onChange={e => {
                        const tot = parseFloat(e.target.value) || 0;
                        const fr = parseFloat(editingMovement.valor_frete) || 0;
                        const lits = Math.abs(editingMovement.litros) || 0;
                        const unit = lits > 0 ? parseFloat(((tot - fr) / lits).toFixed(3)) : 0;
                        setEditingMovement({
                          ...editingMovement,
                          valor_total: tot,
                          valor_unitario: unit > 0 ? unit : 0
                        });
                      }} 
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">KM/Horímetro</label>
                    <input type="number" step="0.01" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingMovement.km_informado || editingMovement.horimetro_informado || ''} onChange={e => {
                      const val = parseFloat(e.target.value);
                      if (editingMovement.km_informado !== undefined) setEditingMovement({...editingMovement, km_informado: val});
                      else setEditingMovement({...editingMovement, horimetro_informado: val});
                    }} />
                  </div>
                  {editingMovement.tipo_movimento === TipoMovimento.CONSUMO && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Ativo (Admin)</label>
                      <select 
                        required 
                        className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                        value={editingMovement.veiculo_id || ''} 
                        onChange={e => setEditingMovement({...editingMovement, veiculo_id: e.target.value})}
                      >
                        <option value="">Selecione Ativo</option>
                        {[...vehicles].sort((a, b) => a.placa_ou_prefixo.localeCompare(b.placa_ou_prefixo)).map((v:any) => (
                          <option key={v.id} value={v.id}>{v.placa_ou_prefixo} - {v.modelo}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {editingMovement.tipo_movimento === TipoMovimento.CONSUMO && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Motorista / Condutor (Admin)</label>
                      <input 
                        type="text"
                        className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                        value={editingMovement.motorista || ''} 
                        onChange={e => setEditingMovement({...editingMovement, motorista: e.target.value})} 
                      />
                    </div>
                  )}
                </>
              )}

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Tanque de Destino / Origem</label>
                <select className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingMovement.tanque_id} onChange={e => {
                  const newTankId = e.target.value;
                  if (newTankId === 'arla') {
                    setEditingMovement({
                      ...editingMovement,
                      tanque_id: newTankId,
                      litros: 0,
                      valor_total: null,
                      valor_unitario: null,
                      valor_frete: null
                    });
                  } else {
                    setEditingMovement({
                      ...editingMovement,
                      tanque_id: newTankId
                    });
                  }
                }}>
                  <option value="britagem">Tanque Britagem</option>
                  <option value="wagner">Tanque Wagner</option>
                  <option value="marcus">Tanque Marcus</option>
                  <option value="paulo">Tanque Paulo</option>
                  <option value="matheus">Tanque Matheus</option>
                  <option value="obra">Tanque Obra</option>
                  <option value="arla">Tanque Arla</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Observações</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" 
                  value={editingMovement.observacoes || ''} 
                  onChange={e => setEditingMovement({...editingMovement, observacoes: e.target.value})} 
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Data/Hora</label>
                <input type="datetime-local" className="w-full bg-slate-50 border rounded-2xl px-5 py-3.5 font-bold" value={editingMovement.data_hora.substring(0, 16)} onChange={e => setEditingMovement({...editingMovement, data_hora: e.target.value})} />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black uppercase text-xs animate-pulse">Salvar Alterações</button>
              <button type="button" onClick={() => setEditingMovement(null)} className="w-full py-2 font-bold text-slate-400">Cancelar</button>
            </form>
          </div>
        </div>
      )}
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

function MaintenanceView({ vehicles, currentUser, logAction }: any) {
  const [editingVehicle, setEditingVehicle] = useState<any>(null);
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState({
    tacografo_afericao: '',
    tacografo_validade: '',
    oleo_data_ultima: '',
    oleo_km_proxima: '',
    oleo_horas_proxima: ''
  });

  const controlledVehicles = useMemo(() => {
    return vehicles.filter((v: any) => v.controle_manutencao === true);
  }, [vehicles]);

  const alerts = useMemo(() => getMaintenanceAlerts(vehicles), [vehicles]);

  const toggleMaintenanceControl = async (v: any) => {
    try {
      const oldV = { ...v };
      const updatedVehicle = {
        ...v,
        controle_manutencao: !v.controle_manutencao
      };
      await setDoc(doc(db, 'vehicles', v.id), updatedVehicle);
      await logAction('VEHICLE_MAINTENANCE_TOGGLE', oldV, updatedVehicle);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `vehicles/${v.id}`);
    }
  };

  const openEdit = (v: any) => {
    setEditingVehicle(v);
    setForm({
      tacografo_afericao: v.tacografo_afericao || '',
      tacografo_validade: v.tacografo_validade || '',
      oleo_data_ultima: v.oleo_data_ultima || '',
      oleo_km_proxima: v.oleo_km_proxima !== undefined && v.oleo_km_proxima !== null ? String(v.oleo_km_proxima) : '',
      oleo_horas_proxima: v.oleo_horas_proxima !== undefined && v.oleo_horas_proxima !== null ? String(v.oleo_horas_proxima) : ''
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVehicle) return;

    try {
      const oldV = { ...editingVehicle };
      const updatedVehicle = {
        ...editingVehicle,
        tacografo_afericao: form.tacografo_afericao || null,
        tacografo_validade: form.tacografo_validade || null,
        oleo_data_ultima: form.oleo_data_ultima || null,
        oleo_km_proxima: form.oleo_km_proxima ? parseFloat(form.oleo_km_proxima) : null,
        oleo_horas_proxima: form.oleo_horas_proxima ? parseFloat(form.oleo_horas_proxima) : null
      };

      await setDoc(doc(db, 'vehicles', editingVehicle.id), updatedVehicle);
      await logAction('VEHICLE_MAINTENANCE_UPDATE', oldV, updatedVehicle);
      setEditingVehicle(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `vehicles/${editingVehicle.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black tracking-tight">Manutenção de Frota</h2>
          <p className="text-[10px] font-black uppercase text-slate-400">Controle de Tacógrafos e Troca de Óleo</p>
        </div>
        <button
          onClick={() => setShowSelectModal(true)}
          className="w-full sm:w-auto bg-slate-100 border border-slate-200 text-slate-700 hover:bg-blue-600 hover:text-white hover:border-transparent px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-sm"
        >
          <Settings size={16} /> Selecionar Ativos
        </button>
      </div>

      {controlledVehicles.length === 0 ? (
        <div className="bg-white rounded-[44px] border border-slate-200 p-12 text-center max-w-2xl mx-auto my-8 shadow-sm">
          <div className="bg-blue-50 text-blue-600 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Wrench size={32} />
          </div>
          <h3 className="text-xl font-black text-slate-800 tracking-tight">Nenhum Ativo sob Controle</h3>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
            A equipe de manutenção deve selecionar os ativos (veículos ou máquinas) que deverão ter seu controle de óleo e tacógrafo ativado.
          </p>
          <button
            onClick={() => setShowSelectModal(true)}
            className="mt-6 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-md hover:shadow-lg inline-flex items-center gap-2"
          >
            <PlusCircle size={16} /> Selecionar Ativos para Controle
          </button>
        </div>
      ) : (
        <>
          {/* Alerts Summary */}
          {alerts.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-[32px] p-6 space-y-3">
              <div className="flex items-center gap-2 text-red-600 font-black uppercase text-xs">
                <AlertTriangle size={18} />
                <span>Alertas de Manutenção ({alerts.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {alerts.map((al, idx) => (
                  <div key={idx} className={`p-4 rounded-2xl flex items-start gap-3 border ${
                    al.severity === 'danger' ? 'bg-red-100/40 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}>
                    <div className={`p-1.5 rounded-xl shrink-0 ${al.severity === 'danger' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}`}>
                      <AlertCircle size={14} />
                    </div>
                    <div>
                      <div className="font-black text-xs uppercase tracking-tight">{al.vehicle.placa_ou_prefixo} - {al.vehicle.modelo}</div>
                      <div className="text-xs font-medium mt-0.5">{al.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Assets List */}
          <div className="bg-white rounded-[44px] border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Ativo</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Tacógrafo (Validade)</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Troca de Óleo (KM/H Limite)</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">Status Geral</th>
                    <th className="px-8 py-5 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {controlledVehicles.map((v: any) => {
                    const odoVal = v.odometro_atual ?? 0;
                    const horVal = v.horimetro_atual ?? 0;

                    // Tacografo calculations
                    let tacStatus = 'Não configurado';
                    let tacColor = 'text-slate-400 bg-slate-50 border-slate-100';
                    if (v.tacografo_validade) {
                      const exp = new Date(v.tacografo_validade + 'T00:00:00');
                      const tod = new Date();
                      exp.setHours(0,0,0,0);
                      tod.setHours(0,0,0,0);
                      const diffDays = Math.ceil((exp.getTime() - tod.getTime()) / (1000 * 60 * 60 * 24));
                      if (diffDays < 0) {
                        tacStatus = `Vencido (${new Date(v.tacografo_validade + 'T00:00:00').toLocaleDateString('pt-BR')})`;
                        tacColor = 'text-red-600 bg-red-50 border-red-100 font-bold';
                      } else if (diffDays <= 15) {
                        tacStatus = `Vence em ${diffDays} dias (${new Date(v.tacografo_validade + 'T00:00:00').toLocaleDateString('pt-BR')})`;
                        tacColor = 'text-amber-600 bg-amber-50 border-amber-100 font-bold animate-pulse';
                      } else {
                        tacStatus = `Regular (${new Date(v.tacografo_validade + 'T00:00:00').toLocaleDateString('pt-BR')})`;
                        tacColor = 'text-green-600 bg-green-50 border-green-100 font-bold';
                      }
                    }

                    // Oil calculations
                    let oilStatus = 'Não configurado';
                    let oilColor = 'text-slate-400 bg-slate-50 border-slate-100';
                    if (v.usa_medida === MedidaUso.KM) {
                      if (v.oleo_km_proxima) {
                        const diff = v.oleo_km_proxima - odoVal;
                        if (diff < 0) {
                          oilStatus = `Vencida há ${Math.abs(diff).toLocaleString()} KM (Limite: ${v.oleo_km_proxima.toLocaleString()})`;
                          oilColor = 'text-red-600 bg-red-50 border-red-100 font-bold';
                        } else if (diff <= 1000) {
                          oilStatus = `Faltam ${diff.toLocaleString()} KM (Limite: ${v.oleo_km_proxima.toLocaleString()})`;
                          oilColor = 'text-amber-600 bg-amber-50 border-amber-100 font-bold animate-pulse';
                        } else {
                          oilStatus = `Faltam ${diff.toLocaleString()} KM (Limite: ${v.oleo_km_proxima.toLocaleString()})`;
                          oilColor = 'text-green-600 bg-green-50 border-green-100 font-bold';
                        }
                      }
                    } else {
                      if (v.oleo_horas_proxima) {
                        const diff = v.oleo_horas_proxima - horVal;
                        if (diff < 0) {
                          oilStatus = `Vencida há ${Math.abs(diff).toLocaleString()} H (Limite: ${v.oleo_horas_proxima.toLocaleString()})`;
                          oilColor = 'text-red-600 bg-red-50 border-red-100 font-bold';
                        } else if (diff <= 50) {
                          oilStatus = `Faltam ${diff.toLocaleString()} H (Limite: ${v.oleo_horas_proxima.toLocaleString()})`;
                          oilColor = 'text-amber-600 bg-amber-50 border-amber-100 font-bold animate-pulse';
                        } else {
                          oilStatus = `Faltam ${diff.toLocaleString()} H (Limite: ${v.oleo_horas_proxima.toLocaleString()})`;
                          oilColor = 'text-green-600 bg-green-50 border-green-100 font-bold';
                        }
                      }
                    }

                    const hasAlert = alerts.some(al => al.vehicle.id === v.id);

                    return (
                      <tr key={v.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-8 py-6">
                          <div className="font-black uppercase text-slate-800">{v.placa_ou_prefixo}</div>
                          <div className="text-xs font-bold text-slate-400 uppercase">{v.modelo}</div>
                          <div className="text-[10px] text-blue-600 font-bold mt-1 uppercase">
                            Medição: {v.usa_medida === MedidaUso.KM ? `${odoVal.toLocaleString()} KM` : `${horVal.toLocaleString()} H`}
                          </div>
                        </td>
                        <td className="px-8 py-6 space-y-1">
                          {v.tacografo_validade ? (
                            <>
                              <div className={`text-[9px] px-2.5 py-1 rounded-full border inline-block uppercase tracking-tight ${tacColor}`}>
                                {tacStatus}
                              </div>
                              <div className="text-[9px] text-slate-400 font-bold">
                                Última Aferição: {v.tacografo_afericao ? new Date(v.tacografo_afericao + 'T00:00:00').toLocaleDateString('pt-BR') : 'N/D'}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400 text-xs italic">Não configurado</span>
                          )}
                        </td>
                        <td className="px-8 py-6 space-y-1">
                          {(v.usa_medida === MedidaUso.KM ? v.oleo_km_proxima : v.oleo_horas_proxima) ? (
                            <>
                              <div className={`text-[9px] px-2.5 py-1 rounded-full border inline-block uppercase tracking-tight ${oilColor}`}>
                                {oilStatus}
                              </div>
                              <div className="text-[9px] text-slate-400 font-bold">
                                Última Troca: {v.oleo_data_ultima ? new Date(v.oleo_data_ultima + 'T00:00:00').toLocaleDateString('pt-BR') : 'N/D'}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400 text-xs italic">Não configurado</span>
                          )}
                        </td>
                        <td className="px-8 py-6">
                          {hasAlert ? (
                            <span className="flex items-center gap-1.5 text-red-600 text-[10px] font-black uppercase tracking-wider bg-red-50 border border-red-100 px-3 py-1.5 rounded-xl w-fit">
                              <AlertTriangle size={14} className="animate-bounce" /> Atenção Necessária
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-green-600 text-[10px] font-black uppercase tracking-wider bg-green-50 border border-green-100 px-3 py-1.5 rounded-xl w-fit">
                              <ShieldCheck size={14} /> Manutenção OK
                            </span>
                          )}
                        </td>
                        <td className="px-8 py-6 text-right">
                          <button 
                            onClick={() => openEdit(v)}
                            className="bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all shadow-sm flex items-center gap-1.5 ml-auto animate-none hover:shadow"
                          >
                            <Pencil size={12} /> Atualizar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Edit Modal */}
      {editingVehicle && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-black">Manutenção de Ativo</h3>
                <p className="text-[10px] font-black text-blue-600 uppercase mt-0.5">{editingVehicle.placa_ou_prefixo} - {editingVehicle.modelo}</p>
              </div>
              <button onClick={() => setEditingVehicle(null)} className="p-1.5 hover:bg-slate-100 rounded-full transition-colors"><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSave} className="space-y-6">
              {/* Tacografo section */}
              <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Gauge size={14} /> Tacógrafo
                </div>
                
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Data da Última Aferição</label>
                  <input 
                    type="date" 
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-sm" 
                    value={form.tacografo_afericao} 
                    onChange={e => setForm({ ...form, tacografo_afericao: e.target.value })} 
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Data de Validade</label>
                  <input 
                    type="date" 
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-sm" 
                    value={form.tacografo_validade} 
                    onChange={e => setForm({ ...form, tacografo_validade: e.target.value })} 
                  />
                </div>
              </div>

              {/* Oil Change section */}
              <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Droplets size={14} /> Troca de Óleo
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Data da Última Troca</label>
                  <input 
                    type="date" 
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-sm" 
                    value={form.oleo_data_ultima} 
                    onChange={e => setForm({ ...form, oleo_data_ultima: e.target.value })} 
                  />
                </div>

                {editingVehicle.usa_medida === MedidaUso.KM ? (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Próxima Troca (KM Limite)</label>
                    <input 
                      type="number" 
                      placeholder="Ex: 50000"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-sm" 
                      value={form.oleo_km_proxima} 
                      onChange={e => setForm({ ...form, oleo_km_proxima: e.target.value })} 
                    />
                    <div className="text-[8px] font-bold text-slate-400 ml-2 mt-0.5 uppercase">
                      Leitura Atual: {(editingVehicle.odometro_atual ?? 0).toLocaleString()} KM
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Próxima Troca (Horímetro Limite)</label>
                    <input 
                      type="number" 
                      placeholder="Ex: 1200"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-sm" 
                      value={form.oleo_horas_proxima} 
                      onChange={e => setForm({ ...form, oleo_horas_proxima: e.target.value })} 
                    />
                    <div className="text-[8px] font-bold text-slate-400 ml-2 mt-0.5 uppercase">
                      Leitura Atual: {(editingVehicle.horimetro_atual ?? 0).toLocaleString()} H
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-wider transition-all shadow-md">
                  Salvar Alterações
                </button>
                <button type="button" onClick={() => setEditingVehicle(null)} className="w-full py-2 font-bold text-slate-400 text-xs uppercase tracking-wide hover:text-slate-600 transition-colors">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Selection Modal */}
      {showSelectModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[32px] p-8 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-xl font-black text-slate-800">Controle de Ativos</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mt-0.5">Selecione os ativos monitorados pela manutenção</p>
              </div>
              <button onClick={() => setShowSelectModal(false)} className="p-1.5 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Search filter inside modal */}
            <div className="relative mb-4">
              <input 
                type="text" 
                placeholder="Buscar placa, prefixo ou modelo..." 
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-5 pr-12 py-3.5 text-sm font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Vehicles Checklist */}
            <div className="overflow-y-auto flex-1 pr-1 space-y-2">
              {vehicles
                .filter((v: any) => {
                  const queryText = searchQuery.toLowerCase();
                  return (
                    v.placa_ou_prefixo.toLowerCase().includes(queryText) ||
                    v.modelo.toLowerCase().includes(queryText)
                  );
                })
                .sort((a: any, b: any) => a.placa_ou_prefixo.localeCompare(b.placa_ou_prefixo))
                .map((v: any) => {
                  const isChecked = !!v.controle_manutencao;
                  return (
                    <div 
                      key={v.id} 
                      onClick={() => toggleMaintenanceControl(v)}
                      className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer select-none ${
                        isChecked 
                          ? 'bg-blue-50/60 border-blue-200 text-blue-950 shadow-sm' 
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                          isChecked 
                            ? 'bg-blue-600 border-blue-600 text-white' 
                            : 'border-slate-300 bg-white'
                        }`}>
                          {isChecked && <ShieldCheck size={14} />}
                        </div>
                        <div>
                          <div className="font-black uppercase text-sm leading-tight">{v.placa_ou_prefixo}</div>
                          <div className={`text-[10px] font-bold uppercase ${isChecked ? 'text-blue-500' : 'text-slate-400'}`}>
                            {v.modelo} • {v.usa_medida === MedidaUso.KM ? 'Odômetro' : 'Horímetro'}
                          </div>
                        </div>
                      </div>
                      <div>
                        {isChecked ? (
                          <span className="text-[9px] bg-blue-100 text-blue-700 font-black px-2.5 py-1 rounded-full uppercase tracking-wider">
                            Ativo
                          </span>
                        ) : (
                          <span className="text-[9px] bg-slate-100 text-slate-500 font-black px-2.5 py-1 rounded-full uppercase tracking-wider">
                            Inativo
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              {vehicles.length === 0 && (
                <div className="text-center py-8 text-slate-400 font-bold text-sm">
                  Nenhum veículo cadastrado na frota.
                </div>
              )}
            </div>

            <div className="mt-6 border-t pt-4">
              <button 
                onClick={() => setShowSelectModal(false)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-wider transition-all shadow-md"
              >
                Concluir Seleção
              </button>
            </div>
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
