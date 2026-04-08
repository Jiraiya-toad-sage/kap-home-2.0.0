import React, { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5Qrcode } from 'html5-qrcode';
import { collection, query, where, getDocs, updateDoc, doc, Timestamp, addDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Item, Product } from '../types';
import { toast } from 'sonner';
import { Search, X, Check, ArrowRightLeft, Scan, Image as ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface ScannerProps {
  onItemScanned?: (item: Item, product: Product) => void;
  mode?: 'inventory' | 'order';
  continuous?: boolean;
  minimal?: boolean;
}

export default function Scanner({ onItemScanned, mode = 'inventory', continuous = false, minimal = false }: ScannerProps) {
  const [manualInput, setManualInput] = useState('');
  const [scanning, setScanning] = useState(true);
  const lastScannedCode = useRef<string | null>(null);
  const lastScannedTime = useRef<number>(0);
  const html5QrCode = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scannedItem, setScannedItem] = useState<{ item: Item; product: Product } | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [flash, setFlash] = useState(false);
  const isTransitioning = useRef(false);

  useEffect(() => {
    if (scanning) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [scanning]);

  async function startCamera() {
    if (html5QrCode.current || isTransitioning.current) return;

    isTransitioning.current = true;
    try {
      const qrCode = new Html5Qrcode("reader");
      html5QrCode.current = qrCode;
      
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      
      await qrCode.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanFailure
      );
      setIsCameraActive(true);
    } catch (err) {
      console.error("Camera start failed", err);
      // Only show error if it's not a transition error
      if (!err?.toString().includes("already under transition")) {
        toast.error("Could not start camera. Please check permissions.");
      }
      setScanning(false);
      html5QrCode.current = null;
    } finally {
      isTransitioning.current = false;
    }
  }

  async function stopCamera() {
    if (!html5QrCode.current || isTransitioning.current) return;

    isTransitioning.current = true;
    try {
      if (html5QrCode.current.isScanning) {
        await html5QrCode.current.stop();
      }
    } catch (err) {
      console.error("Camera stop failed", err);
    } finally {
      html5QrCode.current = null;
      setIsCameraActive(false);
      isTransitioning.current = false;
    }
  }

  async function onScanSuccess(decodedText: string) {
    const now = Date.now();
    // Cooldown to prevent multiple scans of the same item in quick succession
    if (decodedText === lastScannedCode.current && now - lastScannedTime.current < 2000) {
      return;
    }
    
    lastScannedCode.current = decodedText;
    lastScannedTime.current = now;

    // Visual feedback
    setFlash(true);
    setTimeout(() => setFlash(false), 200);

    if (!continuous) {
      await stopCamera();
      setScanning(false);
    }
    
    handleCode(decodedText);
  }

  function onScanFailure(error: any) {
    // console.warn(`Code scan error = ${error}`);
  }

  async function handleGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Use a temporary instance for file scanning to not interfere with camera
      const tempScanner = new Html5Qrcode("gallery-reader");
      const result = await tempScanner.scanFile(file, true);
      handleCode(result);
    } catch (err) {
      console.error("Gallery scan failed", err);
      toast.error("Could not find a valid QR code in this image");
    }
  }

  async function handleCode(code: string) {
    if (!auth.currentUser) return;
    try {
      // Search by qrCode OR manualCode
      const itemsRef = collection(db, 'items');
      
      // Base queries filtered by userId for strict isolation
      const qQrCode = query(itemsRef, where('qrCode', '==', code), where('userId', '==', auth.currentUser.uid));
      const qManual = query(itemsRef, where('manualCode', '==', code), where('userId', '==', auth.currentUser.uid));
      
      const [snapQrCode, snapManual] = await Promise.all([
        getDocs(qQrCode),
        getDocs(qManual)
      ]);

      const snap = snapQrCode.empty ? snapManual : snapQrCode;

      if (snap.empty) {
        toast.error("Item not found in database");
        return;
      }

      const itemDoc = snap.docs[0];
      const itemData = { id: itemDoc.id, ...itemDoc.data() } as Item;

      // Get product details
      const productSnap = await getDocs(query(collection(db, 'products'), where('__name__', '==', itemData.skuId)));
      if (productSnap.empty) {
        toast.error("Product details not found");
        return;
      }
      const productData = { id: productSnap.docs[0].id, ...productSnap.docs[0].data() } as Product;

      if (mode === 'order') {
        if (itemData.status === 'out') {
          toast.error("Item is already marked as OUT");
          return;
        }
        // Visual feedback for successful scan
        setFlash(true);
        setTimeout(() => setFlash(false), 200);
        
        onItemScanned?.(itemData, productData);
        toast.success(`Added ${productData.name} to order`);
      } else {
        setScannedItem({ item: itemData, product: productData });
        setScanning(false);
      }
    } catch (error) {
      console.error("Error handling code:", error);
      toast.error("Error searching for item");
    }
  }

  async function updateStatus(newStatus: 'in' | 'out') {
    if (!scannedItem) return;

    if (newStatus === 'in' && scannedItem.item.status === 'in') {
      toast.error("Item already exists in inventory");
      return;
    }

    try {
      await updateDoc(doc(db, 'items', scannedItem.item.id), {
        status: newStatus,
        lastUpdated: Timestamp.now()
      });
      toast.success(`Item marked as ${newStatus.toUpperCase()}`);
      setScannedItem(null);
      setScanning(true);
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    }
  }

  if (minimal && scanning) {
    return (
      <div className="h-full w-full relative bg-black overflow-hidden">
        <div id="reader" className="h-full w-full object-cover">
          {flash && (
            <div className="absolute inset-0 bg-white/30 animate-pulse z-10"></div>
          )}
        </div>
        <div className="absolute top-4 left-4 right-4 z-20 flex gap-2">
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Manual code..."
              className="flex-1 px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/30 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              onClick={() => handleCode(manualInput)}
              className="p-2 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-colors"
            >
              <Search size={20} />
            </button>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-colors"
            >
              <ImageIcon size={20} />
            </button>
            <button 
              onClick={() => setScanning(false)}
              className="p-2 bg-red-500/80 backdrop-blur-md text-white rounded-full hover:bg-red-600 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleGalleryUpload}
          accept="image/*"
          className="hidden"
        />
        <div id="gallery-reader" className="hidden"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleGalleryUpload}
        accept="image/*"
        className="hidden"
      />
      <div id="gallery-reader" className="hidden"></div>
      {scanning ? (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-900">Scanning...</h3>
            <div className="flex gap-2">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1 bg-orange-50 text-orange-600 rounded-lg text-xs font-bold hover:bg-orange-100 transition-colors"
              >
                Gallery
              </button>
              <button 
                onClick={() => setScanning(false)}
                className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition-colors"
              >
                Stop
              </button>
            </div>
          </div>
          <div id="reader" className="overflow-hidden rounded-xl bg-black aspect-square relative">
            {flash && (
              <div className="absolute inset-0 bg-white/30 animate-pulse z-10"></div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Enter code manually..."
              className="flex-1 px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              onClick={() => handleCode(manualInput)}
              className="p-2 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-colors"
            >
              <Search size={20} />
            </button>
          </div>
        </div>
      ) : scannedItem ? (
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-orange-100 animate-in fade-in zoom-in duration-300">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl font-bold text-gray-900">{scannedItem.product.name}</h3>
              <p className="text-sm text-gray-500 font-mono">{scannedItem.item.qrCode}</p>
            </div>
            <button onClick={() => { setScannedItem(null); setScanning(true); }} className="text-gray-400 hover:text-gray-600">
              <X size={24} />
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Current Status</p>
              <p className={cn(
                "text-lg font-bold uppercase",
                scannedItem.item.status === 'in' ? "text-green-600" : "text-red-600"
              )}>
                {scannedItem.item.status}
              </p>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Price</p>
              <p className="text-lg font-bold text-gray-900">₹{scannedItem.product.price}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => updateStatus('in')}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors"
            >
              <Check size={20} /> IN
            </button>
            <button
              onClick={() => updateStatus('out')}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
            >
              <ArrowRightLeft size={20} /> OUT
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-3">
            <button
              onClick={() => setScanning(true)}
              className="w-full py-8 bg-white border-2 border-dashed border-gray-200 rounded-[2rem] flex flex-col items-center justify-center gap-3 hover:border-orange-500 hover:bg-orange-50/30 transition-all group"
            >
              <div className="w-16 h-16 bg-orange-50 text-orange-500 rounded-2xl flex items-center justify-center group-hover:bg-orange-500 group-hover:text-white transition-colors">
                <Scan size={32} />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-gray-900">Start Camera Scanner</p>
                <p className="text-sm text-gray-500">Tap to scan QR codes</p>
              </div>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-8 bg-white border-2 border-dashed border-gray-200 rounded-[2rem] flex flex-col items-center justify-center gap-3 hover:border-orange-500 hover:bg-orange-50/30 transition-all group"
            >
              <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-colors">
                <ImageIcon size={32} />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-gray-900">Upload from Gallery</p>
                <p className="text-sm text-gray-500">Select image from phone</p>
              </div>
            </button>
          </div>

          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Manual Entry</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Enter code manually..."
                className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button
                onClick={() => handleCode(manualInput)}
                className="px-6 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-colors"
              >
                Search
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
