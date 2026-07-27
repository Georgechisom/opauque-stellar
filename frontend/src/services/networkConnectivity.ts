/**
 * Network connectivity monitoring service.
 * Tracks online/offline status and performs periodic connectivity checks.
 */

import { useNetworkStore } from "../store/networkStore";

class NetworkConnectivityService {
  private static instance: NetworkConnectivityService;
  private connectivityCheckInterval: number | null = null;
  private isInitialized = false;
  
  private constructor() {}
  
  static getInstance(): NetworkConnectivityService {
    if (!NetworkConnectivityService.instance) {
      NetworkConnectivityService.instance = new NetworkConnectivityService();
    }
    return NetworkConnectivityService.instance;
  }
  
  /**
   * Initialize network connectivity monitoring
   */
  initialize(): void {
    if (this.isInitialized) return;
    
    // Listen to browser online/offline events
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));
    
    // Set initial state
    const store = useNetworkStore.getState();
    store.setIsOnline(navigator.onLine);
    
    // Start periodic connectivity checks
    this.startConnectivityChecks();
    
    this.isInitialized = true;
    console.log('Network connectivity service initialized');
  }
  
  /**
   * Clean up network connectivity monitoring
   */
  cleanup(): void {
    window.removeEventListener('online', this.handleOnline.bind(this));
    window.removeEventListener('offline', this.handleOffline.bind(this));
    
    if (this.connectivityCheckInterval) {
      window.clearInterval(this.connectivityCheckInterval);
      this.connectivityCheckInterval = null;
    }
    
    this.isInitialized = false;
  }
  
  /**
   * Check if the network is actually reachable (not just browser online status)
   */
  async checkNetworkReachable(): Promise<boolean> {
    try {
      // Try to fetch a small resource that should always be available
      // Using a no-cache request to avoid false positives from cache
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('/favicon.ico', {
        method: 'HEAD',
        cache: 'no-cache',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      return response.ok;
    } catch (error) {
      console.debug('Network reachability check failed:', error);
      return false;
    }
  }
  
  /**
   * Record a network operation for monitoring purposes
   */
  recordNetworkOperation(): void {
    useNetworkStore.getState().recordSuccessfulOperation();
  }
  
  /**
   * Mark a network request as in-flight
   */
  trackRequest(id: string, type: string, data?: any): void {
    useNetworkStore.getState().trackInFlightRequest(id, type, data);
  }
  
  /**
   * Mark a network request as completed
   */
  completeRequest(id: string): void {
    useNetworkStore.getState().removeInFlightRequest(id);
    this.recordNetworkOperation();
  }
  
  /**
   * Mark a network request as failed due to connectivity
   */
  markRequestFailed(id: string): void {
    useNetworkStore.getState().setConnectionFailure();
    useNetworkStore.getState().removeInFlightRequest(id);
  }
  
  /**
   * Get retryable failed requests
   */
  getRetryableRequests(): Array<{ id: string; type: string; data?: any; startedAt: number }> {
    return useNetworkStore.getState().getFailedRequests();
  }
  
  /**
   * Check if network operations should be allowed
   */
  shouldAllowNetworkOperations(): boolean {
    const { isOnline, hasRecentConnectionFailure } = useNetworkStore.getState();
    return isOnline && !hasRecentConnectionFailure;
  }
  
  /**
   * Get current connectivity status
   */
  getStatus(): { 
    isOnline: boolean; 
    hasRecentFailure: boolean;
    lastSuccessfulOperation: number | null;
    inFlightCount: number;
  } {
    const store = useNetworkStore.getState();
    return {
      isOnline: store.isOnline,
      hasRecentFailure: store.hasRecentConnectionFailure,
      lastSuccessfulOperation: store.lastSuccessfulOperation,
      inFlightCount: store.inFlightRequests.size
    };
  }
  
  private handleOnline(): void {
    console.log('Browser reported online status');
    const store = useNetworkStore.getState();
    store.setIsOnline(true);
    
    // Perform a quick check to confirm we're actually online
    setTimeout(async () => {
      const isActuallyOnline = await this.checkNetworkReachable();
      if (isActuallyOnline) {
        store.clearConnectionFailure();
        store.recordSuccessfulOperation();
      } else {
        store.setIsOnline(false);
        store.setConnectionFailure();
      }
    }, 100);
  }
  
  private handleOffline(): void {
    console.log('Browser reported offline status');
    const store = useNetworkStore.getState();
    store.setIsOnline(false);
    store.setConnectionFailure();
  }
  
  private startConnectivityChecks(): void {
    // Check connectivity every 30 seconds when offline
    this.connectivityCheckInterval = window.setInterval(async () => {
      const { isOnline } = useNetworkStore.getState();
      
      if (!isOnline) {
        const isReachable = await this.checkNetworkReachable();
        if (isReachable) {
          console.log('Connectivity check: Network is reachable');
          const store = useNetworkStore.getState();
          store.setIsOnline(true);
          store.clearConnectionFailure();
          store.recordSuccessfulOperation();
        }
      }
    }, 30000);
  }
}

// Export singleton instance
export const networkConnectivityService = NetworkConnectivityService.getInstance();