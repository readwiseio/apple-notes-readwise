interface Window {
    api: {
        getStoreValue: (key: string) => Promise<any>;
        setStoreValue: (key: string, value: any) => Promise<any>
        readwise: {
            connectToReadwise: () => Promise<string>;
            syncHighlights: () => Promise<string>;
            openCustomFormatWindow: () => void;
        }
        on: (channel: string, listener: (...args: any[]) => void) => void;
        removeAllListeners: (channel: string) => void;
    };
}