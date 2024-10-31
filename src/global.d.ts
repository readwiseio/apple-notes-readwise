interface Window {
    api: {
        sendNotification: (message: string) => void;
        store: {
            get: (key: string) => any;
            set: (key: string, value: any) => void
        }
        readwise: {
            connectToReadwise: () => Promise<string>;
            syncHighlights: () => Promise<string>;
        }
    };
}