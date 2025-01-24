export interface ReadwiseAuthResponse {
  userAccessToken: string;
}

export interface ExportRequestResponse {
  latest_id: number;
  status: string;
}

export interface ExportStatusResponse {
  totalBooks: number;
  booksExported: number;
  isFinished: boolean;
  taskStatus: string;
}

export interface ReadwisePluginSettings {
  /** Readwise API token */
  token: string;

  /** Folder to save highlights */
  readwiseDir: string;

  /** Polling for pending export */
  isSyncing: boolean;

  /** Frequency of automatic sync */
  frequency: string;

  /** Automatically sync on load */
  triggerOnLoad: boolean;

  /** Last successful sync status ID */
  lastSyncFailed: boolean;

  /** Last successful sync status ID */
  lastSavedStatusID: number;

  /** Current sync status ID */
  currentSyncStatusID: number;

  /** Should get any deleted books */
  refreshBooks: boolean;

  /** Queue of books to refresh. */
  booksToRefresh: Array<string>;

  /** Queue of books to retry because of previous failure */
  failedBooks: Array<string>;

  /** Map of file path to book ID */
  booksIDsMap: { [filePath: string]: string };

  /** User choice for confirming delete and reimport */
  reimportShowConfirmation: boolean;

  /** The current account within Apple Notes to export to... */
  currentAccount: string;

  /** The default account to export to */
  defaultAccount: string;

  /** List of accounts available to export to */
  accounts: Array<string>;

  hasAppleNotesFileSystemPermission: boolean;

  //** First time syncing */
  firstSync: boolean;
}
