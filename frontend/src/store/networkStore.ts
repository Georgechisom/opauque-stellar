/**
 * Network connectivity state store.
 * Tracks online/offline status and provides methods to check connectivity.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

interface NetworkState {
  /** Whether the browser reports being online */
  isOnline: boolean;
  /** Whether we've detected a connection failure recently */
  hasRecentConnectionFailure: boolean;
  /** Timestamp of last successful network operation */
  lastSuccessfulOperation: number | null;
  /** Track in-flight network requests for retry purposes */
  inFlightRequests: Map<string, { 
    startedAt: number; 
    type: string; 
    data?: any;
  }>;
  
  setIsOnline: (online: boolean) => void;
  setConnectionFailure: () => void;
  clearConnectionFailure: () => void;
  recordSuccessfulOperation: () => void;
  trackInFlightRequest: (id: string, type: string, data?: any) => void;
  removeInFlightRequest: (id: string) => void;
  getFailedRequests: () => Array<{ id: string; type: string; data?: any; startedAt: number }>;
}

export const useNetworkStore = create<NetworkState>()(
  subscribeWithSelector((set, get) => ({
    isOnline: navigator.onLine,
    hasRecentConnectionFailure: false,
    lastSuccessfulOperation: null,
    inFlightRequests: new Map(),
    
    setIsOnline: (online) => set({ isOnline: online }),
    
    setConnectionFailure: () => set({ hasRecentConnectionFailure: true }),
    
    clearConnectionFailure: () => set({ hasRecentConnectionFailure: false }),
    
    recordSuccessfulOperation: () => 
      set({ lastSuccessfulOperation: Date.now(), hasRecentConnectionFailure: false }),
    
    trackInFlightRequest: (id, type, data) => {
      const newMap = new Map(get().inFlightRequests);
      newMap.set(id, { startedAt: Date.now(), type, data });
      set({ inFlightRequests: newMap });
    },
    
    removeInFlightRequest: (id) => {
      const newMap = new Map(get().inFlightRequests);
      newMap.delete(id);
      set({ inFlightRequests: newMap });
    },
    
    getFailedRequests: () => {
      const now = Date.now();
      const failedRequests: Array<{ id: string; type: string; data?: any; startedAt: number }> = [];
      const { inFlightRequests } = get();
      
      // Requests older than 30 seconds with no completion are considered failed
      for (const [id, request] of inFlightRequests.entries()) {
        if (now - request.startedAt > 30000) {
          failedRequests.push({ id, ...request });
        }
      }
      
      return failedRequests;
    },
  }))
);