/**
 * Network-aware fetch wrapper with automatic retry and offline detection.
 * Provides consistent error handling for network operations.
 */

import { networkConnectivityService } from "../services/networkConnectivity";

export interface NetworkFetchOptions extends RequestInit {
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;
  /** Base delay between retries in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Whether to use exponential backoff (default: true) */
  exponentialBackoff?: boolean;
  /** Timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Whether to track this request in network monitoring */
  trackRequest?: boolean;
}

export interface NetworkFetchResult<T = any> {
  data: T;
  response: Response;
  retryCount: number;
}

export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly originalError?: Error,
    public readonly isNetworkError = false
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Network-aware fetch wrapper with automatic retry logic
 */
export async function networkAwareFetch<T = any>(
  url: string | URL,
  options: NetworkFetchOptions = {}
): Promise<NetworkFetchResult<T>> {
  const {
    maxRetries = 2,
    retryDelay = 1000,
    exponentialBackoff = true,
    timeout = 10000,
    trackRequest = true,
    ...fetchOptions
  } = options;

  // Check network connectivity before attempting
  if (!networkConnectivityService.shouldAllowNetworkOperations()) {
    throw new NetworkError(
      'Network connectivity issues detected. Please check your internet connection.',
      undefined,
      undefined,
      true
    );
  }

  const requestId = `fetch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  if (trackRequest) {
    networkConnectivityService.trackRequest(requestId, 'fetch', { url: url.toString() });
  }

  let lastError: Error | undefined;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Merge abort signal
      const mergedSignal = controller.signal;
      if (fetchOptions.signal) {
        // Combine signals
        const combinedController = new AbortController();
        fetchOptions.signal.addEventListener('abort', () => combinedController.abort());
        mergedSignal.addEventListener('abort', () => combinedController.abort());
      }

      const response = await fetch(url, {
        ...fetchOptions,
        signal: mergedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new NetworkError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status
        );
      }

      const data = await response.json();

      if (trackRequest) {
        networkConnectivityService.completeRequest(requestId);
      }

      return {
        data,
        response,
        retryCount: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if error is a network error
      const isNetworkError =
        error instanceof TypeError && error.message.includes('fetch') ||
        error instanceof DOMException && error.name === 'NetworkError' ||
        error instanceof Error && (
          error.message.includes('network') ||
          error.message.includes('Network') ||
          error.message.includes('connection') ||
          error.message.includes('fetch') ||
          error.message.includes('timeout') ||
          error.message.includes('aborted')
        );

      if (isNetworkError && attempt < maxRetries) {
        // Mark as failed for tracking
        if (trackRequest && attempt === 0) {
          networkConnectivityService.markRequestFailed(requestId);
        }

        // Calculate delay with exponential backoff
        const delay = exponentialBackoff
          ? retryDelay * Math.pow(2, attempt)
          : retryDelay;

        // Add jitter to avoid thundering herd
        const jitter = delay * 0.1 * Math.random();
        const finalDelay = delay + jitter;

        console.warn(`Network fetch attempt ${attempt + 1} failed, retrying in ${Math.round(finalDelay)}ms:`, error);

        await new Promise(resolve => setTimeout(resolve, finalDelay));
        retryCount++;
        continue;
      }

      // Final attempt failed or non-retryable error
      if (trackRequest) {
        if (isNetworkError) {
          networkConnectivityService.markRequestFailed(requestId);
        } else {
          networkConnectivityService.completeRequest(requestId);
        }
      }

      throw new NetworkError(
        `Request failed after ${attempt + 1} attempts: ${lastError.message}`,
        undefined,
        lastError,
        isNetworkError
      );
    }
  }

  // This should never be reached due to the loop structure, but TypeScript wants it
  throw new NetworkError('Unexpected error in networkAwareFetch');
}

/**
 * Helper for common API requests
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: NetworkFetchOptions = {}
): Promise<T> {
  const result = await networkAwareFetch<T>(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  return result.data;
}

/**
 * Check if an error is a network connectivity error
 */
export function isNetworkError(error: unknown): boolean {
  return (
    error instanceof NetworkError && error.isNetworkError ||
    error instanceof TypeError && error.message.includes('fetch') ||
    error instanceof DOMException && error.name === 'NetworkError' ||
    (error instanceof Error && (
      error.message.includes('network') ||
      error.message.includes('Network') ||
      error.message.includes('connection') ||
      error.message.includes('fetch') ||
      error.message.includes('timeout')
    ))
  );
}

/**
 * Create a retryable network operation
 */
export function createRetryableOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: {
    maxRetries?: number;
    onRetry?: (attempt: number, error: Error) => void;
    onSuccess?: (result: T) => void;
    onFailure?: (error: Error) => void;
  } = {}
): () => Promise<T> {
  const {
    maxRetries = 2,
    onRetry,
    onSuccess,
    onFailure,
  } = options;

  return async (): Promise<T> => {
    const requestId = `${operationName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    networkConnectivityService.trackRequest(requestId, operationName);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Check network connectivity before each attempt
        if (!networkConnectivityService.shouldAllowNetworkOperations()) {
          throw new NetworkError(
            'Network connectivity issues detected. Please check your internet connection.',
            undefined,
            undefined,
            true
          );
        }

        const result = await operation();
        
        networkConnectivityService.completeRequest(requestId);
        onSuccess?.(result);
        
        return result;
      } catch (error) {
        const isNetworkErrorValue = isNetworkError(error);
        
        if (isNetworkErrorValue && attempt < maxRetries) {
          onRetry?.(attempt + 1, error as Error);
          
          // Exponential backoff
          const delay = 1000 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          continue;
        }

        // Final failure
        if (isNetworkErrorValue) {
          networkConnectivityService.markRequestFailed(requestId);
        } else {
          networkConnectivityService.completeRequest(requestId);
        }
        
        onFailure?.(error as Error);
        throw error;
      }
    }

    // This should never be reached
    throw new NetworkError(`Operation ${operationName} failed after ${maxRetries} retries`);
  };
}