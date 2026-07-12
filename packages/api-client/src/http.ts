import { ApiError, NetworkError } from './errors';

export interface HttpClientOptions {
  /** API origin, e.g. "http://localhost:4000" (no trailing slash). */
  baseUrl: string;
  /** Returns the current access token, or null when logged out. */
  getAccessToken: () => string | null | Promise<string | null>;
  /**
   * Attempt a token refresh after a 401. Return true if a new access token is
   * available (the request is retried once). Web: cookie-based; mobile: stored
   * refresh token.
   */
  refresh?: () => Promise<boolean>;
  /** Called when a request 401s and refresh failed — log the user out. */
  onUnauthorized?: () => void | Promise<void>;
  /** 'include' on web so the refresh cookie flows; 'omit' on mobile. */
  credentials?: RequestCredentials;
  fetchFn?: typeof fetch;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  /** Raw FormData body (uploads) — skips JSON headers. */
  formData?: FormData;
  /** Skip the automatic refresh-and-retry (used by auth endpoints themselves). */
  skipAuthRetry?: boolean;
  signal?: AbortSignal;
}

export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(path, this.opts.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const result = await this.rawRequest(method, path, options);
    return result as T;
  }

  private async rawRequest(
    method: string,
    path: string,
    options: RequestOptions,
    isRetry = false,
  ): Promise<unknown> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const token = await this.opts.getAccessToken();

    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetchFn(this.buildUrl(path, options.query), {
        method,
        headers,
        body,
        credentials: this.opts.credentials,
        signal: options.signal,
      });
    } catch (err) {
      throw new NetworkError(err);
    }

    if (response.status === 401 && !options.skipAuthRetry) {
      if (!isRetry && this.opts.refresh) {
        let refreshed = false;
        try {
          refreshed = await this.opts.refresh();
        } catch {
          refreshed = false;
        }
        if (refreshed) {
          return this.rawRequest(method, path, options, true);
        }
      }
      await this.opts.onUnauthorized?.();
    }

    if (response.status === 204) return undefined;

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => undefined)
      : await response.text().catch(() => undefined);

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : `Request failed with status ${response.status}`;
      const code =
        payload && typeof payload === 'object' && 'code' in payload
          ? String((payload as { code: unknown }).code)
          : undefined;
      throw new ApiError(response.status, message, code, payload);
    }

    return payload;
  }
}
