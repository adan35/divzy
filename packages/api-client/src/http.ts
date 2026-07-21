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

  /**
   * Like request(), but for binary responses (e.g. PDF downloads) — reads the
   * response body via response.blob() instead of decoding it as UTF-8
   * text/JSON. Decoding binary content as text corrupts any bytes that are
   * not valid UTF-8 (see defect-WI-018: a pdfkit-generated PDF's compressed
   * FlateDecode streams were mangled into U+FFFD replacement characters by
   * the text path). Error responses (JSON) are still decoded as text/JSON so
   * ApiError messages remain readable.
   */
  async requestBlob(method: string, path: string, options: RequestOptions = {}): Promise<Blob> {
    return this.rawBlobRequest(method, path, options);
  }

  /** Performs the fetch + 401 refresh-and-retry dance; returns the raw Response. */
  private async performFetch(
    method: string,
    path: string,
    options: RequestOptions,
    isRetry = false,
  ): Promise<Response> {
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
          return this.performFetch(method, path, options, true);
        }
      }
      await this.opts.onUnauthorized?.();
    }

    return response;
  }

  private async rawRequest(
    method: string,
    path: string,
    options: RequestOptions,
    isRetry = false,
  ): Promise<unknown> {
    const response = await this.performFetch(method, path, options, isRetry);

    if (response.status === 204) return undefined;

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => undefined)
      : await response.text().catch(() => undefined);

    if (!response.ok) {
      throw this.toApiError(response, payload);
    }

    return payload;
  }

  private async rawBlobRequest(
    method: string,
    path: string,
    options: RequestOptions,
    isRetry = false,
  ): Promise<Blob> {
    const response = await this.performFetch(method, path, options, isRetry);

    if (!response.ok) {
      // Error responses are JSON/text, not binary — decode them the normal
      // way so ApiError carries a readable message.
      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => undefined)
        : await response.text().catch(() => undefined);
      throw this.toApiError(response, payload);
    }

    return response.blob();
  }

  private toApiError(response: Response, payload: unknown): ApiError {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed with status ${response.status}`;
    const code =
      payload && typeof payload === 'object' && 'code' in payload
        ? String((payload as { code: unknown }).code)
        : undefined;
    return new ApiError(response.status, message, code, payload);
  }
}
