import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  MessageSquare, 
  X, 
  Send, 
  Bot, 
  User, 
  Loader2, 
  Minimize2, 
  Maximize2,
  Sparkles
} from 'lucide-react';
import { collection, getDocs, query, where, orderBy, limit, addDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { cn } from '../lib/utils';
import Markdown from 'react-markdown';

interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

interface ChatBotProps {
  onNavigate?: (tab: 'dashboard' | 'inventory' | 'orders' | 'ledger' | 'scan' | 'admin', filters?: any) => void;
}

export default function ChatBot({ onNavigate }: ChatBotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'model',
      text: "Hello! I am **Kapoor from Patiala**, your AI assistant for this application. How can I help you search or manage your inventory today?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      text: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Fetch context data - strictly filtered by current user's ID
      const [productsSnap, itemsSnap, ordersSnap, customersSnap, trainingSnap] = await Promise.all([
        getDocs(collection(db, 'products')),
        getDocs(query(collection(db, 'items'), where('userId', '==', auth.currentUser?.uid))),
        getDocs(query(collection(db, 'orders'), where('userId', '==', auth.currentUser?.uid), orderBy('createdAt', 'desc'), limit(50))),
        getDocs(query(collection(db, 'customers'), where('userId', '==', auth.currentUser?.uid))),
        getDocs(collection(db, 'chatbot_training'))
      ]);

      const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const items = itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const orders = ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const customers = customersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const trainingData = trainingSnap.docs.map(doc => doc.data());

      const context = {
        products: products.map((p: any) => ({ id: p.id, name: p.name, partNumber: p.partNumber, price: p.price })),
        inventorySummary: products.map((p: any) => {
          const productItems = items.filter((i: any) => String(i.skuId || '').trim() === String(p.id || '').trim());
          const inStock = productItems.filter((i: any) => i.status === 'in').length;
          const lastOrder = orders.find((o: any) => o.items?.some((oi: any) => String(oi.skuId || '').trim() === String(p.id || '').trim()));
          return {
            name: p.name,
            skuId: p.id,
            inStock,
            lastOrderDate: lastOrder ? (lastOrder as any).createdAt?.toDate().toLocaleDateString() : 'No orders yet'
          };
        }),
        recentOrders: orders.slice(0, 10).map((o: any) => ({
          id: o.id,
          customerName: o.customerName,
          total: o.totalAmount,
          date: o.createdAt?.toDate().toLocaleDateString(),
          items: o.items?.map((oi: any) => ({ name: oi.productName, qty: oi.quantity }))
        })),
        customers: customers.map((c: any) => ({ name: c.name, balance: c.balance })),
        trainingExamples: trainingData
      };

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{ text: `You are "Kapoor from Patiala", a helpful AI assistant for an inventory management application called "KAP Genuine". 
            Your goal is to help users search through their data quickly and provide insights.
            
            Current Application Data Context:
            ${JSON.stringify(context, null, 2)}
            
            User Query: ${input}
            
            Instructions:
            1. Always introduce yourself as "Kapoor from Patiala" if asked who you are.
            2. Use the provided context to answer questions about inventory levels, last orders, etc.
            3. Be concise and professional.
            4. Provide proactive suggestions like "Would you like me to place an order for 50 units of [Product]?" or "Shall I create a new order for you?".
            5. If you don't have enough information, ask for clarification.
            6. Use markdown for better formatting (bold, lists, etc.).
            7. IMPORTANT: Refer to the "trainingExamples" in the context to handle specific edge cases as defined by the admin.
               - If a training example has an "expectedResponse", use it as a guide for your answer.
               - If a training example has an "optimizedIntent", follow that intent/logic to formulate your answer.
            8. If you are absolutely unable to answer a query based on the data provided, start your response with the exact phrase: "UNSOLVED_QUERY_ALERT:". Then explain why you couldn't answer.
            9. NAVIGATION INTENT: If the user wants to see a specific section of the app (e.g., "show me orders", "inventory of [Product]", "ledger for [Customer]", "order history of [Customer]"), you MUST include a navigation command at the end of your response in the following format:
               [NAVIGATE: {"tab": "orders|inventory|ledger|scan|dashboard", "filters": {"search": "...", "customerName": "...", "month": "..."}}]
               - Use "orders" for order history or sales.
               - Use "inventory" for stock or product catalogue.
               - Use "ledger" for customer balances or payments.
               - Use "scan" for scanning items.
               - Extract relevant filters like customerName or search terms from the query.` }]
          }
        ],
        config: {
          systemInstruction: "You are Kapoor from Patiala, the AI assistant for KAP Genuine. You help with inventory searches and management."
        }
      });

      const response = await model;
      let aiText = response.text || "I'm sorry, I couldn't process that request.";

      // Handle Navigation Intent
      const navMatch = aiText.match(/\[NAVIGATE: (.*?)\]/);
      if (navMatch && onNavigate) {
        try {
          const navData = JSON.parse(navMatch[1]);
          onNavigate(navData.tab, navData.filters);
          // Remove the navigate command from the displayed text
          aiText = aiText.replace(/\[NAVIGATE: .*?\]/, "").trim();
        } catch (e) {
          console.error("Failed to parse navigation data", e);
        }
      }

      // Check for unsolved query alert
      if (aiText.startsWith("UNSOLVED_QUERY_ALERT:")) {
        const actualQuery = input;
        aiText = aiText.replace("UNSOLVED_QUERY_ALERT:", "").trim();
        
        // Log to unsolved_queries
        try {
          await addDoc(collection(db, 'unsolved_queries'), {
            query: actualQuery,
            timestamp: Timestamp.now(),
            status: 'pending'
          });
        } catch (logError) {
          console.error("Error logging unsolved query:", logError);
        }
      }

      setMessages(prev => [...prev, {
        role: 'model',
        text: aiText,
        timestamp: new Date()
      }]);
    } catch (error) {
      console.error("ChatBot Error:", error);
      setMessages(prev => [...prev, {
        role: 'model',
        text: "I encountered an error while processing your request. Please try again later.",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end pointer-events-none">
      {/* Chat Window */}
      {isOpen && (
        <div className={cn(
          "bg-white rounded-[2rem] shadow-2xl border border-gray-100 flex flex-col overflow-hidden transition-all duration-300 pointer-events-auto mb-4",
          isMinimized ? "h-16 w-72" : "h-[500px] w-[350px] sm:w-[400px]"
        )}>
          {/* Header */}
          <div className="bg-gray-900 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shadow-lg shadow-orange-900/20">
                <Bot className="text-white" size={18} />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm leading-none">Kapoor from Patiala</h3>
                <p className="text-orange-400 text-[10px] font-bold uppercase tracking-widest mt-1 flex items-center gap-1">
                  <Sparkles size={10} /> AI Assistant
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-2 text-gray-400 hover:text-white transition-colors"
              >
                {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
              </button>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-2 text-gray-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages */}
              <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50"
              >
                {messages.map((msg, idx) => (
                  <div 
                    key={idx}
                    className={cn(
                      "flex flex-col max-w-[85%]",
                      msg.role === 'user' ? "ml-auto items-end" : "items-start"
                    )}
                  >
                    <div className={cn(
                      "p-3 rounded-2xl text-sm leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-orange-500 text-white rounded-tr-none shadow-md shadow-orange-100" 
                        : "bg-white text-gray-700 border border-gray-100 rounded-tl-none shadow-sm"
                    )}>
                      <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-gray-900 prose-pre:text-white">
                        <Markdown>{msg.text}</Markdown>
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 mt-1 font-bold">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex items-start gap-2">
                    <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-gray-100 shadow-sm">
                      <Loader2 className="animate-spin text-orange-500" size={18} />
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="p-4 bg-white border-t border-gray-100">
                <div className="relative flex items-center">
                  <input 
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Ask Kapoor Sahab anything..."
                    className="w-full pl-4 pr-12 py-3 bg-gray-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-orange-500/20 transition-all outline-none"
                  />
                  <button 
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="absolute right-2 p-2 bg-gray-900 text-white rounded-xl hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Bubble */}
      <button 
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        className={cn(
          "p-4 bg-gray-900 text-white rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all pointer-events-auto group relative",
          isOpen && "scale-0 opacity-0"
        )}
      >
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 rounded-full border-2 border-white animate-pulse" />
        <MessageSquare className="group-hover:rotate-12 transition-transform" />
      </button>
    </div>
  );
}
