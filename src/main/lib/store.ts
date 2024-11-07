import Store from 'electron-store'
import { ReadwisePluginSettings } from '../../shared/types'

const DEFAULT_SETTINGS: ReadwisePluginSettings = {
  token: '',
  readwiseDir: 'Readwise',
  frequency: '0',
  triggerOnLoad: true,
  isSyncing: false,
  lastSyncFailed: false,
  lastSavedStatusID: 0,
  currentSyncStatusID: 0,
  refreshBooks: false,
  booksToRefresh: [],
  failedBooks: [],
  booksIDsMap: {},
  reimportShowConfirmation: true,
  account: 'iCloud'
}

export const store = new Store<ReadwisePluginSettings>({
  defaults: DEFAULT_SETTINGS
})
