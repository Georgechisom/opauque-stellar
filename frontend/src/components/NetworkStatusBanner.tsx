/**
 * Network status banner component.
 * Shows when the user is offline and blocks UI actions.
 */

import { useEffect, useState } from "react";
import { useNetworkConnectivity } from "../hooks/useNetworkConnectivity";

export function NetworkStatusBanner() {
  const { isOnline, hasRecentFailure, shouldBlockOperations, getRetryableRequests } = useNetworkConnectivity();
  const [isVisible, setIsVisible] = useState(false);
  const [showRetryOptions, setShowRetryOptions] = useState(false);
  
  // Show banner when we should block operations
  useEffect(() => {
    if (shouldBlockOperations) {
      setIsVisible(true);
    } else {
      // Hide with a small delay to avoid flickering on brief connectivity issues
      const timer = setTimeout(() => setIsVisible(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [shouldBlockOperations]);
  
  // Check for retryable requests
  useEffect(() => {
    const retryableRequests = getRetryableRequests();
    if (retryableRequests.length > 0) {
      setShowRetryOptions(true);
    }
  }, [getRetryableRequests]);
  
  if (!isVisible) return null;
  
  const statusMessage = !isOnline 
    ? "You are offline. Please check your internet connection."
    : hasRecentFailure 
      ? "Network connectivity issues detected. Some operations may fail."
      : "Network issues detected.";
  
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-red-900/90 to-red-800/90 backdrop-blur-md border-b border-red-700/50">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="flex-shrink-0">
              <svg 
                className="h-5 w-5 text-red-200" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" 
                />
              </svg>
            </div>
            
            <div className="flex-1">
              <p className="text-sm font-medium text-red-50">
                {statusMessage}
              </p>
              <p className="text-xs text-red-200/80 mt-1">
                Form submissions and network operations are disabled until connectivity is restored.
              </p>
              
              {showRetryOptions && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowRetryOptions(!showRetryOptions)}
                    className="text-xs text-red-200 hover:text-white underline"
                  >
                    {showRetryOptions ? "Hide" : "Show"} failed operations
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsVisible(false)}
              className="text-red-200 hover:text-white p-1 rounded transition-colors"
              aria-label="Dismiss"
            >
              <svg 
                className="h-4 w-4" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M6 18L18 6M6 6l12 12" 
                />
              </svg>
            </button>
          </div>
        </div>
        
        {showRetryOptions && (
          <div className="mt-3 pt-3 border-t border-red-700/50">
            <div className="flex items-center justify-between">
              <p className="text-xs text-red-200">
                Some operations failed due to network issues
              </p>
              <button
                type="button"
                onClick={() => {
                  // TODO: Implement retry logic
                  setShowRetryOptions(false);
                }}
                className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded transition-colors"
              >
                Retry all
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}