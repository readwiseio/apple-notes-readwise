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
  updateExistingNote,
  createNewNote,
  createFolderInAppleNotes
} from './utils'
import { baseURL } from '../../shared/constants'
import { BrowserWindow } from 'electron'

const md = new MarkdownIt()

export function getObsidianClientID(): string {
  let obsidianClientId = store.get('rw-AppleNotesClientId')
  if (obsidianClientId) {
    return obsidianClientId
  } else {
    obsidianClientId = Math.random().toString(36).substring(2, 15)
    store.set('rw-AppleNotesClientId', obsidianClientId)
    return obsidianClientId
  }
}

export async function getUserAuthToken(uuid: string, attempt = 0): Promise<string> {
  let response: Response | undefined
  let data: ReadwiseAuthResponse | undefined
  try {
    response = await fetch(`${baseURL}/api/auth?token=${uuid}`)
  } catch (e) {
    console.log('Readwise Official plugin: fetch failed in getUserAuthToken: ', e)
    return ''
  }
  if (response && response.ok) {
    data = await response.json()
  } else {
    console.log('Readwise Official plugin: bad response in getUserAuthToken: ', response)
    return ''
  }

  if (!data) {
    console.log('Readwise Official plugin: no data in getUserAuthToken')
    return ''
  }

  if (data.userAccessToken) {
    console.log('Readwise Official plugin: successfully authenticated with Readwise')
    return data.userAccessToken
  } else {
    if (attempt > 20) {
      console.log('Readwise Official plugin: reached attempt limit in getUserAuthToken')
      return ''
    }
    console.log(
      `Readwise Official plugin: didn't get token data, retrying (attempt ${attempt + 1})`
    )
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return await getUserAuthToken(uuid, attempt + 1)
  }
}

export class ReadwiseSync {
  mainWindow: BrowserWindow
  store: any // TODO: type this

  constructor(mainWindow: BrowserWindow, store: any) {
    this.mainWindow = mainWindow
    this.store = store
  }

