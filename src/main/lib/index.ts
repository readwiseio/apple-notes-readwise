import * as zip from '@zip.js/zip.js'
import MarkdownIt from 'markdown-it'

import { store } from '@/lib/store'

import {
  ExportRequestResponse,
  ExportStatusResponse,
  ReadwiseAuthResponse
} from '../../shared/types'
import {
  checkIfNoteExist,
  checkFolderExistsInAppleNotes,
  checkFolderExistsAndIsEmptyInAppleNotes,
  createNewNote,
  createFolderInAppleNotes,
  appendToExistingNote,
  updateExistingNote
} from './utils'
import { baseURL } from '../../shared/constants'
import { BrowserWindow } from 'electron'
import { AppleNotesExtractor } from './apple-notes'

const md = new MarkdownIt()

export function getAppleNoteClientID(): string {
  let appleNotesClientId = store.get('rw-AppleNotesClientId')
  if (appleNotesClientId) {
    return appleNotesClientId
  } else {
    appleNotesClientId = Math.random().toString(36).substring(2, 15)
    store.set('rw-AppleNotesClientId', appleNotesClientId)
    return appleNotesClientId
  }
}

export async function getUserAuthToken(uuid: string, attempt = 0): Promise<string> {
  let response: Response | undefined
  let data: ReadwiseAuthResponse | undefined
  try {
    response = await fetch(`${baseURL}/api/auth?token=${uuid}`)
  } catch (e) {
    console.log('MAIN: fetch failed in getUserAuthToken: ', e)
    return ''
  }
  if (response && response.ok) {
    data = await response.json()
  } else {
    console.log('MAIN: bad response in getUserAuthToken: ', response)
    return ''
  }

  if (!data) {
    console.log('MAIN: no data in getUserAuthToken')
    return ''
  }

  if (data.userAccessToken) {
    console.log('MAIN: successfully authenticated with Readwise')
    return data.userAccessToken
  } else {
    if (attempt > 20) {
      console.log('MAIN: reached attempt limit in getUserAuthToken')
      return ''
    }
    console.log(`MAIN: didn't get token data, retrying (attempt ${attempt + 1})`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return await getUserAuthToken(uuid, attempt + 1)
  }
}

export class ReadwiseSync {
  mainWindow: BrowserWindow

  store: any // TODO: type this
  database: any

  bookIdsMap = {}

  booksToRefresh: Array<string> = []
  failedBooks: Array<string> = []

  constructor(mainWindow: BrowserWindow, store: any) {
    this.mainWindow = mainWindow
    this.store = store
    this.database = new AppleNotesExtractor(mainWindow, true)
  }

  getAuthHeaders() {
    return {
      AUTHORIZATION: `Token ${this.store.get('token')}`,
      'Client-ID': `${getAppleNoteClientID()}`
    }
  }

  async writeZipEntryToAppleNotes(entry, notesFolder, isICAccount, account) {
    // TODO: fix apple notes filename... it's not the same as the original filename
      // Found entry: .md
      // Extracting entry: 46,109,100
      console.log(`Found entry: ${entry.filename}`)

      // filename examples:
      // Updated note: Articles/The Sound of Software (Updated December 18, 2024 at 1112 AM)--46885037.md
      // New note: Articles/The Sound of Software--46885037.md
      const originalFileName = entry.filename
      const originalName = originalFileName.split('/')[1].split('--')[0].split('(')[0].trim()
      const bookId = originalFileName.split('--')[1].split('.')[0].trim()
      console.log(`Original name: ${originalName}`)
      console.log(`Book ID: ${bookId}`)

      try {
        if (entry.getData) {
          // Read the contents of the file
          const content = await entry.getData(new zip.TextWriter())

          // convert the markdown to html
          const contentToSave = md.render(content)

          let result = ""
          // check if the note already exists
          const note_id = this.bookIdsMap[bookId]

          console.log(`Checking if note exists: (${bookId}) - (${note_id})`)

          if (await checkIfNoteExist(note_id, notesFolder, account)) {
            console.log(`MAIN: Note already exists, updating note: ${originalName} - (${bookId})`)

            if (isICAccount) {
              // get the note from the apple notes database
              const existingHTMLContent = await this.database.extractNoteHTML(
                originalName,
                notesFolder
              )

              // if for some reason we can't extract the existing note content, add the book to the failed list
              if (existingHTMLContent === null) {
                // this book failed to sync, add it to the failed list
                console.log(`MAIN: failed to extract existing note content for ${originalName} - (${bookId})`)
                this.failedBooks.push(bookId)
                return;
              }

              const updatedContent =
                existingHTMLContent +
                '<div><br></div>' +
                contentToSave.replace(/<h1>.*?<\/h1>\s*/s, '') // remove the title from the content

              // NEW WAY THAT WORKS WITH ICLOUD ACCOUNTS (clears the note and rewrites it)
              result = await appendToExistingNote(
                updatedContent,
                originalName,
                notesFolder,
                account
              )
            } else {
                // OLD WAY THAT WORKS WITH non ICAccounts
                result = await updateExistingNote(contentToSave, originalName, notesFolder, account)
            }
          } else {
            // create a new note
            console.log(`MAIN: Note does not exist, creating note: ${originalName} - (${bookId})`)
            result = await createNewNote(contentToSave, originalName, notesFolder, account)
          }

          // track the result of the note creation
          // if it fails, add the book id to the failed list
          if (result) {
            console.log(`MAIN: successfully created note: ${originalName} - (${bookId})`);
            this.bookIdsMap[bookId] = result // track the note id for future updates
            this.mainWindow.webContents.send('syncing-progress')
          } else {
            console.log(`MAIN: failed to create note: ${originalName} - (${bookId})`)
            this.failedBooks.push(bookId)
            return;
          }
        } else {
          console.log('MAIN: entry has no data')
          if (bookId) {
            this.failedBooks.push(bookId)
            return;
          }
        }
      } catch (e) {
        console.log('MAIN: error reading file: ', e)
        if (bookId) {
          this.failedBooks.push(bookId)
          return;
        }
      }
      await this.removeBooksFromRefresh([bookId])
      await this.removeBookFromFailedBooks([bookId])

  }

  // https://github.com/readwiseio/obsidian-readwise/blob/56d903b8d1bc18a7816603c300c6b0afa1241d0e/src/main.ts#L285
  async downloadExport(exportID: number): Promise<void> {
    // download archive from this endpoint
    const artifactURL = `${baseURL}/api/download_artifact/${exportID}`
    // TODO: not sure when this applies... seems to stop all syncing.
    // https://github.com/readwiseio/obsidian-readwise/blob/56d903b8d1bc18a7816603c300c6b0afa1241d0e/src/main.ts#L288
    // const lastSavedStatusID = store.get("lastSavedStatusID");
    // if (exportID <= lastSavedStatusID) {
    //   console.log(
    //     `MAIN: Already saved data from export ${exportID}`
    //   );
    //   await handleSyncSuccess("Synced");
    //   return;
    // }

    let response, blob
    try {
      response = await fetch(artifactURL, { headers: this.getAuthHeaders() })
    } catch (e) {
      console.log('MAIN: fetch failed in downloadExport: ', e)
    }
    if (response && response.ok) {
      blob = await response.blob()
    } else {
      console.log('MAIN: bad response in downloadExport: ', response)
      return
    }

    const zipReader = new zip.ZipReader(new zip.BlobReader(blob))
    const entries = await zipReader.getEntries()

    const notesFolder = this.store.get('readwiseDir')
    const account = this.store.get('currentAccount')

    // Initialize the database connection to Apple Notes
    await this.database.init(notesFolder, account)

    // check if the account is an iCloud account or note
    // if it's an iCloud account, we need to use a different method to update notes which 
    // involves clearing the note and rewriting it with the new content extracted the SQLite database
    // if false, we can just update the note using AppleScript
    const isICAccount = await this.database.getAccountType()
    console.log('MAIN: is iCloud account: ', isICAccount)

    if (!notesFolder) {
      console.log('MAIN: no folder selected')
      this.mainWindow.webContents.send('toast:show', {
        variant: 'destructive',
        message: 'No folder selected'
      })
      await this.handleSyncError('Sync failed')
      return
    }

    if (!account) {
      console.log('MAIN: no account selected')
      this.mainWindow.webContents.send('toast:show', {
        variant: 'destructive',
        message: 'No account selected'
      })
      await this.handleSyncError('Sync failed')
      return
    }

    this.bookIdsMap = this.store.get('booksIDsMap') || {}
    this.failedBooks = this.store.get('failedBooks') || []

    if (entries.length) {
      // Output entry names
      this.mainWindow.webContents.send('syncing-start', entries.length)
      const concurrency = 5;
      const running: Promise<void>[] = [];

      for (const entry of entries) {
        const p = this.writeZipEntryToAppleNotes(entry, notesFolder, isICAccount, account);
        running.push(p);

        // when p finishes, remove it from the array
        p.then(() => {
          running.splice(running.indexOf(p), 1);
        });

        // if we already have 5 running, wait for one to finish
        if (running.length >= concurrency) {
          await Promise.race(running);
        }
      }
      
      // wait for all to finish
      await Promise.all(running);
    }
    // Close the reader
    await zipReader.close()

    // Close the database
    this.database.close()

    // Update the store with the latest bookIdsMap, failedBooks, booksToRefresh
    this.store.set('booksIDsMap', this.bookIdsMap)
    this.store.set('failedBooks', this.failedBooks)
    this.store.set('booksToRefresh', this.booksToRefresh)

    // Acknowledge that the sync is completed
    await this.acknowledgeSyncCompleted()
    await this.handleSyncSuccess('Synced', exportID)

    // Send message to the renderer that the sync is completed
    this.mainWindow.webContents.send('syncing-complete')
    this.mainWindow.webContents.send('toast:show', {
      variant: 'success',
      message: 'Sync completed'
    })

    console.log('MAIN: Synced!', exportID)
    console.log('MAIN: completed sync')
  }

  async removeBooksFromRefresh(bookIds: Array<string>) {
    if (!bookIds.length) return

    console.log(`MAIN: removing books ids ${bookIds.join(', ')} from refresh list`)

    const deduplicatedBooksToRefresh = this.booksToRefresh.filter(
      (bookId: string) => !bookIds.includes(bookId)
    )
    this.booksToRefresh = deduplicatedBooksToRefresh
  }

  async removeBookFromFailedBooks(bookIds: Array<string>) {
    if (!bookIds.length) return

    console.log(`MAIN: removing books ids ${bookIds.join(', ')} from failed list`)
    const deduplicatedFailedBooks = this.failedBooks.filter(
      (bookId: string) => !bookIds.includes(bookId)
    )
    this.failedBooks = deduplicatedFailedBooks
  }

  async acknowledgeSyncCompleted() {
    let response
    try {
      response = await fetch(`${baseURL}/api/poll/apple-notes/sync_ack`, {
        headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
        method: 'POST'
      })
    } catch (e) {
      console.log('MAIN: fetch failed in acknowledgeSyncCompleted: ', e)
    }
    if (response && response.ok) {
      return
    } else {
      console.log('MAIN: bad response in acknowledgeSyncCompleted: ', response)
      await this.handleSyncError(this.getErrorMessageFromResponse(response))
      return
    }
  }

  async getExportStatus(statusID: number, token: string, uuid: string): Promise<void> {
    try {
      const response = await fetch(
        // status of archive build from this endpoint
        `${baseURL}/api/get_export_status?exportStatusId=${statusID}`,
        {
          headers: {
            ...this.getAuthHeaders()
          }
        }
      )

      if (response && response.ok) {
        const data: ExportStatusResponse = await response.json()

        const WAITING_STATUSES = ['PENDING', 'RECEIVED', 'STARTED', 'RETRY']
        const SUCCESS_STATUSES = ['SUCCESS']

        if (WAITING_STATUSES.includes(data.taskStatus)) {
          if (data.booksExported) {
            console.log(`Exporting Readwise data (${data.booksExported} / ${data.totalBooks}) ...`)
            this.mainWindow.webContents.send('export-pending', false)
            this.mainWindow.webContents.send('export-progress', data)
            this.mainWindow.webContents.send('toast:show', {
              variant: 'default',
              message: `Exporting Readwise data (${data.booksExported} / ${data.totalBooks}`
            })
          } else {
            console.log('Building export...')
            this.mainWindow.webContents.send('export-pending', true)
            this.mainWindow.webContents.send('toast:show', {
              variant: 'default',
              message: 'Building export...'
            })
          }

          // wait 1 second
          await new Promise((resolve) => setTimeout(resolve, 1000))
          // then keep polling
          await this.getExportStatus(statusID, token, uuid)
        } else if (SUCCESS_STATUSES.includes(data.taskStatus)) {
          this.mainWindow.webContents.send('export-complete', {})
          this.mainWindow.webContents.send('toast:show', {
            variant: 'success',
            message: 'Export completed'
          })
          console.log('Export completed')
          await this.downloadExport(statusID)
        } else {
          console.log('MAIN: unknown status in getExportStatus: ', data)
          this.mainWindow.webContents.send('export-error', 'Sync failed')
          this.mainWindow.webContents.send('toast:show', {
            variant: 'destructive',
            message: 'Sync failed'
          })
          await this.handleSyncError('Sync failed')
          return
        }
      } else {
        console.log('MAIN: bad response in getExportStatus: ', response)
        this.mainWindow.webContents.send('export-error', 'Sync failed')
        await this.handleSyncError(this.getErrorMessageFromResponse(response))
      }
    } catch (e) {
      this.mainWindow.webContents.send('export-error', 'Sync failed')
      console.log('MAIN: fetch failed in getExportStatus: ', e)
      await this.handleSyncError('Sync failed')
    }
  }

  getErrorMessageFromResponse(response: Response) {
    if (response && response.status === 409) {
      return 'Sync in progress initiated by different client'
    }
    if (response && response.status === 417) {
      return 'Apple Notes export is locked. Wait for an hour.'
    }
    return `${response ? response.statusText : "Can't connect to server"}`
  }

  async handleSyncError(msg = 'Sync failed') {
    await this.clearSettingsAfterRun()
    this.store.set('lastSyncFailed', true)
    console.log('MAIN: ', msg)
  }

  async clearSettingsAfterRun() {
    this.store.set('isSyncing', false)
    this.store.set('currentSyncStatusID', 0)
  }

  async handleSyncSuccess(msg = 'Synced', exportID: number | null = null): Promise<void> {
    await this.clearSettingsAfterRun()
    this.store.set('lastSyncFailed', false)
    if (exportID) {
      this.store.set('lastSavedStatusID', exportID)
    }
    console.log('MAIN: ', msg)
  }

  async queueExport(statusId?: number, auto?: boolean): Promise<string> {
    if (this.store.get('isSyncing')) {
      console.log('Readwise sync already in progress')
      this.mainWindow.webContents.send('toast:show', {
        variant: 'default',
        message: 'Sync already in progress'
      })
      return 'Sync already in progress'
    }

    console.log('MAIN: requesting archive...')
    this.store.set('isSyncing', true)

    const readwiseDir = this.store.get('readwiseDir')
    const account = this.store.get('currentAccount')

    console.log('Readwise app: syncing to folder and account: ', { readwiseDir, account })

    if (!readwiseDir) {
      console.log('MAIN: no folder selected')
      this.mainWindow.webContents.send('toast:show', {
        variant: 'destructive',
        message: 'No folder selected'
      })
      await this.handleSyncError('Sync failed')
      return 'Sync failed'
    }

    if (!account) {
      console.log('MAIN: no account selected')
      this.mainWindow.webContents.send('toast:show', {
        variant: 'destructive',
        message: 'No account selected'
      })
      await this.handleSyncError('Sync failed')
      return 'Sync failed'
    }

    let parentDeleted = false

    // We need to check for three scanarios:
    // 1.) If the folder exists and is empty, then set parentDeleted to true to initiate a full sync
    // 2.) If the folder does not exist, then create it and set parentDeleted to true to initiate a full sync
    // 3.) If the folder exists and is not empty, then set parentDeleted to false to only sync new highlights
    const folderExists = await checkFolderExistsInAppleNotes(readwiseDir, account)
    const folderIsEmpty = await checkFolderExistsAndIsEmptyInAppleNotes(readwiseDir, account)

    // if the folder does not exist, create it and set parentDeleted to true to initiate a full sync
    if (!folderExists) {
      console.log('MAIN: folder does not exist, creating it')
      parentDeleted = true
      const folderCreated = await createFolderInAppleNotes(readwiseDir, account)
      if (!folderCreated) {
        console.log('MAIN: failed to create folder')
        await this.handleSyncError('Sync failed')
        this.mainWindow.webContents.send('toast:show', {
          variant: 'destructive',
          message: 'Error: Failed to create folder'
        })
        return 'Sync failed'
      } else {
        console.log('MAIN: folder created')
      }
    } else {
      // if the folder exists, set parentDeleted to folderIsEmpty value (true if empty, false if not)
      // A scenario where the folder exists but is empty is when the user has deleted all notes in the folder
      // this should trigger a full sync just like when the folder does not exist
      parentDeleted = folderIsEmpty
    }

    let url = `${baseURL}/api/poll/apple-notes/init?parentPageDeleted=${parentDeleted}`
    if (statusId) {
      url += `&statusId=${statusId}`
    }
    if (auto) {
      url += `&auto=${auto}`
    }
    console.log('MAIN: queueExport url: ', url)

    let response: Response | undefined
    let data: ExportRequestResponse | undefined

    const token = this.store.get('token')
    const uuid = getAppleNoteClientID()

    try {
      response = await fetch(url, {
        headers: {
          ...this.getAuthHeaders()
        }
      })
    } catch (e) {
      console.log('MAIN: fetch failed in queueExport: ', e)
      await this.handleSyncError('Sync failed')
      this.mainWindow.webContents.send('toast:show', {
        variant: 'destructive',
        message: 'Synced failed'
      })
      return 'Sync failed'
    }

    if (response && response.ok) {
      data = await response.json()

      // check if data is defined
      if (!data) {
        console.log('MAIN: no data in queueExport')
        await this.handleSyncError('Sync failed')
        this.mainWindow.webContents.send('toast:show', {
          variant: 'destructive',
          message: 'Synced failed'
        })
        return 'Sync failed'
      }

      const lastest_id = this.store.get('lastSavedStatusID')
      console.log(data.latest_id)
      if (data.latest_id <= lastest_id) {
        await this.handleSyncSuccess() // Data is already up to date
        console.log('Readwise data is already up to date')
        this.mainWindow.webContents.send('toast:show', {
          variant: 'success',
          message: 'Data is already up to date'
        })
        return 'Data is already up to date'
      }

      this.store.set('lastSavedStatusID', data.latest_id)
      console.log('MAIN: saved currentSyncStatusID: ', data.latest_id)

      // save the sync status id so it can be polled until the archive is ready
      if (response.status === 201) {
        console.log('Syncing Readwise data')
        await this.getExportStatus(data.latest_id, token, uuid)
        console.log('MAIN: queueExport done')
        return 'Sync completed'
      } else {
        await this.handleSyncSuccess('Synced', data.latest_id)
        console.log(
          'Latest Readwise sync already happended on your other device. Data should be up to date: ',
          response
        )
        this.mainWindow.webContents.send('toast:show', {
          variant: 'success',
          message: 'Data is already up to date'
        })
        return 'Data is already up to date'
      }
    } else {
      console.log('MAIN: bad response in queueExport: ', response)
      await this.handleSyncError(this.getErrorMessageFromResponse(response))
      this.mainWindow.webContents.send('toast:show', {
        variant: 'destructive',
        message: 'Synced failed. Please try again.'
      })
      return 'Sync failed'
    }
  }

  // https://github.com/readwiseio/obsidian-readwise/blob/56d903b8d1bc18a7816603c300c6b0afa1241d0e/src/main.ts#L436
  async syncHighlights(bookIds?: Array<string>, auto? = false): Promise<string> {
    if (!this.store.get('token')) return 'Not connected to Readwise'

    const failedBooks = this.store.get('failedBooks')

    let targetBookIds = [...(bookIds || []), ...failedBooks]

    console.log('MAIN: syncing highlights for books: ', targetBookIds)

    const booksToRefresh = this.store.get('booksToRefresh')
    const refreshBooks = this.store.get('refreshBooks')

    if (refreshBooks) {
      targetBookIds = [...targetBookIds, ...booksToRefresh]
    }

    if (!targetBookIds.length) {
      console.log('MAIN: no targetBookIds, checking for new highlights')
      await this.queueExport()
      return 'Synced'
    }

    console.log('MAIN: refreshing books: ', {
      targetBookIds
    })

    try {
      const response = await fetch(
        // add books to next archive build from this endpoint
        // NOTE: should only end up calling this endpoint when:
        // 1. there are failedBooks
        // 2. there are booksToRefresh
        `${baseURL}/api/refresh_book_export`,
        {
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          method: 'POST',
          body: JSON.stringify({
            exportTarget: 'apple-notes',
            books: targetBookIds
          })
        }
      )

      if (response && response.ok) {
        await this.queueExport()
        return 'Synced'
      } else {
        console.log(`MAIN: saving book id ${bookIds} to refresh later`)
        const booksToRefresh = store.get('booksToRefresh')
        const deduplicatedBookIds = new Set([...booksToRefresh, ...bookIds])
        this.store.set('booksToRefresh', Array.from(deduplicatedBookIds))
        return 'Sync failed'
      }
    } catch (e) {
      console.log('MAIN: fetch failed in syncBookHighlights: ', e)
      return 'Sync failed'
    }
  }
}
