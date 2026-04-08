import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  query,
  orderBy,
  Timestamp 
} from 'firebase/firestore';
import { 
  Users, 
  BrainCircuit, 
  Shield, 
  ShieldAlert, 
  Plus, 
  Trash2, 
  Save,
  CheckCircle2,
  AlertCircle,
  UserCog,
  X,
  Database
} from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

interface UserData {
  id: string;
  name: string;
  email: string;
  role: 'master-admin' | 'admin' | 'user';
  createdAt: any;
  lastSeen?: any;
}

interface TrainingCase {
  id: string;
  query: string;
  expectedResponse?: string;
  optimizedIntent?: string;
  createdAt: any;
}

interface UnsolvedQuery {
  id: string;
  query: string;
  timestamp: any;
  status: 'pending' | 'resolved';
}

export default function AdminControls() {
  const [view, setView] = useState<'selection' | 'users' | 'training' | 'notifications' | 'datacenter'>('selection');
  const [users, setUsers] = useState<UserData[]>([]);
  const [trainingCases, setTrainingCases] = useState<TrainingCase[]>([]);
  const [unsolvedQueries, setUnsolvedQueries] = useState<UnsolvedQuery[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newCase, setNewCase] = useState({ query: '', expectedResponse: '', optimizedIntent: '' });
  const [isAddingCase, setIsAddingCase] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setIsLoading(true);
    try {
      const [usersSnap, trainingSnap, unsolvedSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(query(collection(db, 'chatbot_training'), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'unsolved_queries'), orderBy('timestamp', 'desc')))
      ]);

      setUsers(usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserData)));
      setTrainingCases(trainingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TrainingCase)));
      setUnsolvedQueries(unsolvedSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as UnsolvedQuery)));
    } catch (error) {
      console.error("Error fetching admin data:", error);
      toast.error("Failed to load admin data");
    } finally {
      setIsLoading(false);
    }
  }

  const toggleUserRole = async (userId: string, currentRole: string, email: string) => {
    if (email === 'deveshkapoork@gmail.com') {
      toast.error("Master Admin role cannot be changed");
      return;
    }
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole as 'admin' | 'user' } : u));
      toast.success(`User role updated to ${newRole}`);
    } catch (error) {
      toast.error("Failed to update user role");
    }
  };

  const handleAddTrainingCase = async () => {
    if (!newCase.query.trim()) {
      toast.error("User query is compulsory");
      return;
    }

    if (!newCase.expectedResponse.trim() && !newCase.optimizedIntent.trim()) {
      toast.error("Either Optimized Response or Optimized Intent is required");
      return;
    }

    try {
      const data: any = {
        query: newCase.query,
        createdAt: Timestamp.now()
      };
      if (newCase.expectedResponse.trim()) data.expectedResponse = newCase.expectedResponse;
      if (newCase.optimizedIntent.trim()) data.optimizedIntent = newCase.optimizedIntent;

      const docRef = await addDoc(collection(db, 'chatbot_training'), data);
      setTrainingCases([{ id: docRef.id, ...data }, ...trainingCases]);
      setNewCase({ query: '', expectedResponse: '', optimizedIntent: '' });
      setIsAddingCase(false);
      toast.success("Training case added successfully");
    } catch (error) {
      toast.error("Failed to add training case");
    }
  };

  const handleResolveQuery = async (id: string) => {
    try {
      await updateDoc(doc(db, 'unsolved_queries', id), { status: 'resolved' });
      setUnsolvedQueries(unsolvedQueries.map(q => q.id === id ? { ...q, status: 'resolved' } : q));
      toast.success("Query marked as resolved");
    } catch (error) {
      toast.error("Failed to resolve query");
    }
  };

  const handleDeleteUnsolvedQuery = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'unsolved_queries', id));
      setUnsolvedQueries(unsolvedQueries.filter(q => q.id !== id));
      toast.success("Notification deleted");
    } catch (error) {
      toast.error("Failed to delete notification");
    }
  };

  const handleDeleteCase = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'chatbot_training', id));
      setTrainingCases(trainingCases.filter(c => c.id !== id));
      toast.success("Training case deleted");
    } catch (error) {
      toast.error("Failed to delete training case");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (view === 'selection') {
    return (
      <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <header>
          <h2 className="text-4xl font-black text-gray-900 mb-2">Admin Controls</h2>
          <p className="text-gray-500 text-lg">Select a module to manage application settings.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* User Management Card */}
          <button 
            onClick={() => setView('users')}
            className="group relative bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 text-left hover:shadow-2xl hover:shadow-blue-100 hover:-translate-y-2 transition-all duration-500 overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-[5rem] -mr-8 -mt-8 group-hover:scale-110 transition-transform duration-500" />
            <div className="relative z-10">
              <div className="w-16 h-16 bg-blue-500 text-white rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-blue-200 group-hover:rotate-6 transition-transform">
                <Users size={32} />
              </div>
              <h3 className="text-3xl font-black text-gray-900 mb-4">User Management</h3>
              <p className="text-gray-500 leading-relaxed mb-8">
                Manage application access, monitor user status, and toggle administrative roles for your team.
              </p>
              <div className="flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs">
                Manage Users <Shield size={14} />
              </div>
            </div>
          </button>

          {/* Chatbot Training Card */}
          <button 
            onClick={() => setView('training')}
            className="group relative bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 text-left hover:shadow-2xl hover:shadow-orange-100 hover:-translate-y-2 transition-all duration-500 overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-50 rounded-bl-[5rem] -mr-8 -mt-8 group-hover:scale-110 transition-transform duration-500" />
            <div className="relative z-10">
              <div className="w-16 h-16 bg-orange-500 text-white rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-orange-200 group-hover:rotate-6 transition-transform">
                <BrainCircuit size={32} />
              </div>
              <h3 className="text-3xl font-black text-gray-900 mb-4">Chatbot Training</h3>
              <p className="text-gray-500 leading-relaxed mb-8">
                Optimize Kapoor's intelligence by adding edge cases, custom responses, and training scenarios.
              </p>
              <div className="flex items-center gap-2 text-orange-600 font-black uppercase tracking-widest text-xs">
                Train AI <Plus size={14} />
              </div>
            </div>
          </button>

          {/* Notifications Card */}
          <button 
            onClick={() => setView('notifications')}
            className="group relative bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 text-left hover:shadow-2xl hover:shadow-red-100 hover:-translate-y-2 transition-all duration-500 overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-bl-[5rem] -mr-8 -mt-8 group-hover:scale-110 transition-transform duration-500" />
            <div className="relative z-10">
              <div className="w-16 h-16 bg-red-500 text-white rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-red-200 group-hover:rotate-6 transition-transform">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-3xl font-black text-gray-900 mb-4">Notifications</h3>
              <p className="text-gray-500 leading-relaxed mb-8">
                Monitor queries that Kapoor was unable to solve and take action to improve the AI's performance.
              </p>
              <div className="flex items-center gap-2 text-red-600 font-black uppercase tracking-widest text-xs">
                View Alerts <AlertCircle size={14} />
              </div>
            </div>
          </button>

          {/* Data Center Card */}
          <button 
            onClick={() => setView('datacenter')}
            className="group relative bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 text-left hover:shadow-2xl hover:shadow-purple-100 hover:-translate-y-2 transition-all duration-500 overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-50 rounded-bl-[5rem] -mr-8 -mt-8 group-hover:scale-110 transition-transform duration-500" />
            <div className="relative z-10">
              <div className="w-16 h-16 bg-purple-500 text-white rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-purple-200 group-hover:rotate-6 transition-transform">
                <Database size={32} />
              </div>
              <h3 className="text-3xl font-black text-gray-900 mb-4">Data Center</h3>
              <p className="text-gray-500 leading-relaxed mb-8">
                Centralized hub for managing application data, exports, and system-wide configurations.
              </p>
              <div className="flex items-center gap-2 text-purple-600 font-black uppercase tracking-widest text-xs">
                Access Data <Database size={14} />
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button 
        onClick={() => setView('selection')}
        className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-bold transition-colors mb-4"
      >
        <X size={20} className="rotate-45" /> Back to Admin
      </button>

      {view === 'users' ? (
        <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 animate-in zoom-in-95 duration-300">
          <div className="flex items-center gap-6 mb-10">
            <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center">
              <Users size={32} />
            </div>
            <div>
              <h3 className="text-3xl font-black text-gray-900">User Management</h3>
              <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Access Control & Status</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {users.map((user) => (
              <div key={user.id} className="p-6 bg-gray-50 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white hover:shadow-xl hover:shadow-blue-50 transition-all border border-transparent hover:border-blue-100">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center border border-gray-100 shadow-sm">
                    <UserCog className="text-gray-400" size={24} />
                  </div>
                  <div>
                    <p className="text-lg font-black text-gray-900">{user.name}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-gray-500">{user.email}</p>
                      {user.lastSeen && (
                        <span className={cn(
                          "w-2 h-2 rounded-full",
                          (Date.now() - user.lastSeen.toDate().getTime()) < 300000 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-gray-300"
                        )} />
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 self-end sm:self-auto">
                  <div className={cn(
                    "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest",
                    user.role === 'master-admin' ? "bg-purple-100 text-purple-600" :
                    user.role === 'admin' ? "bg-orange-100 text-orange-600" : "bg-gray-200 text-gray-600"
                  )}>
                    {user.role === 'master-admin' ? 'master admin' : user.role}
                  </div>
                  {user.role !== 'master-admin' && (
                    <button
                      onClick={() => toggleUserRole(user.id, user.role, user.email)}
                      className={cn(
                        "p-3 rounded-2xl transition-all shadow-sm",
                        user.role === 'admin' 
                          ? "bg-red-50 text-red-500 hover:bg-red-500 hover:text-white" 
                          : "bg-green-50 text-green-500 hover:bg-green-500 hover:text-white"
                      )}
                      title={user.role === 'admin' ? "Revoke Admin" : "Grant Admin"}
                    >
                      {user.role === 'admin' ? <ShieldAlert size={20} /> : <Shield size={20} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : view === 'training' ? (
        <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 animate-in zoom-in-95 duration-300">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 bg-orange-50 text-orange-500 rounded-2xl flex items-center justify-center">
                <BrainCircuit size={32} />
              </div>
              <div>
                <h3 className="text-3xl font-black text-gray-900">Chatbot Training</h3>
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">AI Optimization Hub</p>
              </div>
            </div>
            <button
              onClick={() => setIsAddingCase(!isAddingCase)}
              className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all shadow-xl shadow-gray-200"
            >
              {isAddingCase ? <X size={20} /> : <><Plus size={20} /> Add Case</>}
            </button>
          </div>

          <div className="space-y-8">
            {isAddingCase && (
              <div className="p-8 bg-orange-50 rounded-[2.5rem] space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className="block text-xs font-black text-orange-900 uppercase tracking-widest mb-3">User Query / Edge Case <span className="text-red-500">*</span></label>
                    <textarea
                      value={newCase.query}
                      onChange={(e) => setNewCase({ ...newCase, query: e.target.value })}
                      className="w-full p-5 bg-white border-none rounded-2xl text-sm focus:ring-4 focus:ring-orange-500/10 transition-all outline-none min-h-[100px] shadow-sm"
                      placeholder="e.g. How much stock is left for SKU-123?"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-black text-orange-900 uppercase tracking-widest mb-3">Optimized Response</label>
                      <textarea
                        value={newCase.expectedResponse}
                        onChange={(e) => setNewCase({ ...newCase, expectedResponse: e.target.value })}
                        className="w-full p-5 bg-white border-none rounded-2xl text-sm focus:ring-4 focus:ring-orange-500/10 transition-all outline-none min-h-[120px] shadow-sm"
                        placeholder="Kapoor's ideal response..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-orange-900 uppercase tracking-widest mb-3">Optimized Intent</label>
                      <textarea
                        value={newCase.optimizedIntent}
                        onChange={(e) => setNewCase({ ...newCase, optimizedIntent: e.target.value })}
                        className="w-full p-5 bg-white border-none rounded-2xl text-sm focus:ring-4 focus:ring-orange-500/10 transition-all outline-none min-h-[120px] shadow-sm"
                        placeholder="Specify the intent/logic Kapoor should follow..."
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleAddTrainingCase}
                  className="w-full py-5 bg-orange-500 text-white rounded-2xl font-black text-lg hover:bg-orange-600 transition-all flex items-center justify-center gap-3 shadow-xl shadow-orange-200"
                >
                  <Save size={24} /> Save Training Data
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6">
              {trainingCases.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-[3rem] border-2 border-dashed border-gray-200">
                  <AlertCircle className="mx-auto text-gray-200 mb-6" size={64} />
                  <p className="text-xl font-black text-gray-400">No training data yet.</p>
                  <p className="text-gray-400 mt-2">Start adding cases to make Kapoor smarter.</p>
                </div>
              ) : (
                trainingCases.map((c) => (
                  <div key={c.id} className="p-8 bg-gray-50 rounded-[2.5rem] border border-transparent hover:border-orange-100 hover:bg-white hover:shadow-2xl hover:shadow-orange-50 transition-all group relative">
                    <button
                      onClick={() => handleDeleteCase(c.id)}
                      className="absolute top-6 right-6 p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={20} />
                    </button>
                    
                    <div className="space-y-6">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center shrink-0">
                          <CheckCircle2 size={20} />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-1">User Query</p>
                          <p className="text-lg font-bold text-gray-900 leading-tight">{c.query}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pl-14 pt-6 border-t border-gray-200">
                        {c.expectedResponse && (
                          <div>
                            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Optimized Response</p>
                            <p className="text-gray-600 italic leading-relaxed">"{c.expectedResponse}"</p>
                          </div>
                        )}
                        {c.optimizedIntent && (
                          <div>
                            <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-1">Optimized Intent</p>
                            <p className="text-gray-600 italic leading-relaxed">"{c.optimizedIntent}"</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : view === 'notifications' ? (
        <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 animate-in zoom-in-95 duration-300">
          <div className="flex items-center gap-6 mb-10">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center">
              <AlertCircle size={32} />
            </div>
            <div>
              <h3 className="text-3xl font-black text-gray-900">Notifications</h3>
              <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Unsolved Queries & Alerts</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {unsolvedQueries.length === 0 ? (
              <div className="text-center py-20 bg-gray-50 rounded-[3rem] border-2 border-dashed border-gray-200">
                <CheckCircle2 className="mx-auto text-gray-200 mb-6" size={64} />
                <p className="text-xl font-black text-gray-400">All clear!</p>
                <p className="text-gray-400 mt-2">No unsolved queries reported.</p>
              </div>
            ) : (
              unsolvedQueries.map((q) => (
                <div key={q.id} className={cn(
                  "p-6 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all border",
                  q.status === 'pending' ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-100 opacity-60"
                )}>
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                      q.status === 'pending' ? "bg-white text-red-500 shadow-sm" : "bg-white text-gray-400"
                    )}>
                      <AlertCircle size={24} />
                    </div>
                    <div>
                      <p className="text-lg font-black text-gray-900">{q.query}</p>
                      <p className="text-xs text-gray-500 font-bold mt-1">
                        Reported on: {q.timestamp?.toDate().toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    {q.status === 'pending' && (
                      <button
                        onClick={() => handleResolveQuery(q.id)}
                        className="px-6 py-2 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition-all shadow-lg shadow-green-200"
                      >
                        Resolve
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteUnsolvedQuery(q.id)}
                      className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 animate-in zoom-in-95 duration-300">
          <div className="flex items-center gap-6 mb-10">
            <div className="w-16 h-16 bg-purple-50 text-purple-500 rounded-2xl flex items-center justify-center">
              <Database size={32} />
            </div>
            <div>
              <h3 className="text-3xl font-black text-gray-900">Data Center</h3>
              <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">System Data & Configuration</p>
            </div>
          </div>
          
          <div className="text-center py-20 bg-gray-50 rounded-[3rem] border-2 border-dashed border-gray-200">
            <Database className="mx-auto text-gray-200 mb-6" size={64} />
            <p className="text-xl font-black text-gray-400">Data Center Initialized</p>
            <p className="text-gray-400 mt-2">We will decide the navigation and features for this module soon.</p>
          </div>
        </div>
      )}
    </div>
  );
}

