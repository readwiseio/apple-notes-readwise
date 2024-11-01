interface Window {
    api: {
        getStoreValue: (key: string) => any;
        setStoreValue: (key: string, value: any) => void
        readwise: {
            connectToReadwise: () => Promise<string>;
            syncHighlights: () => Promise<string>;
            openCustomFormatWindow: () => void;
        }
        on: (channel: string, listener: (...args: any[]) => void) => void;
        removeAllListeners: (channel: string) => void;
    };
}