declare module 'sdk' {
  export const db: {
    get(query: string, params?: Record<string, unknown>): Promise<any>;
    all(query: string, params?: Record<string, unknown>): Promise<any[]>;
    run(
      query: string,
      params?: Record<string, unknown>,
    ): Promise<{ rowsAffected: number; rows: any[] }>;
  };
  export const api: Record<string, (params?: any) => Promise<any>>;
  export class InputFile {
    constructor(bytes: Uint8Array, name: string, options?: { type?: string });
  }
  export class FormData {
    append(name: string, value: InputFile | string): void;
  }
  export const fetch: (url: string, options?: any) => Promise<any>;
}
