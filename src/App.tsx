import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider, 
  signOut 
} from 'firebase/auth';
import { collection, getDocs, query, where, limit, doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { Toaster, toast } from 'sonner';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  BookOpen, 
  LogOut, 
  LogIn, 
  Menu, 
  X, 
  Scan,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Shield
} from 'lucide-react';
import { cn } from './lib/utils';
import Inventory from './components/Inventory';
import Orders from './components/Orders';
import Ledger from './components/Ledger';
import Scanner from './components/Scanner';
import ChatBot from './components/ChatBot';
import AdminControls from './components/AdminControls';
import { handleFirestoreError, OperationType } from './lib/firestore-errors';

type Tab = 'dashboard' | 'inventory' | 'orders' | 'ledger' | 'scan' | 'admin';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isMasterAdmin, setIsMasterAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [navigationFilter, setNavigationFilter] = useState<any>(null);
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalItemsIn: 0,
    totalOrders: 0,
    totalBalance: 0
  });

  useEffect(() => {
    // Handle redirect result for mobile login
    const handleRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result) {
          toast.success("Logged in successfully via redirect");
        }
      } catch (error: any) {
        console.error("Redirect login error:", error);
        if (error.code !== 'auth/no-recent-redirect-operation') {
          toast.error(`Login failed: ${error.message}`);
        }
      }
    };
    handleRedirect();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        
        // Check if user is master admin by email
        const isMasterAdminEmail = firebaseUser.email === 'deveshkapoork@gmail.com' && firebaseUser.emailVerified;
        
        try {
          // Try to get user doc
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userDocRef);
          
          if (userSnap.exists()) {
            const userData = userSnap.data();
            const updates: any = { lastSeen: Timestamp.now() };
            
            // Force master-admin role if email matches
            if (isMasterAdminEmail && userData.role !== 'master-admin') {
              updates.role = 'master-admin';
            }
            
            await updateDoc(userDocRef, updates);
            const role = userData.role;
            setIsMasterAdmin(role === 'master-admin' || isMasterAdminEmail);
            setIsAdminUser(role === 'admin' || role === 'master-admin' || isMasterAdminEmail);
          } else {
            // Create user doc if it doesn't exist
            const role = isMasterAdminEmail ? 'master-admin' : 'user';
            await setDoc(userDocRef, {
              name: firebaseUser.displayName,
              email: firebaseUser.email,
              role: role,
              createdAt: Timestamp.now(),
              lastSeen: Timestamp.now()
            });
            setIsMasterAdmin(role === 'master-admin');
            setIsAdminUser(role === 'master-admin');
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
          // Fallback to master admin check if Firestore fails (e.g. permission denied)
          setIsMasterAdmin(isMasterAdminEmail);
          setIsAdminUser(isMasterAdminEmail);
        }
      } else {
        setUser(null);
        setIsAdminUser(false);
        setIsMasterAdmin(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user && isAdminUser) {
      fetchStats();
    }
  }, [user, isAdminUser, activeTab]);

  const handleNavigate = (tab: Tab, filters?: any) => {
    setActiveTab(tab);
    setNavigationFilter(filters);
    setIsSidebarOpen(false);
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setNavigationFilter(null); // Clear AI filters on manual navigation
    setIsSidebarOpen(false);
  };

  async function fetchStats() {
    if (!user || !isAdminUser) return;
    try {
      const itemsQuery = query(collection(db, 'items'), where('status', '==', 'in'), where('userId', '==', user.uid));
      const ordersQuery = query(collection(db, 'orders'), where('userId', '==', user.uid));
      const customersQuery = query(collection(db, 'customers'), where('userId', '==', user.uid));

      const [productsSnap, itemsInSnap, ordersSnap, customersSnap] = await Promise.all([
        getDocs(collection(db, 'products')),
        getDocs(itemsQuery),
        getDocs(ordersQuery),
        getDocs(customersQuery)
      ]);

      setStats({
        totalProducts: productsSnap.size,
        totalItemsIn: itemsInSnap.size,
        totalOrders: ordersSnap.size,
        totalBalance: customersSnap.docs.reduce((sum, doc) => sum + (doc.data().balance || 0), 0)
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  }

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // On mobile, popups are often blocked, so we use redirect as a fallback
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const isIframe = window.self !== window.top;

      if (isMobile && !isIframe) {
        await signInWithRedirect(auth, provider);
      } else {
        try {
          await signInWithPopup(auth, provider);
          toast.success("Logged in successfully");
        } catch (error: any) {
          console.error("Popup login error:", error);
          if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') {
            if (isIframe) {
              toast.error("Login popup blocked. Please use the 'Open in New Tab' button below to login safely.");
            } else {
              toast.error("Login popup blocked. Please allow popups or try again.");
              await signInWithRedirect(auth, provider);
            }
          } else {
            toast.error(`Login failed: ${error.message}`);
          }
        }
      }
    } catch (error: any) {
      console.error("Login error:", error);
      toast.error(`Login failed: ${error.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success("Logged out successfully");
    } catch (error) {
      toast.error("Logout failed");
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-4">
        <Toaster position="top-center" />
        <div className="max-w-md w-full bg-white rounded-[2.5rem] p-12 shadow-2xl shadow-orange-100 border border-orange-50 text-center animate-in fade-in zoom-in duration-500">
          <div className="w-24 h-24 bg-orange-500 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-lg shadow-orange-200 rotate-3">
            <Scan className="text-white" size={48} />
          </div>
          <h1 className="text-4xl font-black text-gray-900 mb-4 tracking-tight">KAP Genuine</h1>
          <p className="text-gray-500 mb-10 text-lg leading-relaxed">
            Serialized inventory management with unique QR code tracking.
          </p>
          <div className="space-y-4">
            <button
              onClick={handleLogin}
              className="w-full py-5 bg-gray-900 text-white rounded-2xl font-bold text-lg hover:bg-black transition-all flex items-center justify-center gap-3 shadow-xl shadow-gray-200"
            >
              <LogIn size={24} /> Sign in with Google
            </button>

            {window.self !== window.top && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-4 border-2 border-gray-900 text-gray-900 rounded-2xl font-bold text-lg hover:bg-gray-50 transition-all flex items-center justify-center gap-3"
              >
                <ExternalLink size={24} /> Open in New Tab
              </a>
            )}

            <p className="text-xs text-gray-400">
              If login fails in mobile preview, use the "Open in New Tab" button above.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'scan', label: 'Quick Scan', icon: Scan },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'orders', label: 'Orders', icon: ShoppingCart },
    { id: 'ledger', label: 'Ledger', icon: BookOpen },
    ...(isMasterAdmin ? [{ id: 'admin', label: 'Admin Controls', icon: Shield }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      <Toaster position="top-center" richColors />
      
      {/* Mobile Menu Toggle */}
      <button 
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="lg:hidden fixed top-6 right-6 z-50 p-3 bg-white rounded-2xl shadow-lg border border-gray-100"
      >
        {isSidebarOpen ? <X /> : <Menu />}
      </button>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-gray-100 transition-transform duration-300 lg:translate-x-0 lg:static",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col p-8">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-100">
              <Scan className="text-white" size={20} />
            </div>
            <h1 className="text-xl font-black text-gray-900 tracking-tight">KAP Genuine</h1>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id as Tab)}
                className={cn(
                  "w-full flex items-center gap-4 px-4 py-4 rounded-2xl font-bold transition-all",
                  activeTab === item.id 
                    ? "bg-orange-500 text-white shadow-lg shadow-orange-100" 
                    : "text-gray-400 hover:text-gray-900 hover:bg-gray-50"
                )}
              >
                <item.icon size={22} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-8 border-t border-gray-50">
            <div className="flex items-center gap-3 mb-6">
              <img src={user.photoURL} alt={user.displayName} className="w-10 h-10 rounded-xl border-2 border-orange-100" />
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-gray-900 truncate">{user.displayName}</p>
                  {(isMasterAdmin || isAdminUser) && (
                    <span className={cn(
                      "px-2 py-0.5 text-[8px] font-black uppercase rounded-full shrink-0",
                      isMasterAdmin ? "bg-purple-100 text-purple-600" : "bg-orange-100 text-orange-600"
                    )}>
                      {isMasterAdmin ? 'master admin' : 'admin'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 truncate">{user.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl font-bold text-red-500 hover:bg-red-50 transition-all"
            >
              <LogOut size={22} />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 lg:p-12 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'dashboard' && (
            <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <header>
                <h2 className="text-4xl font-black text-gray-900 mb-2">Welcome back!</h2>
                <p className="text-gray-500 text-lg">Here's what's happening with your inventory today.</p>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-gray-900 text-white p-10 rounded-[2.5rem] shadow-2xl shadow-gray-200">
                  <h3 className="text-2xl font-bold mb-6">Quick Actions</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => handleTabChange('scan')}
                      className="p-6 bg-white/10 rounded-3xl hover:bg-white/20 transition-all text-left"
                    >
                      <Scan className="mb-4 text-orange-500" size={32} />
                      <p className="font-bold">Scan Item</p>
                      <p className="text-xs text-white/50">In/Out update</p>
                    </button>
                    <button 
                      onClick={() => handleTabChange('orders')}
                      className="p-6 bg-white/10 rounded-3xl hover:bg-white/20 transition-all text-left"
                    >
                      <ShoppingCart className="mb-4 text-orange-500" size={32} />
                      <p className="font-bold">New Order</p>
                      <p className="text-xs text-white/50">Create sales order</p>
                    </button>
                  </div>
                </div>
                <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100">
                  <div className="flex justify-between items-center mb-8">
                    <h3 className="text-2xl font-bold text-gray-900">Recent Activity</h3>
                    <Clock className="text-gray-300" />
                  </div>
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <p className="text-gray-600 flex-1">System is online and ready</p>
                      <p className="text-xs text-gray-400 font-bold">NOW</p>
                    </div>
                    <div className="flex items-center gap-4 opacity-50">
                      <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                      <p className="text-gray-600 flex-1">Welcome to KAP Genuine</p>
                      <p className="text-xs text-gray-400 font-bold">1M AGO</p>
                    </div>
                  </div>
                </div>
              </div>

              {isAdminUser && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                    <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center mb-6">
                      <Package size={24} />
                    </div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Total SKUs</p>
                    <p className="text-3xl font-black text-gray-900">{stats.totalProducts}</p>
                  </div>
                  <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                    <div className="w-12 h-12 bg-green-50 text-green-500 rounded-2xl flex items-center justify-center mb-6">
                      <CheckCircle2 size={24} />
                    </div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Items In Stock</p>
                    <p className="text-3xl font-black text-gray-900">{stats.totalItemsIn}</p>
                  </div>
                  <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                    <div className="w-12 h-12 bg-orange-50 text-orange-500 rounded-2xl flex items-center justify-center mb-6">
                      <TrendingUp size={24} />
                    </div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Total Orders</p>
                    <p className="text-3xl font-black text-gray-900">{stats.totalOrders}</p>
                  </div>
                  <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                    <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-6">
                      <AlertCircle size={24} />
                    </div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Total Receivables</p>
                    <p className="text-3xl font-black text-gray-900">₹{stats.totalBalance}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'scan' && (
            <div className="max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-3xl font-black text-gray-900 mb-8">Quick Scan</h2>
              <Scanner mode="inventory" />
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Inventory isAdmin={isAdminUser} initialFilter={navigationFilter} />
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Orders isAdmin={isAdminUser} initialFilter={navigationFilter} />
            </div>
          )}

          {activeTab === 'ledger' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Ledger isAdmin={isAdminUser} initialFilter={navigationFilter} />
            </div>
          )}

          {activeTab === 'admin' && isMasterAdmin && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <AdminControls />
            </div>
          )}
        </div>
      </main>
      <ChatBot onNavigate={handleNavigate} />
    </div>
  );
}
