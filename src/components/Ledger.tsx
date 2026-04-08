import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, where, Timestamp, orderBy, updateDoc, doc, writeBatch, increment } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Customer, LedgerEntry } from '../types';
import { toast } from 'sonner';
import { UserPlus, BookOpen, Search, ArrowUpRight, ArrowDownLeft, X, History, User, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';

interface LedgerProps {
  isAdmin?: boolean;
  initialFilter?: {
    search?: string;
    customerName?: string;
    month?: string;
  } | null;
}

export default function Ledger({ isAdmin = false, initialFilter = null }: LedgerProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', balance: 0 });
  const [loading, setLoading] = useState(false);
  const [showWaiveConfirm, setShowWaiveConfirm] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isMerging, setIsMerging] = useState(false);

  useEffect(() => {
    fetchCustomers();
    
    if (initialFilter) {
      if (initialFilter.customerName) {
        setSearchQuery(initialFilter.customerName);
      } else if (initialFilter.search) {
        setSearchQuery(initialFilter.search);
      }
    } else {
      setSearchQuery('');
    }
  }, [initialFilter]);

  async function mergeDuplicates() {
    const groups = new Map<string, Customer[]>();
    customers.forEach(c => {
      const name = c.name.trim().toLowerCase();
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(c);
    });

    const duplicates = Array.from(groups.values()).filter(g => (g?.length || 0) > 1);
    
    if ((duplicates?.length || 0) === 0) {
      toast.info("No duplicate customers found");
      return;
    }

    if (!window.confirm(`Found ${duplicates?.length || 0} sets of duplicate customers. Do you want to merge them? This will consolidate all their history and balances.`)) {
      return;
    }

    setIsMerging(true);
    setLoading(true);
    try {
      for (const group of duplicates) {
        const [primary, ...others] = group;
        let totalBalanceToAdd = 0;
        const batch = writeBatch(db);
        let batchCount = 0;

        for (const duplicate of others) {
          totalBalanceToAdd += duplicate.balance;

          // Find and update ledger entries
          const ledgerSnap = await getDocs(query(collection(db, 'ledger'), where('customerId', '==', duplicate.id)));
          ledgerSnap.docs.forEach(d => {
            batch.update(d.ref, { customerId: primary.id });
            batchCount++;
          });

          // Find and update orders
          const ordersSnap = await getDocs(query(collection(db, 'orders'), where('customerId', '==', duplicate.id)));
          ordersSnap.docs.forEach(d => {
            batch.update(d.ref, { customerId: primary.id });
            batchCount++;
          });

          // Delete duplicate customer
          batch.delete(doc(db, 'customers', duplicate.id));
          batchCount++;

          // Commit if batch is getting full
          if (batchCount > 400) {
            await batch.commit();
            // Start a new batch if needed (though unlikely for a single group)
            // For simplicity, we'll assume one group fits in 500 or we commit per group
          }
        }

        // Update primary customer balance
        batch.update(doc(db, 'customers', primary.id), {
          balance: increment(totalBalanceToAdd)
        });
        
        await batch.commit();
      }

      toast.success("Duplicate customers merged successfully");
      fetchCustomers();
      setSelectedCustomer(null);
    } catch (error) {
      console.error("Error merging duplicates:", error);
      toast.error("Failed to merge duplicates");
    } finally {
      setLoading(false);
      setIsMerging(false);
    }
  }

  async function fetchCustomers() {
    if (!auth.currentUser) return;
    const customersQuery = query(collection(db, 'customers'), where('userId', '==', auth.currentUser.uid));
    const snap = await getDocs(customersQuery);
    setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
  }

  async function fetchLedger(customerId: string) {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'ledger'),
      where('customerId', '==', customerId),
      where('userId', '==', auth.currentUser.uid),
      orderBy('timestamp', 'desc')
    );
    const snap = await getDocs(q);
    setLedgerEntries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerEntry)));
  }

  async function handleAddCustomer() {
    if (!newCustomer.name) {
      toast.error("Please enter customer name");
      return;
    }

    const normalizedName = newCustomer.name.trim().toLowerCase();
    const existingCustomer = customers.find(c => c.name.toLowerCase() === normalizedName);

    if (existingCustomer) {
      toast.error(`Customer "${existingCustomer.name}" already exists`);
      return;
    }

    setLoading(true);
    try {
      await addDoc(collection(db, 'customers'), {
        ...newCustomer,
        name: newCustomer.name.trim(),
        userId: auth.currentUser?.uid
      });
      toast.success("Customer added successfully");
      setShowAddCustomer(false);
      setNewCustomer({ name: '', balance: 0 });
      fetchCustomers();
    } catch (error) {
      console.error("Error adding customer:", error);
      toast.error("Failed to add customer");
    } finally {
      setLoading(false);
    }
  }

  async function handleWaiveBalance() {
    if (!selectedCustomer || selectedCustomer.balance <= 0) return;
    
    setLoading(true);
    try {
      const amountToWaive = selectedCustomer.balance;
      
      // 1. Add ledger entry
      await addDoc(collection(db, 'ledger'), {
        customerId: selectedCustomer.id,
        amount: amountToWaive,
        type: 'credit',
        timestamp: Timestamp.now(),
        note: 'Balance Waived',
        userId: auth.currentUser?.uid
      });

      // 2. Update customer balance
      await updateDoc(doc(db, 'customers', selectedCustomer.id), {
        balance: 0
      });

      toast.success("Balance waived successfully");
      
      // Update local state
      const updatedCustomer = { ...selectedCustomer, balance: 0 };
      setSelectedCustomer(updatedCustomer);
      setCustomers(prev => prev.map(c => c.id === updatedCustomer.id ? updatedCustomer : c));
      fetchLedger(updatedCustomer.id);
      setShowWaiveConfirm(false);
    } catch (error) {
      console.error("Error waiving balance:", error);
      toast.error("Failed to waive balance");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddPayment() {
    if (!selectedCustomer || !paymentAmount || parseFloat(paymentAmount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    
    setLoading(true);
    try {
      const amount = parseFloat(paymentAmount);
      
      // 1. Add ledger entry
      await addDoc(collection(db, 'ledger'), {
        customerId: selectedCustomer.id,
        amount: amount,
        type: 'credit',
        timestamp: Timestamp.now(),
        note: 'Manual Payment',
        userId: auth.currentUser?.uid
      });

      // 2. Update customer balance
      await updateDoc(doc(db, 'customers', selectedCustomer.id), {
        balance: selectedCustomer.balance - amount
      });

      toast.success("Payment recorded successfully");
      
      // Update local state
      const updatedCustomer = { ...selectedCustomer, balance: selectedCustomer.balance - amount };
      setSelectedCustomer(updatedCustomer);
      setCustomers(prev => prev.map(c => c.id === updatedCustomer.id ? updatedCustomer : c));
      fetchLedger(updatedCustomer.id);
      setShowAddPayment(false);
      setPaymentAmount('');
    } catch (error) {
      console.error("Error adding payment:", error);
      toast.error("Failed to record payment");
    } finally {
      setLoading(false);
    }
  }

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => b.balance - a.balance);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-900">Customer Ledger</h2>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
            />
          </div>
          <button
            onClick={mergeDuplicates}
            disabled={loading || isMerging}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw size={20} className={cn(isMerging && "animate-spin")} />
            <span className="hidden sm:inline">Merge</span>
          </button>
          <button
            onClick={() => setShowAddCustomer(true)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors shrink-0"
          >
            <UserPlus size={20} /> <span className="hidden sm:inline">Add Customer</span>
          </button>
        </div>
      </div>

      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">New Customer</h3>
              <button onClick={() => setShowAddCustomer(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Store/Customer Name</label>
                <input
                  type="text"
                  value={newCustomer.name}
                  onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="e.g. Retail Store A"
                />
              </div>
                <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Opening Balance (₹)</label>
                <input
                  type="number"
                  value={newCustomer.balance}
                  onChange={e => setNewCustomer({ ...newCustomer, balance: parseFloat(e.target.value) || 0 })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="0.00"
                />
              </div>
              <button
                onClick={handleAddCustomer}
                disabled={loading}
                className="w-full py-4 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                {loading ? "Adding..." : "Save Customer"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredCustomers.length === 0 ? (
          <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-gray-100">
            <Search className="mx-auto text-gray-200 mb-4" size={48} />
            <p className="text-gray-500">No customers found matching your search.</p>
          </div>
        ) : (
          filteredCustomers.map(customer => (
            <div
              key={customer.id}
              onClick={() => {
                setSelectedCustomer(customer);
                fetchLedger(customer.id);
              }}
              className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-orange-50 text-orange-500 rounded-xl group-hover:bg-orange-500 group-hover:text-white transition-colors">
                  <User size={24} />
                </div>
                <p className={cn(
                  "text-lg font-bold",
                  customer.balance > 0 ? "text-red-600" : "text-green-600"
                )}>
                  ₹{customer.balance}
                </p>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">{customer.name}</h3>
              <p className="text-xs text-gray-400 uppercase font-bold tracking-widest">Current Balance</p>
            </div>
          ))
        )}
      </div>

      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-4xl h-[80vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div className="flex items-center gap-3">
                <History className="text-orange-500" />
                <h3 className="text-xl font-bold text-gray-900">Ledger: {selectedCustomer.name}</h3>
              </div>
              <button onClick={() => setSelectedCustomer(null)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {ledgerEntries.map(entry => (
                  <div key={entry.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "p-2 rounded-lg",
                        entry.type === 'debit' ? "bg-red-50 text-red-500" : "bg-green-50 text-green-500"
                      )}>
                        {entry.type === 'debit' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">
                          {entry.type === 'debit' ? 'Sales Order' : 'Payment Received'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {format(entry.timestamp.toDate(), 'MMM dd, yyyy HH:mm')}
                        </p>
                      </div>
                    </div>
                    <p className={cn(
                      "text-lg font-bold",
                      entry.type === 'debit' ? "text-red-600" : "text-green-600"
                    )}>
                      {entry.type === 'debit' ? '-' : '+'}₹{entry.amount}
                    </p>
                  </div>
                ))}
                {(ledgerEntries?.length || 0) === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 py-20">
                    <BookOpen size={48} className="mb-2 opacity-20" />
                    <p>No transactions yet</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              <div className="flex flex-col gap-2">
                <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Account Actions</p>
                <div className="flex items-center gap-3">
                  {selectedCustomer.balance > 0 && (
                    <>
                      <button
                        onClick={() => setShowAddPayment(true)}
                        className="px-4 py-2 bg-green-50 text-green-600 rounded-xl text-xs font-bold hover:bg-green-100 transition-colors"
                      >
                        Add Payment
                      </button>
                      <button
                        onClick={() => setShowWaiveConfirm(true)}
                        className="px-4 py-2 bg-yellow-50 text-yellow-600 rounded-xl text-xs font-bold hover:bg-yellow-100 transition-colors"
                      >
                        Waive Balance
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-500 font-bold uppercase tracking-widest text-xs mb-1">Outstanding Balance</p>
                <p className={cn(
                  "text-2xl font-bold",
                  selectedCustomer.balance > 0 ? "text-red-600" : "text-green-600"
                )}>
                  ₹{selectedCustomer.balance}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWaiveConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300 text-center">
            <div className="w-16 h-16 bg-yellow-50 text-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Waive Balance?</h3>
            <p className="text-gray-500 mb-6">
              Are you sure you want to waive the balance of <span className="font-bold text-gray-900">₹{selectedCustomer?.balance}</span> for {selectedCustomer?.name}? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowWaiveConfirm(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleWaiveBalance}
                disabled={loading}
                className="flex-1 py-3 bg-yellow-600 text-white rounded-xl font-bold hover:bg-yellow-700 transition-colors disabled:opacity-50"
              >
                {loading ? "Waiving..." : "Yes, Waive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddPayment && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">Record Payment</h3>
              <button onClick={() => setShowAddPayment(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Amount Received (₹)</label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowAddPayment(false)}
                  className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddPayment}
                  disabled={loading || !paymentAmount}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {loading ? "Recording..." : "Save Payment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
