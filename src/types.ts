import { Timestamp } from 'firebase/firestore';

export interface Product {
  id: string;
  name: string;
  price: number;
  partNumber?: string;
  units?: number;
  description?: string;
  image?: string;
}

export interface Item {
  id: string;
  qrCode: string;
  manualCode: string;
  skuId: string;
  batchId?: string;
  status: 'in' | 'out';
  lastUpdated: Timestamp;
  userId?: string;
}

export interface Batch {
  id: string;
  productId: string;
  productName: string;
  count: number;
  createdAt: Timestamp;
  userId?: string;
}

export interface Order {
  id: string;
  customerId: string;
  items: string[]; // List of Item IDs
  totalAmount: number;
  amountReceived: number;
  status: 'confirmed' | 'delivered';
  createdAt: Timestamp;
  userId?: string;
}

export interface Customer {
  id: string;
  name: string;
  balance: number;
  userId?: string;
}

export interface LedgerEntry {
  id: string;
  customerId: string;
  orderId?: string;
  amount: number;
  type: 'debit' | 'credit';
  timestamp: Timestamp;
  userId?: string;
}
