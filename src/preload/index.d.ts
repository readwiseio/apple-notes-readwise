declare global {
  interface Window {
    api: {
      getStoreValue: (key: string) => Promise<string>;
      setStoreValue: (key: string, value: string) => Promise<void>;
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      removeAllListeners: (channel: string) => void;
      readwise: {
        syncHighlights: () => Promise<string>;
        openCustomFormatWindow: () => void;
      };
    };
  }
}

export {};