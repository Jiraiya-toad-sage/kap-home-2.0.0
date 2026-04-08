import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, getDocs, query, where, Timestamp, updateDoc, deleteDoc, doc, orderBy, limit, writeBatch } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Product, Item, Batch } from '../types';
import { toast } from 'sonner';
import QRCode from 'react-qr-code';
import { Plus, Printer, Package, Hash, DollarSign, List, X, Edit2, Trash2, Save, CheckCircle2, ArrowLeft, ChevronRight, Camera, Image as ImageIcon, AlertCircle, FileText, Share2, Download, Send, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { format } from 'date-fns';
import { domToJpeg } from 'modern-screenshot';
import { jsPDF } from 'jspdf';

interface InventoryProps {
  isAdmin?: boolean;
  initialFilter?: {
    search?: string;
    customerName?: string;
    month?: string;
  } | null;
}

export default function Inventory({ isAdmin = false, initialFilter = null }: InventoryProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'catalogue' | 'inventory' | 'batches' | 'none'>('none');
  const [isMrpMode, setIsMrpMode] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', price: 0, image: '' });
  const [bulkGen, setBulkGen] = useState<{ productId: string; count: number } | null>(null);
  const [showBulkSelect, setShowBulkSelect] = useState(false);
  const [generatedItems, setGeneratedItems] = useState<Item[]>([]);
  const [inventoryItems, setInventoryItems] = useState<(Item & { productName?: string })[]>([]);
  const [batches, setBatches] = useState<(Batch & { isCompleted?: boolean })[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedProductForItems, setSelectedProductForItems] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSoldWithoutScanModal, setShowSoldWithoutScanModal] = useState(false);
  const [productForSoldWithoutScan, setProductForSoldWithoutScan] = useState<Product | null>(null);
  const [soldWithoutScanCount, setSoldWithoutScanCount] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const slipsRef = useRef<HTMLDivElement>(null);

  const safeFormatDate = (timestamp: any, formatStr: string) => {
    try {
      if (!timestamp) return 'N/A';
      if (typeof timestamp.toDate === 'function') return format(timestamp.toDate(), formatStr);
      if (timestamp.seconds) return format(new Date(timestamp.seconds * 1000), formatStr);
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return 'N/A';
      return format(date, formatStr);
    } catch (e) {
      return 'N/A';
    }
  };

  const generateImage = async () => {
    if (!slipsRef.current) return null;
    try {
      return await domToJpeg(slipsRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        quality: 0.9,
      });
    } catch (error) {
      console.error("Error generating image:", error);
      return null;
    }
  };

  const handleDownload = async (format: 'jpg' | 'pdf') => {
    setIsGenerating(true);
    try {
      const dataUrl = await generateImage();
      if (!dataUrl) throw new Error("Failed to generate image");

      if (format === 'jpg') {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `slips-${Date.now()}.jpg`;
        link.click();
      } else {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgProps = pdf.getImageProperties(dataUrl);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        pdf.addImage(dataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`slips-${Date.now()}.pdf`);
      }
      toast.success(`${format.toUpperCase()} downloaded successfully`);
    } catch (error) {
      toast.error("Failed to generate file");
    } finally {
      setIsGenerating(false);
      setShowShareModal(false);
    }
  };

  const handleShare = async (platform: 'whatsapp' | 'telegram' | 'native') => {
    setIsGenerating(true);
    try {
      const dataUrl = await generateImage();
      if (!dataUrl) throw new Error("Failed to generate image");

      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `slips-${Date.now()}.jpg`, { type: 'image/jpeg' });

      if (platform === 'native' && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'MRP Slips',
          text: 'Check out these MRP slips',
        });
      } else {
        // For WhatsApp/Telegram, we can't easily share the file directly from web without a server
        // So we fallback to telling the user to download and share, or use native share if possible
        if (navigator.share) {
          await navigator.share({
            files: [file],
            title: 'MRP Slips',
          });
        } else {
          // Fallback: Download and provide instructions
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `slips-${Date.now()}.jpg`;
          link.click();
          
          const url = platform === 'whatsapp' ? 'https://wa.me/' : 'https://t.me/share/url?url=';
          window.open(url, '_blank');
          toast.info(`Image downloaded. You can now share it on ${platform}.`);
        }
      }
    } catch (error) {
      console.error("Share error:", error);
      toast.error("Sharing failed or not supported on this browser");
    } finally {
      setIsGenerating(false);
      setShowShareModal(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchInventory();
    fetchBatches();
    
    if (initialFilter) {
      if (initialFilter.search) {
        setSearchQuery(initialFilter.search);
        // If searching for a product, show inventory
        setActiveView('inventory');
      }
    } else {
      setSearchQuery('');
    }
  }, [isAdmin, initialFilter]);

  useEffect(() => {
    if (activeView === 'batches') {
      fetchBatches();
    }
    if (activeView === 'none') {
      setSearchQuery('');
    }
  }, [activeView]);

  const resizeImage = (base64Str: string, maxWidth = 600, maxHeight = 600): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6)); // Compress to 60% quality
      };
    });
  };

  async function fetchBatches() {
    if (!auth.currentUser) return;
    setDataLoading(true);
    try {
      const batchesQuery = query(collection(db, 'batches'), where('userId', '==', auth.currentUser.uid), orderBy('createdAt', 'desc'));
      
      const batchesSnap = await getDocs(batchesQuery);
      const batchList = batchesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Batch));
      
      // Fetch items filtered by userId
      const itemsQuery = query(collection(db, 'items'), where('userId', '==', auth.currentUser.uid));
        
      const itemsSnap = await getDocs(itemsQuery);
      const allItems = itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));

      // Update inventory items state
      const enrichedInventory = allItems.map(item => ({
        ...item,
        productName: products.find(p => String(p.id || '').trim() === String(item.skuId || '').trim())?.name || 'Unknown Product'
      }));
      setInventoryItems(enrichedInventory);

      // Identify items without batchId and group them by skuId
      const legacyItems = allItems.filter(item => !item.batchId);
      const legacyGroups = legacyItems.reduce((acc, item) => {
        const skuId = String(item.skuId || '').trim();
        if (!acc[skuId]) acc[skuId] = [];
        acc[skuId].push(item);
        return acc;
      }, {} as Record<string, Item[]>);

      const legacyBatches: (Batch & { isCompleted?: boolean })[] = Object.entries(legacyGroups).map(([skuId, items]) => {
        const product = products.find(p => String(p.id || '').trim() === String(skuId || '').trim());
        const earliestUpdate = (items?.length || 0) > 0 
          ? items.reduce((min, i) => {
              const time = i.lastUpdated?.toMillis() || 0;
              return time < min ? time : min;
            }, items[0].lastUpdated?.toMillis() || Date.now()) 
          : Date.now();
        
        return {
          id: `legacy-${skuId}`,
          productId: skuId,
          productName: product?.name || 'Unknown Product',
          count: items?.length || 0,
          createdAt: Timestamp.fromMillis(earliestUpdate),
          isCompleted: !(items || []).some(i => i.status === 'in')
        };
      });

      // Check completion status for real batches
      const enrichedBatches = batchList.map((batch) => {
        const batchItems = allItems.filter(i => i.batchId === batch.id);
        return { ...batch, isCompleted: (batchItems?.length || 0) > 0 && !batchItems.some(i => i.status === 'in') };
      });

      setBatches([...enrichedBatches, ...legacyBatches]);
    } catch (error) {
      console.error("Error fetching batches:", error);
      toast.error("Failed to load batches");
    } finally {
      setDataLoading(false);
    }
  }

  async function fetchInventory() {
    // Now handled within fetchBatches to avoid redundant calls
    if (batches.length === 0) {
      fetchBatches();
    }
  }

  async function fetchProducts() {
    try {
      const snap = await getDocs(collection(db, 'products'));
      const productList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      
      // Auto-generate part numbers for existing products if missing or in wrong format (Admin only)
      if (isAdmin) {
        const partNumberRegex = /^\d{3}-\d{3}-\d{2}$/;
        const productsToUpdate = (productList || []).filter(p => !p.partNumber || !partNumberRegex.test(p.partNumber));
        if ((productsToUpdate?.length || 0) > 0) {
          try {
            for (const p of productsToUpdate) {
              try {
                const part1 = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
                const part2 = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
                const part3 = Math.floor(Math.random() * 100).toString().padStart(2, '0');
                const partNumber = `${part1}-${part2}-${part3}`;
                await updateDoc(doc(db, 'products', p.id), { partNumber });
                p.partNumber = partNumber;
              } catch (err) {
                console.error(`Error generating part number for product ${p.id}:`, err);
              }
            }
          } catch (updateError) {
            console.error("Error auto-generating part numbers:", updateError);
          }
        }
      }
      
      setProducts(productList);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'products');
    }
  }

  async function handleAddProduct() {
    if (!newProduct.name || newProduct.price <= 0) {
      toast.error("Please enter valid product details");
      return;
    }
    setLoading(true);
    try {
      const part1 = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const part2 = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const part3 = Math.floor(Math.random() * 100).toString().padStart(2, '0');
      const partNumber = `${part1}-${part2}-${part3}`;
      await addDoc(collection(db, 'products'), { ...newProduct, partNumber });
      toast.success("Product SKU added successfully");
      setShowAddProduct(false);
      setNewProduct({ name: '', price: 0, image: '' });
      fetchProducts();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'products');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateProduct() {
    if (!editingProduct || !editingProduct.name || editingProduct.price <= 0) {
      toast.error("Please enter valid product details");
      return;
    }
    setLoading(true);
    try {
      const { id, ...data } = editingProduct;
      await updateDoc(doc(db, 'products', id), data);
      toast.success("Product updated successfully");
      setEditingProduct(null);
      fetchProducts();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `products/${editingProduct.id}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProduct(id: string) {
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'products', id));
      toast.success("Product SKU deleted");
      setDeletingProductId(null);
      fetchProducts();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `products/${id}`);
    } finally {
      setLoading(false);
    }
  }

  const handleSoldWithoutScan = async () => {
    if (!productForSoldWithoutScan || soldWithoutScanCount <= 0) return;
    
    console.log('Sold Without Scan Request:', {
      productId: productForSoldWithoutScan.id,
      productName: productForSoldWithoutScan.name,
      count: soldWithoutScanCount,
      totalInventoryItems: inventoryItems?.length || 0
    });

    const inStockItems = (inventoryItems || []).filter(
      item => {
        const itemSkuId = String(item.skuId || '').trim();
        const productSkuId = String(productForSoldWithoutScan.id || '').trim();
        return itemSkuId === productSkuId && item.status === 'in';
      }
    );
    
    console.log('In Stock Items Found:', inStockItems.length);
    if (inStockItems.length === 0) {
      console.log('Debug - Product ID:', productForSoldWithoutScan.id);
      console.log('Debug - First 5 items SKU IDs:', (inventoryItems || []).slice(0, 5).map(i => i.skuId));
      toast.error(`No units of ${productForSoldWithoutScan.name} are currently in stock.`);
      return;
    }

    if (soldWithoutScanCount > inStockItems.length) {
      toast.error(`Only ${inStockItems.length} units available in stock.`);
      return;
    }
    
    setLoading(true);
    try {
      const batch = writeBatch(db);
      const itemsToUpdate = inStockItems.slice(0, soldWithoutScanCount);
      
      console.log('Updating items:', itemsToUpdate.map(i => i.id));

      itemsToUpdate.forEach(item => {
        batch.update(doc(db, 'items', item.id), {
          status: 'out',
          lastUpdated: Timestamp.now()
        });
      });
      
      await batch.commit();
      toast.success(`${soldWithoutScanCount} units marked as SOLD`);
      setShowSoldWithoutScanModal(false);
      setSoldWithoutScanCount(0);
      setProductForSoldWithoutScan(null);
      fetchBatches();
    } catch (error) {
      console.error('Error in handleSoldWithoutScan:', error);
      handleFirestoreError(error, OperationType.WRITE, 'items');
    } finally {
      setLoading(false);
    }
  };

  async function handleBulkGenerate() {
    if (!bulkGen || bulkGen.count <= 0) return;
    setLoading(true);
    try {
      const product = products.find(p => p.id === bulkGen.productId);
      if (!product) throw new Error("Product not found");

      // 1. Create Batch Document
      const batchData = {
        productId: bulkGen.productId,
        productName: product.name,
        count: bulkGen.count,
        createdAt: Timestamp.now(),
        userId: auth.currentUser?.uid
      };
      const batchRef = await addDoc(collection(db, 'batches'), batchData);

      // 2. Generate Items
      const items: Item[] = [];
      for (let i = 0; i < bulkGen.count; i++) {
        const qrCode = `QR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        const manualCode = Math.random().toString(36).substring(2, 12).toLowerCase();
        
        const itemData = {
          qrCode,
          manualCode,
          skuId: bulkGen.productId,
          batchId: batchRef.id,
          status: 'in' as const,
          lastUpdated: Timestamp.now(),
          userId: auth.currentUser?.uid
        };

        const docRef = await addDoc(collection(db, 'items'), itemData);
        items.push({ id: docRef.id, ...itemData });
      }
      setGeneratedItems(items);
      toast.success(`Generated ${bulkGen.count} unique QR codes`);
      setBulkGen(null);
      setShowBulkSelect(false);
      setActiveView('batches');
      fetchInventory();
      fetchBatches();
    } catch (error) {
      console.error("Error generating barcodes:", error);
      toast.error("Failed to generate barcodes");
    } finally {
      setLoading(false);
    }
  }

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.partNumber || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-3xl font-black text-gray-900">Inventory</h2>
        <div className="flex items-center gap-3 w-full md:w-auto">
          {activeView !== 'none' && (
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
              />
            </div>
          )}
          {activeView !== 'none' && (
            <button
              onClick={() => setActiveView('none')}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors flex items-center gap-2 shrink-0"
            >
              <X size={20} /> <span className="hidden sm:inline">Back</span>
            </button>
          )}
        </div>
      </div>

      {/* Action Cards */}
      {activeView === 'none' && (
        <div className={cn(
          "grid gap-6",
          isAdmin ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4" : "grid-cols-1 md:grid-cols-2"
        )}>
          {isAdmin && (
            <button
              onClick={() => {
                setIsMrpMode(true);
                setActiveView('batches');
              }}
              className="p-8 rounded-[2rem] shadow-sm border bg-white border-gray-100 text-gray-900 hover:shadow-xl hover:scale-[1.02] transition-all text-left group"
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-orange-50 text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-colors">
                <FileText size={28} />
              </div>
              <h3 className="text-xl font-bold mb-2">MRP slips</h3>
              <p className="text-sm text-gray-500">
                Generate and manage MRP slips.
              </p>
            </button>
          )}

          <button
            onClick={() => setActiveView('catalogue')}
            className="p-8 rounded-[2rem] shadow-sm border bg-white border-gray-100 text-gray-900 hover:shadow-xl hover:scale-[1.02] transition-all text-left group"
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-blue-50 text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-colors">
              <List size={28} />
            </div>
            <h3 className="text-xl font-bold mb-2">Catalogue</h3>
            <p className="text-sm text-gray-500">
              Manage product SKUs.
            </p>
          </button>

          {isAdmin && (
            <button
              onClick={() => {
                setIsMrpMode(false);
                setActiveView('batches');
              }}
              className="p-8 rounded-[2rem] shadow-sm border bg-white border-gray-100 text-gray-900 hover:shadow-xl hover:scale-[1.02] transition-all text-left group"
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-purple-50 text-purple-500 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                <Hash size={28} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Bulk Generate</h3>
              <p className="text-sm text-gray-500">
                Generate unique QR codes.
              </p>
            </button>
          )}

          <button
            onClick={() => {
              setActiveView('inventory');
              fetchInventory();
            }}
            className="p-8 rounded-[2rem] shadow-sm border bg-white border-gray-100 text-gray-900 hover:shadow-xl hover:scale-[1.02] transition-all text-left group"
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-green-50 text-green-500 group-hover:bg-green-500 group-hover:text-white transition-colors">
              <Package size={28} />
            </div>
            <h3 className="text-xl font-bold mb-2">Current Inventory</h3>
            <p className="text-sm text-gray-500">
              View stock levels and item details.
            </p>
          </button>
        </div>
      )}

      {showAddProduct && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">New Product SKU</h3>
              <button onClick={() => setShowAddProduct(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="relative w-32 h-32 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden group hover:border-orange-500 transition-colors">
                  {newProduct.image ? (
                    <>
                      <img src={newProduct.image} alt="Preview" className="w-full h-full object-cover" />
                      <button 
                        onClick={() => setNewProduct({ ...newProduct, image: '' })}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-2">
                      <label className="flex flex-col items-center cursor-pointer hover:text-orange-500 transition-colors">
                        <Camera className="text-gray-400 mb-1" size={20} />
                        <span className="text-[8px] font-bold text-gray-400 uppercase">Camera</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = async () => {
                                const resized = await resizeImage(reader.result as string);
                                setNewProduct({ ...newProduct, image: resized });
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                      <div className="w-8 h-[1px] bg-gray-200" />
                      <label className="flex flex-col items-center cursor-pointer hover:text-orange-500 transition-colors">
                        <ImageIcon className="text-gray-400 mb-1" size={20} />
                        <span className="text-[8px] font-bold text-gray-400 uppercase">Gallery</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = async () => {
                                const resized = await resizeImage(reader.result as string);
                                setNewProduct({ ...newProduct, image: resized });
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Product Name</label>
                <input
                  type="text"
                  value={newProduct.name}
                  onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="e.g. Brake Shoe Set"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Selling Price (₹)</label>
                <input
                  type="number"
                  value={newProduct.price}
                  onChange={e => setNewProduct({ ...newProduct, price: parseFloat(e.target.value) || 0 })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="0.00"
                />
              </div>
              <button
                onClick={handleAddProduct}
                disabled={loading}
                className="w-full py-4 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                {loading ? "Adding..." : "Save Product SKU"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkSelect && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">Bulk Generate</h3>
              <button onClick={() => setShowBulkSelect(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Select Product</label>
                <select
                  onChange={e => setBulkGen({ productId: e.target.value, count: bulkGen?.count || 10 })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                >
                  <option value="">Choose a product...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {bulkGen?.productId && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={bulkGen.count}
                    onChange={e => setBulkGen({ ...bulkGen, count: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none text-2xl font-bold"
                  />
                </div>
              )}
              <button
                onClick={handleBulkGenerate}
                disabled={loading || !bulkGen?.productId}
                className="w-full py-4 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                {loading ? "Generating..." : "Generate QR Codes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeView === 'catalogue' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex justify-between items-center px-2">
            <h3 className="text-xl font-bold text-gray-900">Product Catalogue</h3>
            {isAdmin && (
              <button
                onClick={() => setIsEditMode(!isEditMode)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all",
                  isEditMode ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {isEditMode ? <CheckCircle2 size={20} /> : <Edit2 size={20} />}
                {isEditMode ? "Done Editing" : "Edit Inventory"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isAdmin && (
              <button
                onClick={() => setShowAddProduct(true)}
                className="p-6 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-3 hover:border-orange-500 hover:bg-orange-50/30 transition-all group"
              >
                <div className="w-12 h-12 bg-orange-50 text-orange-500 rounded-xl flex items-center justify-center group-hover:bg-orange-500 group-hover:text-white transition-colors">
                  <Plus size={24} />
                </div>
                <div className="text-center">
                  <p className="font-bold text-gray-900">Add New Product</p>
                  <p className="text-xs text-gray-500">Create a new SKU</p>
                </div>
              </button>
            )}
            {filteredProducts.map(product => (
              <div key={product.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow relative group">
                {isEditMode && isAdmin && (
                  <div className="absolute top-4 right-4 flex gap-2">
                    <button
                      onClick={() => setEditingProduct(product)}
                      className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => setDeletingProductId(product.id)}
                      className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
                <div className="flex gap-4 mb-2">
                <div className="w-20 h-20 bg-gray-100 rounded-xl flex items-center justify-center text-gray-300 overflow-hidden">
                  {product.image ? (
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package size={32} />
                  )}
                </div>
                  <div className="flex-1 pr-16">
                    <h3 className="text-lg font-bold text-gray-900">{product.name}</h3>
                    {product.partNumber && (
                      <p className="text-xs font-mono text-gray-400 mt-1">Part No: {product.partNumber}</p>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  {!isEditMode && <p className="text-lg font-bold text-orange-600">₹{product.price}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editingProduct && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">Edit Product SKU</h3>
              <button onClick={() => setEditingProduct(null)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="relative w-32 h-32 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden group hover:border-orange-500 transition-colors">
                  {editingProduct.image ? (
                    <>
                      <img src={editingProduct.image} alt="Preview" className="w-full h-full object-cover" />
                      <button 
                        onClick={() => setEditingProduct({ ...editingProduct, image: '' })}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-2">
                      <label className="flex flex-col items-center cursor-pointer hover:text-orange-500 transition-colors">
                        <Camera className="text-gray-400 mb-1" size={20} />
                        <span className="text-[8px] font-bold text-gray-400 uppercase">Camera</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = async () => {
                                const resized = await resizeImage(reader.result as string);
                                setEditingProduct({ ...editingProduct, image: resized });
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                      <div className="w-8 h-[1px] bg-gray-200" />
                      <label className="flex flex-col items-center cursor-pointer hover:text-orange-500 transition-colors">
                        <ImageIcon className="text-gray-400 mb-1" size={20} />
                        <span className="text-[8px] font-bold text-gray-400 uppercase">Gallery</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = async () => {
                                const resized = await resizeImage(reader.result as string);
                                setEditingProduct({ ...editingProduct, image: resized });
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Product Name</label>
                <input
                  type="text"
                  value={editingProduct.name}
                  onChange={e => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Part Number</label>
                <input
                  type="text"
                  value={editingProduct.partNumber || ''}
                  onChange={e => setEditingProduct({ ...editingProduct, partNumber: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none font-mono"
                  placeholder="e.g. PN-XXXXXX"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Selling Price (₹)</label>
                <input
                  type="number"
                  value={editingProduct.price}
                  onChange={e => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) || 0 })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
              <button
                onClick={handleUpdateProduct}
                disabled={loading}
                className="w-full py-4 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Save size={20} />
                {loading ? "Saving..." : "Update Product SKU"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeView === 'batches' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex justify-between items-center px-2">
            <div className="flex items-center gap-3">
              {selectedBatchId && (
                <button 
                  onClick={() => setSelectedBatchId(null)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <h3 className="text-xl font-bold text-gray-900">
                {selectedBatchId 
                  ? `Batch Details: ${batches.find(b => b.id === selectedBatchId)?.productName}`
                  : "Bulk Generation History"}
              </h3>
            </div>
            {!selectedBatchId && isAdmin && (
              <button
                onClick={() => setShowBulkSelect(true)}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors"
              >
                <Plus size={20} /> Generate New Batch
              </button>
            )}
          </div>

          {dataLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="font-bold">Loading batch data...</p>
            </div>
          ) : !selectedBatchId ? (
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Date</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Product</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-center">Count</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-center">Status</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {batches
                      .sort((a, b) => {
                        if (a.isCompleted && !b.isCompleted) return 1;
                        if (!a.isCompleted && b.isCompleted) return -1;
                        const timeA = a.createdAt?.toMillis() || 0;
                        const timeB = b.createdAt?.toMillis() || 0;
                        return timeB - timeA;
                      })
                      .map(batch => (
                        <tr key={batch.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {batch.createdAt ? format(batch.createdAt.toDate(), 'MMM dd, yyyy') : 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-900">
                            {batch.productName}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center font-bold text-gray-900">
                            {batch.count}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-xs font-bold uppercase",
                              batch.isCompleted 
                                ? "bg-gray-100 text-gray-500" 
                                : "bg-green-100 text-green-700"
                            )}>
                              {batch.isCompleted ? "Completed" : "Active"}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <button
                              onClick={() => setSelectedBatchId(batch.id)}
                              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-orange-500"
                            >
                              <ChevronRight size={20} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    {(batches?.length || 0) === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-400 italic">
                          No generation history found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-6">
                  <h4 className="text-lg font-bold text-gray-900">
                    {isMrpMode ? "MRP Slips" : "Batch QR Codes"} ({(inventoryItems || []).filter(item => 
                      selectedBatchId?.startsWith('legacy-') 
                        ? (!item.batchId && String(item.skuId || '').trim() === String(selectedBatchId?.replace('legacy-', '') || '').trim())
                        : item.batchId === selectedBatchId
                    ).length})
                  </h4>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowShareModal(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-colors"
                    >
                      <Share2 size={20} /> Share / Export
                    </button>
                    <button
                      onClick={() => window.print()}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-colors"
                    >
                      <Printer size={20} /> {isMrpMode ? "Print Slips" : "Print All"}
                    </button>
                  </div>
                </div>
                {isMrpMode ? (
                  <div ref={slipsRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 print:block">
                    {inventoryItems
                      .filter(item => 
                        selectedBatchId?.startsWith('legacy-') 
                          ? (!item.batchId && String(item.skuId || '').trim() === String(selectedBatchId?.replace('legacy-', '') || '').trim())
                          : item.batchId === selectedBatchId
                      )
                      .map(item => {
                        const product = products.find(p => String(p.id || '').trim() === String(item.skuId || '').trim());
                        return (
                          <div key={item.id} className="relative w-[2.3in] h-[1.5in] bg-white border border-gray-400 p-1 overflow-hidden print:mb-4 print:shadow-none shadow-md rounded-sm mx-auto flex flex-col text-gray-900 group">
                            {/* Watermark Background */}
                            <div className="absolute inset-0 opacity-[0.05] pointer-events-none flex flex-wrap gap-x-6 gap-y-6 rotate-[-25deg] scale-150 items-center justify-center select-none">
                              {Array.from({ length: 12 }).map((_, i) => (
                                <span key={i} className="text-[8px] font-black uppercase tracking-widest">KAP GENUINE</span>
                              ))}
                            </div>

                            {/* Sparkle/Hologram Strip */}
                            <div className="absolute right-0 top-0 bottom-0 w-5 bg-gradient-to-b from-gray-200 via-white to-gray-200 flex flex-col items-center justify-center border-l border-gray-300 z-20">
                              <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-400 via-purple-400 to-pink-400 mix-blend-overlay" />
                              <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
                              <span className="[writing-mode:vertical-lr] text-[6px] font-black uppercase tracking-[0.2em] text-gray-400 rotate-180 drop-shadow-sm">KAP GENUINE</span>
                              <div className="mt-2 w-1.5 h-1.5 rounded-full bg-orange-400/30 animate-pulse" />
                            </div>

                            {/* Content */}
                            <div className="relative z-10 flex flex-col h-full pr-4">
                              <div className="flex justify-between items-start mb-0">
                                <div className="flex-1">
                                  <p className="text-[7px] font-bold text-gray-900 leading-none mb-1">{item.manualCode || (item.qrCode?.slice(-4).toUpperCase() || 'N/A')}</p>
                                  <h5 className="text-[10px] font-black uppercase leading-tight mb-1 text-gray-900">NAME: {product?.name || 'Unknown'}</h5>
                                  <p className="text-[9px] font-bold text-gray-800">PART NO : <span className="font-mono">{product?.partNumber || 'N/A'}</span></p>
                                </div>
                                <div className="flex flex-col items-end gap-1 ml-1">
                                  <span className="text-[8px] font-bold text-gray-400 leading-none">({product?.units || 36})</span>
                                  <div className="bg-white p-1 border border-gray-200 shadow-sm">
                                    <QRCode 
                                      value={item.qrCode || ''} 
                                      size={32} 
                                      level="L"
                                      style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                      viewBox={`0 0 256 256`}
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="flex gap-x-4 mb-0.5 -mt-2">
                                <p className="text-[8px] font-bold uppercase text-gray-700 whitespace-nowrap">PKD : <span className="font-mono">{safeFormatDate(item.lastUpdated, 'MMM yyyy')}</span></p>
                                <p className="text-[8px] font-bold uppercase text-gray-700 whitespace-nowrap">NET QTY 1 SET</p>
                              </div>

                              <div className="mb-0.5">
                                {(() => {
                                  const cataloguePrice = product?.price || 0;
                                  const calculatedMRP = Math.round(cataloguePrice / 0.45);
                                  return (
                                    <>
                                      <p className="text-[11px] font-black text-gray-900">MRP RS. {calculatedMRP.toFixed(2)}</p>
                                      <p className="text-[7px] font-bold text-gray-500 leading-none mb-0.5">(incl. of all taxes)</p>
                                      <p className="text-[8px] font-bold text-gray-700">Unit Price Per Number Rs. {calculatedMRP.toFixed(2)}</p>
                                    </>
                                  );
                                })()}
                              </div>

                              <div className="mt-auto pt-0.5 border-t border-gray-100">
                                <p className="text-[6px] leading-[1.2] text-blue-950 font-bold tracking-tight">
                                  MFD AND POWERED BY OEM COMPANIES, TRADING OFFICE: LOTUS ENTERPRISE,<br />
                                  PHASE 7, MOHALI, 160062, CONTACT: dkapoor@es.iitr.ac.in
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 print:block">
                    {inventoryItems
                      .filter(item => 
                        selectedBatchId?.startsWith('legacy-') 
                          ? (!item.batchId && String(item.skuId || '').trim() === String(selectedBatchId?.replace('legacy-', '') || '').trim())
                          : item.batchId === selectedBatchId
                      )
                      .map(item => (
                        <div key={item.id} className="flex flex-col items-center p-4 border border-dashed border-gray-200 rounded-2xl print:mb-8 print:border-none relative group">
                          <div className={cn(
                            "absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                            item.status === 'in' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          )}>
                            {item.status}
                          </div>
                          <div className="bg-white p-2 rounded-lg mb-2">
                            <QRCode value={item.qrCode || ''} size={120} />
                          </div>
                          <div className="mt-2 text-center">
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Manual Code</p>
                            <p className="text-sm font-mono font-bold text-gray-900">{item.qrCode || 'N/A'}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">QR Code</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Manual Code</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {inventoryItems
                        .filter(item => 
                          selectedBatchId?.startsWith('legacy-') 
                            ? (!item.batchId && String(item.skuId || '').trim() === String(selectedBatchId?.replace('legacy-', '') || '').trim())
                            : item.batchId === selectedBatchId
                        )
                        .map(item => (
                          <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                              {item.qrCode}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                              {item.manualCode}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className={cn(
                                "px-3 py-1 rounded-full text-xs font-bold uppercase",
                                item.status === 'in' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                              )}>
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeView === 'inventory' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex justify-between items-center px-2">
            <div className="flex items-center gap-3">
              {selectedProductForItems && (
                <button 
                  onClick={() => setSelectedProductForItems(null)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <h3 className="text-xl font-bold text-gray-900">
                {selectedProductForItems 
                  ? `Items: ${products.find(p => p.id === selectedProductForItems)?.name}`
                  : "Current Inventory"}
              </h3>
            </div>
            {(generatedItems?.length || 0) > 0 && (
              <button
                onClick={() => setGeneratedItems([])}
                className="text-sm font-bold text-orange-500 hover:text-orange-600"
              >
                Clear Recent Generation
              </button>
            )}
          </div>

          {(generatedItems?.length || 0) > 0 ? (
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-lg font-bold text-gray-900">Recently Generated QR Codes ({generatedItems?.length || 0})</h4>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-colors"
                >
                  <Printer size={20} /> Print All
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 print:block">
                {generatedItems.map(item => (
                  <div key={item.id} className="flex flex-col items-center p-4 border border-dashed border-gray-200 rounded-2xl print:mb-8 print:border-none">
                    <div className="bg-white p-2 rounded-lg mb-2">
                      <QRCode value={item.qrCode} size={120} />
                    </div>
                    <div className="mt-2 text-center">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Manual Code</p>
                      <p className="text-sm font-mono font-bold text-gray-900">{item.qrCode}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !selectedProductForItems ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {products.map(product => {
                const inStockCount = (inventoryItems || []).filter(item => {
                  const itemSkuId = String(item.skuId || '').trim();
                  const productSkuId = String(product.id || '').trim();
                  return itemSkuId === productSkuId && item.status === 'in';
                }).length;
                return (
                  <button
                    key={product.id}
                    onClick={() => {
                      setProductForSoldWithoutScan(product);
                      setShowSoldWithoutScanModal(true);
                    }}
                    className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all text-left group"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-3 bg-green-50 text-green-500 rounded-xl group-hover:bg-green-500 group-hover:text-white transition-colors">
                        <Package size={24} />
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-gray-900">{inStockCount}</p>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">In Stock</p>
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">{product.name}</h3>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">QR Code</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Manual Code</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {inventoryItems
                      .filter(item => {
                        const itemSkuId = String(item.skuId || '').trim();
                        const selectedSkuId = String(selectedProductForItems || '').trim();
                        return itemSkuId === selectedSkuId;
                      })
                      .map(item => (
                        <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                            {item.qrCode}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                            {item.manualCode}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-xs font-bold uppercase",
                              item.status === 'in' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            )}>
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    {(inventoryItems || []).filter(item => {
                      const itemSkuId = String(item.skuId || '').trim();
                      const selectedSkuId = String(selectedProductForItems || '').trim();
                      return itemSkuId === selectedSkuId;
                    }).length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-12 text-center text-gray-400 italic">
                          No items for this product
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      {deletingProductId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 text-center mb-2">Delete Product?</h3>
            <p className="text-gray-500 text-center mb-8">
              Are you sure you want to delete this product SKU? This will not delete individual items already generated.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setDeletingProductId(null)}
                className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteProduct(deletingProductId)}
                disabled={loading}
                className="flex-1 py-4 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {loading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSoldWithoutScanModal && productForSoldWithoutScan && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-2xl font-black text-gray-900">{productForSoldWithoutScan.name}</h3>
                <p className="text-gray-500 font-medium">Inventory Management</p>
              </div>
              <button 
                onClick={() => {
                  setShowSoldWithoutScanModal(false);
                  setProductForSoldWithoutScan(null);
                  setSoldWithoutScanCount(0);
                }}
                className="p-2 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="p-4 bg-orange-50 rounded-2xl border border-orange-100">
                <p className="text-sm font-bold text-orange-800 mb-1">Sold Without Scan?</p>
                <p className="text-xs text-orange-600 leading-relaxed">
                  If you sold units of this item without scanning their QR codes, enter the quantity below to update the inventory.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Number of Units Sold</label>
                <div className="relative">
                  <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="number"
                    min="0"
                    max={(inventoryItems || []).filter(item => {
                      const itemSkuId = String(item.skuId || '').trim();
                      const productSkuId = String(productForSoldWithoutScan.id || '').trim();
                      return itemSkuId === productSkuId && item.status === 'in';
                    }).length}
                    value={soldWithoutScanCount || ''}
                    onChange={(e) => setSoldWithoutScanCount(parseInt(e.target.value) || 0)}
                    placeholder="Enter quantity..."
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-orange-500 outline-none font-bold text-lg"
                  />
                </div>
                <p className="mt-2 text-[10px] text-gray-400 font-bold uppercase">
                  Available in stock: {(inventoryItems || []).filter(item => {
                    const itemSkuId = String(item.skuId || '').trim();
                    const productSkuId = String(productForSoldWithoutScan.id || '').trim();
                    return itemSkuId === productSkuId && item.status === 'in';
                  }).length} units
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleSoldWithoutScan}
                  disabled={loading || soldWithoutScanCount <= 0}
                  className="w-full py-4 bg-orange-500 text-white rounded-2xl font-bold hover:bg-orange-600 transition-all shadow-lg shadow-orange-200 disabled:opacity-50 disabled:shadow-none"
                >
                  {loading ? "Updating Inventory..." : "Confirm Sale"}
                </button>
                <button
                  onClick={() => {
                    setSelectedProductForItems(productForSoldWithoutScan.id);
                    setShowSoldWithoutScanModal(false);
                    setProductForSoldWithoutScan(null);
                    setSoldWithoutScanCount(0);
                  }}
                  className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                >
                  View Individual Items
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="p-8">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-black text-gray-900">Share Slips</h3>
                  <p className="text-gray-500 font-medium text-sm">Choose format and platform</p>
                </div>
                <button 
                  onClick={() => setShowShareModal(false)}
                  className="p-3 bg-gray-100 rounded-2xl hover:bg-gray-200 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => handleDownload('jpg')}
                    disabled={isGenerating}
                    className="flex flex-col items-center gap-3 p-6 bg-orange-50 rounded-3xl border-2 border-orange-100 hover:border-orange-200 transition-all group"
                  >
                    <div className="p-4 bg-orange-100 rounded-2xl group-hover:scale-110 transition-transform">
                      <ImageIcon className="text-orange-600" size={28} />
                    </div>
                    <span className="font-bold text-orange-900 text-sm">Download JPG</span>
                  </button>
                  <button
                    onClick={() => handleDownload('pdf')}
                    disabled={isGenerating}
                    className="flex flex-col items-center gap-3 p-6 bg-blue-50 rounded-3xl border-2 border-blue-100 hover:border-blue-200 transition-all group"
                  >
                    <div className="p-4 bg-blue-100 rounded-2xl group-hover:scale-110 transition-transform">
                      <FileText className="text-blue-600" size={28} />
                    </div>
                    <span className="font-bold text-blue-900 text-sm">Download PDF</span>
                  </button>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Share Directly</p>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => handleShare('whatsapp')}
                      disabled={isGenerating}
                      className="flex flex-col items-center gap-2 p-4 bg-green-50 rounded-2xl hover:bg-green-100 transition-colors"
                    >
                      <Send className="text-green-600" size={20} />
                      <span className="text-[10px] font-bold text-green-900">WhatsApp</span>
                    </button>
                    <button
                      onClick={() => handleShare('telegram')}
                      disabled={isGenerating}
                      className="flex flex-col items-center gap-2 p-4 bg-sky-50 rounded-2xl hover:bg-sky-100 transition-colors"
                    >
                      <Send className="text-sky-600" size={20} />
                      <span className="text-[10px] font-bold text-sky-900">Telegram</span>
                    </button>
                    <button
                      onClick={() => handleShare('native')}
                      disabled={isGenerating}
                      className="flex flex-col items-center gap-2 p-4 bg-purple-50 rounded-2xl hover:bg-purple-100 transition-colors"
                    >
                      <Share2 className="text-purple-600" size={20} />
                      <span className="text-[10px] font-bold text-purple-900">More</span>
                    </button>
                  </div>
                </div>
              </div>

              {isGenerating && (
                <div className="mt-6 p-4 bg-gray-50 rounded-2xl flex items-center gap-3 animate-pulse">
                  <div className="w-5 h-5 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-bold text-gray-600">Generating file...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
