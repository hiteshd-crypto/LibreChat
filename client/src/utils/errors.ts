import axios from 'axios';

/**
 * Returns the HTTP response status code from an error, regardless of the
 * HTTP client used.  Handles Axios errors first, then falls back to checking
 * for a plain `status` property so callers never need to import axios.
 */
export const getResponseStatus = (error: unknown): number | undefined => {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }
  if (error != null && typeof error === 'object' && 'status' in error) {
    const { status } = error as { status: unknown };
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
};

export const isNotFoundError = (error: unknown): boolean => getResponseStatus(error) === 404;

/**
 * Pulls the human-readable message out of an API error: the server's
 * `{ error }` or `{ message }` body first, then the client's generic
 * `error.message` ("Request failed with status code 400"), then a fallback.
 */
export const getResponseErrorMessage = (error: unknown, fallback = ''): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown; message?: unknown } | undefined;
    if (typeof data?.error === 'string' && data.error) {
      return data.error;
    }
    if (typeof data?.message === 'string' && data.message) {
      return data.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};
