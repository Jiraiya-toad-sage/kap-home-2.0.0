import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, where, Timestamp, updateDoc, doc, increment, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Product, Item, Order, Customer } from '../types';
import { toast } from 'sonner';
import Scanner from './Scanner';
import { Plus, ShoppingCart, Check, X, User, DollarSign, History, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';

interface OrdersProps {
  isAdmin?: boolean;
  initialFilter?: {
    search?: string;
    customerName?: string;
    month?: string;
  } | null;
}

export default function Orders({ isAdmin = false, initialFilter = null }: OrdersProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderDetails, setOrderDetails] = useState<{ item: Item; product: Product }[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<{
    customerId: string;
    items: { item: Item; product: Product }[];
  } | null>(null);
  const [amountReceived, setAmountReceived] = useState<number>(0);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const orderListRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (orderListRef.current) {
      orderListRef.current.scrollTop = orderListRef.current.scrollHeight;
    }
  }, [currentOrder?.items?.length]);

  useEffect(() => {
    fetchOrders();
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

  async function fetchOrders() {
    if (!auth.currentUser) return;
    const ordersQuery = query(collection(db, 'orders'), where('userId', '==', auth.currentUser.uid));
    const snap = await getDocs(ordersQuery);
    setOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
  }

  async function fetchCustomers() {
    if (!auth.currentUser) return;
    const customersQuery = query(collection(db, 'customers'), where('userId', '==', auth.currentUser.uid));
    const snap = await getDocs(customersQuery);
    setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
  }
  
  async function fetchOrderDetails(order: Order) {
    setSelectedOrder(order);
    setLoadingDetails(true);
    setOrderDetails([]);
    setExpandedProduct(null);
    
    try {
      const details: { item: Item; product: Product }[] = [];
      
      for (const itemId of (order.items || [])) {
        const itemSnap = await getDocs(query(collection(db, 'items'), where('__name__', '==', itemId)));
        if (!itemSnap.empty) {
          const itemData = { id: itemSnap.docs[0].id, ...itemSnap.docs[0].data() } as Item;
          const productSnap = await getDocs(query(collection(db, 'products'), where('__name__', '==', itemData.skuId)));
          if (!productSnap.empty) {
            const productData = { id: productSnap.docs[0].id, ...productSnap.docs[0].data() } as Product;
            details.push({ item: itemData, product: productData });
          }
        }
      }
      
      setOrderDetails(details);
    } catch (error) {
      console.error("Error fetching order details:", error);
      toast.error("Failed to load order details");
    } finally {
      setLoadingDetails(false);
    }
  }

  async function addNewCustomer() {
    if (!newCustomerName.trim()) return;
    
    const normalizedName = newCustomerName.trim().toLowerCase();
    const existingCustomer = customers.find(c => c.name.toLowerCase() === normalizedName);

    if (existingCustomer) {
      setCurrentOrder(prev => prev ? { ...prev, customerId: existingCustomer.id } : null);
      setNewCustomerName('');
      toast.info(`Using existing customer: ${existingCustomer.name}`);
      return;
    }

    try {
      const docRef = await addDoc(collection(db, 'customers'), {
        name: newCustomerName.trim(),
        balance: 0,
        userId: auth.currentUser?.uid
      });
      const newCust = { id: docRef.id, name: newCustomerName.trim(), balance: 0, userId: auth.currentUser?.uid };
      setCustomers(prev => [...prev, newCust]);
      setCurrentOrder(prev => prev ? { ...prev, customerId: docRef.id } : null);
      setNewCustomerName('');
      toast.success("Customer added");
    } catch (error) {
      toast.error("Failed to add customer");
    }
  }

  function handleItemScanned(item: Item, product: Product) {
    setCurrentOrder(prev => {
      if (!prev) return prev;
      
      // Check if item already in current order
      if (prev?.items?.some(i => i.item.id === item.id)) {
        toast.error("Item already added to this order");
        return prev;
      }

      return {
        ...prev,
        items: [...(prev?.items || []), { item, product }]
      };
    });
  }

  const totalAmount = currentOrder?.items?.reduce((sum, i) => sum + i.product.price, 0) || 0;

  const groupedItems = React.useMemo(() => {
    if (!currentOrder) return [];
    const groups: { product: Product; count: number; totalPrice: number; itemIds: string[] }[] = [];
    
    currentOrder?.items?.forEach(itemEntry => {
      const existing = groups.find(g => g.product.id === itemEntry.product.id);
      if (existing) {
        existing.count += 1;
        existing.totalPrice += itemEntry.product.price;
        existing.itemIds.push(itemEntry.item.id);
      } else {
        groups.push({
          product: itemEntry.product,
          count: 1,
          totalPrice: itemEntry.product.price,
          itemIds: [itemEntry.item.id]
        });
      }
    });
    
    return groups;
  }, [currentOrder?.items]);

  async function submitOrder() {
    if (!currentOrder || !currentOrder.items || amountReceived > totalAmount) {
      toast.error("Invalid payment amount");
      return;
    }

    setLoading(true);
    const batch = writeBatch(db);

    try {
      // 1. Create Order
      const orderData = {
        customerId: currentOrder?.customerId || '',
        items: currentOrder?.items?.map(i => i.item.id) || [],
        totalAmount,
        amountReceived,
        status: 'confirmed' as const,
        createdAt: Timestamp.now(),
        userId: auth.currentUser?.uid
      };
      const orderRef = doc(collection(db, 'orders'));
      batch.set(orderRef, orderData);

      // 2. Update Items Status to 'out'
      currentOrder?.items?.forEach(i => {
        batch.update(doc(db, 'items', i.item.id), {
          status: 'out',
          lastUpdated: Timestamp.now()
        });
      });

      // 3. Update Customer Balance (Ledger)
      // Balance = currentBalance + (total - received)
      const balanceChange = totalAmount - amountReceived;
      batch.update(doc(db, 'customers', currentOrder.customerId), {
        balance: increment(balanceChange)
      });

      // 4. Create Ledger Entry
      const ledgerRef = doc(collection(db, 'ledger'));
      batch.set(ledgerRef, {
        customerId: currentOrder.customerId,
        orderId: orderRef.id,
        amount: totalAmount,
        type: 'debit',
        timestamp: Timestamp.now(),
        userId: auth.currentUser?.uid
      });

      if (amountReceived > 0) {
        const paymentRef = doc(collection(db, 'ledger'));
        batch.set(paymentRef, {
          customerId: currentOrder.customerId,
          orderId: orderRef.id,
          amount: amountReceived,
          type: 'credit',
          timestamp: Timestamp.now(),
          userId: auth.currentUser?.uid
        });
      }

      await batch.commit();
      toast.success("Order completed successfully");
      setShowNewOrder(false);
      setShowPaymentModal(false);
      setCurrentOrder(null);
      setAmountReceived(0);
      fetchOrders();
      fetchCustomers();
    } catch (error) {
      console.error("Error submitting order:", error);
      toast.error("Failed to complete order");
    } finally {
      setLoading(false);
    }
  }

  async function toggleOrderStatus(order: Order, e: React.MouseEvent) {
    e.stopPropagation();
    const newStatus = order.status === 'confirmed' ? 'delivered' : 'confirmed';
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        status: newStatus
      });
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
      toast.success(`Order marked as ${newStatus}`);
    } catch (error) {
      console.error("Error updating order status:", error);
      toast.error("Failed to update status");
    }
  }

  const filteredOrders = orders.filter(order => {
    const customer = customers.find(c => c.id === order.customerId);
    const searchLower = searchQuery.toLowerCase();
    
    // Filter by search query (customer name or order ID)
    const matchesSearch = 
      order.id.toLowerCase().includes(searchLower) ||
      (customer?.name || '').toLowerCase().includes(searchLower) ||
      (order.status || '').toLowerCase().includes(searchLower);

    // Filter by month if provided in initialFilter
    let matchesMonth = true;
    if (initialFilter?.month && order.createdAt) {
      const orderDate = order.createdAt.toDate();
      const monthName = format(orderDate, 'MMMM').toLowerCase();
      const monthShort = format(orderDate, 'MMM').toLowerCase();
      const filterMonth = initialFilter.month.toLowerCase();
      matchesMonth = monthName.includes(filterMonth) || monthShort.includes(filterMonth);
    }

    return matchesSearch && matchesMonth;
  }).sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-900">Orders & History</h2>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search by customer or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
            />
          </div>
          <button
            onClick={() => {
              setShowNewOrder(true);
              setCurrentOrder({ customerId: '', items: [] });
            }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors shrink-0"
          >
            <Plus size={20} /> <span className="hidden sm:inline">New Order</span>
          </button>
        </div>
      </div>

      {showNewOrder && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col h-screen overflow-hidden md:bg-black/50 md:backdrop-blur-sm md:items-center md:justify-center md:p-4">
          <div className="bg-white w-full h-full md:max-w-4xl md:h-[90vh] md:rounded-3xl overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-300">
            {/* Mobile Header */}
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white shrink-0 md:bg-gray-50 md:p-6">
              <div className="flex items-center gap-3">
                <ShoppingCart className="text-orange-500" />
                <h3 className="text-xl font-bold text-gray-900">New Order</h3>
              </div>
              <button onClick={() => setShowNewOrder(false)} className="text-gray-400 hover:text-gray-600 p-2">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              {/* Left: Scanner */}
              <div className={cn(
                "w-full flex flex-col overflow-hidden border-r border-gray-100",
                "md:w-1/2 md:h-auto h-[60vh]"
              )}>
                <div className="flex-1 relative bg-black md:bg-transparent">
                  <Scanner mode="order" onItemScanned={handleItemScanned} continuous={true} minimal={true} />
                </div>
              </div>

              {/* Right: Order List */}
              <div className={cn(
                "w-full flex flex-col bg-gray-50/50 overflow-hidden",
                "md:w-1/2 md:h-auto h-[40vh]"
              )}>
                <div className="p-3 border-b border-gray-100 flex justify-between items-center shrink-0 md:p-4 md:border-0 md:mb-2">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Items ({currentOrder?.items?.length || 0})</h4>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-gray-900">₹{totalAmount}</p>
                    {currentOrder?.items?.length > 0 && (
                      <button 
                        onClick={() => setCurrentOrder(prev => prev ? { ...prev, items: [] } : null)}
                        className="text-[10px] text-red-500 font-bold hover:underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div ref={orderListRef} className="flex-1 overflow-y-auto p-2 space-y-1.5 scroll-smooth md:pr-2">
                  {groupedItems.map((group, idx) => (
                    <div key={idx} className="bg-white p-2.5 rounded-lg shadow-sm border border-gray-100 flex justify-between items-center group">
                      <div className="flex-1">
                        <p className="text-sm font-bold text-gray-900 leading-tight">
                          {group.count} set {group.product.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-sm font-bold text-gray-900">₹{group.totalPrice}</p>
                        <button 
                          onClick={() => {
                            const newItems = [...(currentOrder?.items || [])];
                            // Find index of the last item of this product
                            const lastIdx = [...newItems].reverse().findIndex(i => i.product.id === group.product.id);
                            if (lastIdx !== -1) {
                              const actualIdx = newItems.length - 1 - lastIdx;
                              newItems.splice(actualIdx, 1);
                              setCurrentOrder({ ...currentOrder, items: newItems });
                            }
                          }}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {(!currentOrder || currentOrder?.items?.length === 0) && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50 py-8">
                      <ShoppingCart size={32} className="mb-2" />
                      <p className="text-xs">No items scanned</p>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-white border-t border-gray-200 shrink-0 md:mt-4 md:pt-4 md:border-t md:bg-transparent">
                  <button
                    onClick={() => setShowCustomerModal(true)}
                    disabled={currentOrder?.items?.length === 0}
                    className="w-full py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors disabled:opacity-50 shadow-lg shadow-orange-200"
                  >
                    Order Done (₹{totalAmount})
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCustomerModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white w-full max-w-lg rounded-3xl overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-300 max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-bold text-gray-900">Finalize Order</h3>
              <button onClick={() => setShowCustomerModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Customer Selection */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Select Customer</label>
                  <select
                    value={currentOrder?.customerId || ''}
                    onChange={e => setCurrentOrder(prev => prev ? { ...prev, customerId: e.target.value } : null)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  >
                    <option value="">Choose a customer...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} (₹{c.balance})</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCustomerName}
                    onChange={e => setNewCustomerName(e.target.value)}
                    placeholder="New customer name..."
                    className="flex-1 px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <button
                    onClick={addNewCustomer}
                    className="px-4 py-2 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-colors text-sm"
                  >
                    Add New
                  </button>
                </div>
              </div>

              {/* Notebook Style Item List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Order Summary</h4>
                <div className="bg-[#fdfbf7] border border-gray-200 rounded-xl overflow-hidden shadow-inner">
                  <div className="divide-y divide-blue-100">
                    {groupedItems.map((group, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2 px-4 hover:bg-blue-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold text-blue-300 w-4">{idx + 1}.</span>
                          <span className="text-sm text-gray-700 font-medium">{group.count} set {group.product.name}</span>
                        </div>
                        <span className="text-sm font-bold text-gray-900">₹{group.totalPrice}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between items-center px-4 pt-2">
                  <span className="text-sm font-bold text-gray-500">Total Amount</span>
                  <span className="text-2xl font-bold text-orange-600">₹{totalAmount}</span>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 shrink-0">
              <button
                onClick={() => {
                  if (!currentOrder?.customerId) {
                    toast.error("Please select or add a customer");
                    return;
                  }
                  setShowCustomerModal(false);
                  setShowPaymentModal(true);
                }}
                className="w-full py-4 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors shadow-lg shadow-orange-200"
              >
                Complete Order
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
            <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">Payment Details</h3>
            <p className="text-sm text-gray-500 mb-6 text-center">Total Order Value: <span className="font-bold text-gray-900">₹{totalAmount}</span></p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Amount Received</label>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="number"
                    value={amountReceived}
                    onChange={e => setAmountReceived(parseFloat(e.target.value) || 0)}
                    className="w-full pl-12 pr-4 py-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none text-2xl font-bold"
                    max={totalAmount}
                  />
                </div>
                {amountReceived > totalAmount && (
                  <p className="text-xs text-red-500 mt-1 font-bold">Cannot exceed total amount</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={submitOrder}
                  disabled={loading || amountReceived > totalAmount}
                  className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {loading ? "Processing..." : "Submit Order"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col h-screen overflow-hidden md:bg-black/50 md:backdrop-blur-sm md:items-center md:justify-center md:p-4">
          <div className="bg-white w-full h-full md:max-w-2xl md:h-[80vh] md:rounded-3xl overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <div className="flex items-center gap-3">
                <History className="text-orange-500" />
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Order Details</h3>
                  <p className="text-xs text-gray-400 font-mono">{selectedOrder.id}</p>
                </div>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="text-gray-400 hover:text-gray-600 p-2">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Customer</p>
                  <p className="font-bold text-gray-900">
                    {customers.find(c => c.id === selectedOrder.customerId)?.name || 'Unknown'}
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Date</p>
                  <p className="font-bold text-gray-900">
                    {format(selectedOrder.createdAt.toDate(), 'MMM dd, yyyy HH:mm')}
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Status</p>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-xs font-bold uppercase",
                    selectedOrder.status === 'delivered' ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                  )}>
                    {selectedOrder.status}
                  </span>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Total Items</p>
                  <p className="font-bold text-gray-900">{selectedOrder?.items?.length || 0}</p>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Items List</h4>
                {loadingDetails ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p>Loading items...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const groups: { product: Product; count: number; totalPrice: number; items: Item[] }[] = [];
                      orderDetails.forEach(detail => {
                        const existing = groups.find(g => g.product.id === detail.product.id);
                        if (existing) {
                          existing.count += 1;
                          existing.totalPrice += detail.product.price;
                          existing.items.push(detail.item);
                        } else {
                          groups.push({
                            product: detail.product,
                            count: 1,
                            totalPrice: detail.product.price,
                            items: [detail.item]
                          });
                        }
                      });
                      return groups.map((group, idx) => {
                        const isExpanded = expandedProduct === group.product.id;
                        return (
                          <div key={idx} className="space-y-2">
                            <button 
                              onClick={() => setExpandedProduct(isExpanded ? null : group.product.id)}
                              className={cn(
                                "w-full bg-white p-4 rounded-xl shadow-sm border flex justify-between items-center transition-all",
                                isExpanded ? "border-orange-200 ring-1 ring-orange-100" : "border-gray-100 hover:border-gray-200"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-blue-400 w-5">{idx + 1}.</span>
                                <div className="text-left">
                                  <p className="font-bold text-gray-900">{group.count} set {group.product.name}</p>
                                  <p className="text-[10px] text-gray-400 uppercase tracking-tighter">Unit Price: ₹{group.product.price}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <p className="font-bold text-gray-900">₹{group.totalPrice}</p>
                                {isExpanded ? <ChevronDown size={16} className="text-orange-500" /> : <ChevronRight size={16} className="text-gray-300" />}
                              </div>
                            </button>
                            
                            {isExpanded && (
                              <div className="ml-8 space-y-1.5 animate-in slide-in-from-top-2 duration-200">
                                {group.items.map((item, iIdx) => (
                                  <div key={iIdx} className="bg-gray-50/50 p-2.5 rounded-lg border border-gray-100 flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div>
                                      <p className="text-xs font-mono text-gray-600">{item.qrCode}</p>
                                    </div>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Scanned</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 shrink-0">
              <div className="flex justify-between items-center mb-2">
                <p className="text-gray-500 font-bold">Subtotal</p>
                <p className="font-bold text-gray-900">₹{selectedOrder.totalAmount}</p>
              </div>
              <div className="flex justify-between items-center mb-4">
                <p className="text-gray-500 font-bold">Amount Paid</p>
                <p className="font-bold text-green-600">₹{selectedOrder.amountReceived}</p>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                <p className="text-xl font-bold text-gray-900 uppercase">Total Value</p>
                <p className="text-3xl font-bold text-gray-900">₹{selectedOrder.totalAmount}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-50 flex items-center gap-2">
          <History className="text-gray-400" size={20} />
          <h3 className="font-bold text-gray-900 uppercase tracking-widest text-sm">Order History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Customer</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Items</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Total</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Paid</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredOrders.map(order => (
                <tr 
                  key={order.id} 
                  className="hover:bg-gray-50/50 transition-colors cursor-pointer group"
                  onClick={() => fetchOrderDetails(order)}
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {order.createdAt ? format(order.createdAt.toDate(), 'MMM dd, yyyy HH:mm') : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-900">
                    {customers.find(c => c.id === order.customerId)?.name || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      {order.items?.length || 0} items
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-orange-500 transition-colors" />
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right font-bold text-gray-900">
                    ₹{order.totalAmount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right font-bold text-green-600">
                    ₹{order.amountReceived}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <button
                      onClick={(e) => toggleOrderStatus(order, e)}
                      className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none",
                        order.status === 'delivered' ? "bg-green-500" : "bg-gray-200"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                          order.status === 'delivered' ? "translate-x-6" : "translate-x-1"
                        )}
                      />
                    </button>
                    <p className={cn(
                      "text-[10px] font-bold uppercase mt-1",
                      order.status === 'delivered' ? "text-green-600" : "text-blue-600"
                    )}>
                      {order.status}
                    </p>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400 italic">
                    No orders found matching your search
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