  getAuthHeaders() {
    return {
      AUTHORIZATION: `Token ${this.store.get('token')}`,
      'Obsidian-Client': `${getObsidianClientID()}`
    }
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
    //     `Readwise Official plugin: Already saved data from export ${exportID}`
    //   );
    //   await handleSyncSuccess("Synced");
    //   return;
    // }

    let response, blob
    try {
      response = await fetch(artifactURL, { headers: this.getAuthHeaders() })
    } catch (e) {
      console.log('Readwise Official plugin: fetch failed in downloadExport: ', e)
    }
    if (response && response.ok) {
      blob = await response.blob()
    } else {
      console.log('Readwise Official plugin: bad response in downloadExport: ', response)
      return
    }

    const zipReader = new zip.ZipReader(new zip.BlobReader(blob))

    const entries = await zipReader.getEntries()

    const notesFolder = this.store.get('readwiseDir')
    const account = this.store.get('currentAccount')

    if (!notesFolder) {
      console.log('Readwise Official plugin: no folder selected')
      this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'No folder selected' })
      await this.handleSyncError('Sync failed')
      return
    }

    if (!account) {
      console.log('Readwise Official plugin: no account selected')
      this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'No account selected' })
      await this.handleSyncError('Sync failed')
      return
    }

    const bookIdsMap = this.store.get('booksIDsMap')

    if (entries.length) {
      // Output entry names
      this.mainWindow.webContents.send('syncing-start', entries.length)
      for (const entry of entries) {
        console.log(`Found entry: ${entry.filename}`)

        // Readwise/Books/Introduction-to-Algorithms--44011615.md
        // extract the filename and book id
        // 44011615
        const originalFileName = entry.filename
        const originalName = originalFileName.split('--')[0].split('/')[2]
        const bookId = originalFileName.split('--')[1].split('.')[0]
        console.log(`Original name: ${originalName}`)
        console.log(`Book ID: ${bookId}`)

        // track the book
        bookIdsMap[originalName] = bookIdsMap

        try {
          if (entry.getData) {
            // Read the contents of the file
            const content = await entry.getData(new zip.TextWriter())

            // convert the markdown to html
            const contentToSave = md.render(content)

            let result = false
            // check if the note already exists
            if (await checkIfNoteExist(originalName, notesFolder, account)) {
              console.log('Note already exists, updating note with new content')
              result = await updateExistingNote(contentToSave, originalName, notesFolder, account)
            } else {
              // create a new note
              console.log("Note doesn't exist, creating new note")
              result = await createNewNote(contentToSave, originalName, notesFolder, account)
            }

            // track the result of the note creation
            // if it fails, add the book id to the failed list
            if (result) {
              console.log('Readwise Official plugin: note created successfully')
              this.mainWindow.webContents.send('syncing-progress')
            } else {
              console.log('Readwise Official plugin: failed to create note')
              const failedBooks = store.get('failedBooks')
              const deduplicatedFailedBooks = new Set([...failedBooks, bookId])
              store.set('failedBooks', Array.from(deduplicatedFailedBooks))
            }
          } else {
            console.log('Readwise Official plugin: entry has no data')
            if (bookId) {
              const failedBooks = store.get('failedBooks')
              const deduplicatedFailedBooks = new Set([...failedBooks, bookId])
              store.set('failedBooks', Array.from(deduplicatedFailedBooks))
            }
          }
        } catch (e) {
          console.log('Readwise Official plugin: error reading file: ', e)
          if (bookId) {
            const failedBooks = store.get('failedBooks')
            const deduplicatedFailedBooks = new Set([...failedBooks, bookId])
            store.set('failedBooks', Array.from(deduplicatedFailedBooks))
          }
        }
        await this.removeBooksFromRefresh([bookId])
        await this.removeBookFromFailedBooks([bookId])
      }
    }
    // Close the reader
    await zipReader.close()
    await this.acknowledgeSyncCompleted()
    await this.handleSyncSuccess('Synced', exportID)
    this.mainWindow.webContents.send('syncing-complete')
    this.mainWindow.webContents.send('toast:show', { variant: 'success', message: 'Sync completed' })
    console.log('Readwise Official plugin: Synced!', exportID)
    console.log('Readwise Official plugin: completed sync')
  }

  async removeBooksFromRefresh(bookIds: Array<string>) {
    if (!bookIds.length) return

    console.log(
      `Readwise Official plugin: removing books ids ${bookIds.join(', ')} from refresh list`
    )

    const booksToRefresh = this.store.get('booksToRefresh')
    const deduplicatedBooksToRefresh = booksToRefresh.filter(
      (bookId: string) => !bookIds.includes(bookId)
    )
    this.store.set('booksToRefresh', deduplicatedBooksToRefresh)
  }

  async removeBookFromFailedBooks(bookIds: Array<string>) {
    if (!bookIds.length) return

    console.log(
      `Readwise Official plugin: removing books ids ${bookIds.join(', ')} from failed list`
    )
    const failedBooks = this.store.get('failedBooks')
    const deduplicatedFailedBooks = failedBooks.filter(
      (bookId: string) => !bookIds.includes(bookId)
    )
    this.store.set('failedBooks', deduplicatedFailedBooks)
  }

  async acknowledgeSyncCompleted() {
    let response
    try {
      response = await fetch(`${baseURL}/api/obsidian/sync_ack`, {
        headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
        method: 'POST'
      })
    } catch (e) {
      console.log('Readwise Official plugin: fetch failed in acknowledgeSyncCompleted: ', e)
    }
    if (response && response.ok) {
      return
    } else {
      console.log('Readwise Official plugin: bad response in acknowledgeSyncCompleted: ', response)
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
            this.mainWindow.webContents.send('toast:show', { variant: 'default', message: `Exporting Readwise data (${data.booksExported} / ${data.totalBooks}` })
          } else {
            console.log('Building export...')
            this.mainWindow.webContents.send('export-pending', true)
            this.mainWindow.webContents.send('toast:show', { variant: 'default', message: 'Building export...' })
          }

          // wait 1 second
          await new Promise((resolve) => setTimeout(resolve, 1000))
          // then keep polling
          await this.getExportStatus(statusID, token, uuid)
        } else if (SUCCESS_STATUSES.includes(data.taskStatus)) {
          this.mainWindow.webContents.send('export-complete', {})
          this.mainWindow.webContents.send('toast:show', { variant: 'success', message: 'Export completed' })
          console.log('Export completed')
          await this.downloadExport(statusID)
        } else {
          console.log('Readwise Official plugin: unknown status in getExportStatus: ', data)
          this.mainWindow.webContents.send('export-error', 'Sync failed')
          this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'Sync failed' })
          await this.handleSyncError('Sync failed')
          return
        }
      } else {
        console.log('Readwise Official plugin: bad response in getExportStatus: ', response)
        this.mainWindow.webContents.send('export-error', 'Sync failed')
        await this.handleSyncError(this.getErrorMessageFromResponse(response))
      }
    } catch (e) {
      this.mainWindow.webContents.send('export-error', 'Sync failed')
      console.log('Readwise Official plugin: fetch failed in getExportStatus: ', e)
      await this.handleSyncError('Sync failed')
    }
  }

  getErrorMessageFromResponse(response: Response) {
    if (response && response.status === 409) {
      return 'Sync in progress initiated by different client'
    }
    if (response && response.status === 417) {
      return 'Obsidian export is locked. Wait for an hour.'
    }
    return `${response ? response.statusText : "Can't connect to server"}`
  }

  async handleSyncError(msg = 'Sync failed') {
    await this.clearSettingsAfterRun()
    this.store.set('lastSyncFailed', true)
    console.log('Readwise Official plugin: ', msg)
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
    console.log('Readwise Official plugin: ', msg)
  }

  async queueExport(statusId?: number,  auto?: boolean): Promise<string> {
    if (this.store.get('isSyncing')) {
      console.log('Readwise sync already in progress')
      this.mainWindow.webContents.send('toast:show', { variant: 'default', message: 'Sync already in progress' })
      return 'Sync already in progress'
    }

    console.log('Readwise Official plugin: requesting archive...')
    this.store.set('isSyncing', true)

    const readwiseDir = this.store.get('readwiseDir')
    const account = this.store.get('currentAccount')

    console.log('Readwise app: syncing to folder and account: ', { readwiseDir, account })

    if (!readwiseDir) {
      console.log('Readwise Official plugin: no folder selected')
      this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'No folder selected' })
      await this.handleSyncError('Sync failed')
      return 'Sync failed'
    }

    if (!account) {
      console.log('Readwise Official plugin: no account selected')
      this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'No account selected' })
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
      console.log('Readwise Official plugin: folder does not exist, creating it')
      parentDeleted = true
      const folderCreated = await createFolderInAppleNotes(readwiseDir, account)
      if (!folderCreated) {
        console.log('Readwise Official plugin: failed to create folder')
        await this.handleSyncError('Sync failed')
        this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'Error: Failed to create folder' })
        return 'Sync failed'
      } else {
        console.log('Readwise Official plugin: folder created')
      }
    } else {
      // if the folder exists, set parentDeleted to folderIsEmpty value (true if empty, false if not)
      // A scenario where the folder exists but is empty is when the user has deleted all notes in the folder
      // this should trigger a full sync just like when the folder does not exist
      parentDeleted = folderIsEmpty
    }

    let url = `${baseURL}/api/obsidian/init?parentPageDeleted=${parentDeleted}`
    if (statusId) {
      url += `&statusId=${statusId}`
    }
    if (auto) {
      url += `&auto=${auto}`
    }
    console.log('Readwise Official plugin: queueExport url: ', url)

    let response: Response | undefined
    let data: ExportRequestResponse | undefined

    const token = this.store.get('token')
    const uuid = getObsidianClientID()

    try {
      response = await fetch(url, {
        headers: {
          ...this.getAuthHeaders()
        }
      })
    } catch (e) {
      console.log('Readwise Official plugin: fetch failed in queueExport: ', e)
      await this.handleSyncError('Sync failed')
      this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'Synced failed' })
      return 'Sync failed'
    }

    if (response && response.ok) {
      data = await response.json()

      // check if data is defined
      if (!data) {
        console.log('Readwise Official plugin: no data in queueExport')
        await this.handleSyncError('Sync failed')
        this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'Synced failed' })
        return 'Sync failed'
      }

      const lastest_id = this.store.get('lastSavedStatusID')
      console.log(data.latest_id)
      if (data.latest_id <= lastest_id) {
        await this.handleSyncSuccess() // Data is already up to date
        console.log('Readwise data is already up to date')
        this.mainWindow.webContents.send('toast:show', { variant: 'success', message: 'Data is already up to date' })
        return 'Data is already up to date'
      }

      this.store.set('lastSavedStatusID', data.latest_id)
      console.log('Readwise Official plugin: saved currentSyncStatusID: ', data.latest_id)

      // save the sync status id so it can be polled until the archive is ready
      if (response.status === 201) {
        console.log('Syncing Readwise data')
        await this.getExportStatus(data.latest_id, token, uuid)
        console.log('Readwise Official plugin: queueExport done')
        return 'Sync completed'
      } else {
        await this.handleSyncSuccess('Synced', data.latest_id)
        console.log(
          'Latest Readwise sync already happended on your other device. Data should be up to date: ',
          response
        )
        this.mainWindow.webContents.send('toast:show', { variant: 'success', message: 'Data is already up to date' })
        return 'Data is already up to date'
      }
    } else {
      console.log('Readwise Official plugin: bad response in queueExport: ', response)
      await this.handleSyncError(this.getErrorMessageFromResponse(response))
      this.mainWindow.webContents.send('toast:show', { variant: 'destructive', message: 'Synced failed. Please try again.' })
      return 'Sync failed'
    }
  }

  // https://github.com/readwiseio/obsidian-readwise/blob/56d903b8d1bc18a7816603c300c6b0afa1241d0e/src/main.ts#L436
  async syncHighlights(bookIds?: Array<string>, auto? = false): Promise<string> {
    if (!this.store.get('token')) return 'Not connected to Readwise'

    const failedBooks = this.store.get('failedBooks')

    let targetBookIds = [...(bookIds || []), ...failedBooks]

    console.log('Readwise Official plugin: syncing highlights for books: ', targetBookIds)

    const booksToRefresh = this.store.get('booksToRefresh')
    const refreshBooks = this.store.get('refreshBooks')

    if (refreshBooks) {
      targetBookIds = [...targetBookIds, ...booksToRefresh]
    }

    if (!targetBookIds.length) {
      console.log('Readwise Official plugin: no targetBookIds, checking for new highlights')
      await this.queueExport()
      return 'Synced'
    }

    console.log('Readwise Official plugin: refreshing books: ', {
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
            exportTarget: 'obsidian',
            books: targetBookIds
          })
        }
      )

      if (response && response.ok) {
        await this.queueExport()
        return 'Synced'
      } else {
        console.log(`Readwise Official plugin: saving book id ${bookIds} to refresh later`)
        const booksToRefresh = store.get('booksToRefresh')
        const deduplicatedBookIds = new Set([...booksToRefresh, ...bookIds])
        this.store.set('booksToRefresh', Array.from(deduplicatedBookIds))
        return 'Sync failed'
      }
    } catch (e) {
      console.log('Readwise Official plugin: fetch failed in syncBookHighlights: ', e)
      return 'Sync failed'
    }
  }
}
