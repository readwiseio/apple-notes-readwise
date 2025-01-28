// import fs from 'fs' // DEBUG: for writing files to the output folder
import { store } from '@/lib/store'
import * as zip from '@zip.js/zip.js'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import MarkdownIt from 'markdown-it'
import { baseURL } from '../../shared/constants'

import {
  ExportRequestResponse,
  ExportStatusResponse,
  ReadwiseAuthResponse,
  ReadwisePluginSettings,
  ReadwiseSyncMessage
} from '../../shared/types'
import { AppleNotesExtractor } from './parser/apple-notes'
import {
  appendToExistingNote,
  checkFolderExistsAndIsEmptyInAppleNotes,
  checkFolderExistsInAppleNotes,
  checkIfNoteExist,
  createFolderInAppleNotes,
  createNewNote,
  updateExistingNote
} from './utils'

const TAGS_TO_REPLACE_REGEX = /<\/p>|<\/h[1-6]>|<\/ul>|<\/ol>/g;

const md = new MarkdownIt({
  breaks: true, // Convert '\n' in paragraphs into <br>
  html: true, // Enable HTML tags in source
});

// Override the image renderer to prepend "file://" to local paths
// @ts-ignore
md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx];

  // Get src attribute value
  // @ts-ignore
  let src = token.attrs[token.attrIndex("src")][1];

  // If the src is a local path, prepend "file://"
  if (src.startsWith("/")) {
    // @ts-ignore
    token.attrs[token.attrIndex("src")][1] = `file://${src}`;
  }

  return self.renderToken(tokens, idx, options);
};

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

  store: Store<ReadwisePluginSettings>
  database: AppleNotesExtractor

  bookIdsMap = {}

  booksToRefresh: Array<string> = []
  failedBooks: Array<string> = []

  constructor(mainWindow: BrowserWindow, store: any) {
    this.mainWindow = mainWindow
    this.store = store
    this.database = new AppleNotesExtractor(mainWindow, true, this.store)
  }

  getAuthHeaders() {
    return {
      AUTHORIZATION: `Token ${this.store.get('token')}`,
      'Client-ID': `${getAppleNoteClientID()}`
    }
  }

  sendToRenderer(channel: string, ...args: any[]) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args)
    }
  }

  async writeZipEntryToAppleNotes(entry: zip.Entry, notesFolder: string, isICAccount: boolean, account: string) {    
    const originalFileName = entry.filename
    const originalName = originalFileName.split('/')[1].split('--')[0].split('(')[0].trim()
    const bookId = originalFileName.split('--')[1].split('.')[0].trim()
    console.log(`Original name: ${originalName}`)
    console.log(`Book ID: ${bookId}`)

    try {
      if (entry.getData) {
        const content = await entry.getData(new zip.TextWriter())
        // DEBUG: write the markdown file to the output folder
        // if (!fs.existsSync('output')) {
        //   fs.mkdirSync('output')
        // }

        // fs.writeFileSync(`output/${originalName}.md`, content)
        // convert the markdown to html
        let contentToSaveHTML = md.render(content)

        // DEBUG: write the html file to the output folder
        // fs.writeFileSync(`output/${originalName}.html`, contentToSaveHTML)
        // add a line break after each paragraph and heading tags for coesmetic purposes
        contentToSaveHTML = contentToSaveHTML.replace(TAGS_TO_REPLACE_REGEX, '$&<br>');

        // DEBUG: write the html file to the output folder
        // fs.writeFileSync(`output/${originalName}-add-breaks.html`, contentToSaveHTML)

        let result = ''
        // check if the note already exists in our local config file
        const note_id = this.bookIdsMap[bookId]

        console.log(`Checking if note exists: (${bookId}) - (${note_id ? note_id : 'no note id'})`)

        if (note_id && (await checkIfNoteExist(note_id, notesFolder, account))) {
          console.log(`MAIN: Note already exists, updating note: ${originalName} - (${bookId})`)

          if (isICAccount) {
            // the primary key can be found at the end of the id return from AppleScript
            // Ex. x-coredata://E5AB9D06-5845-4AC6-A4A4-DBB2EC160D74/ICNote/p235619
            // The primary key is 235619
            const note_pk = note_id.match(/p(\d+)$/)[1]

            if (!note_pk) {
              console.log('MAIN: failed to extract note primary key')
              this.failedBooks.push(bookId)
              return
            }
            // get the note's body from the apple notes database
            let existingContentMarkdown = await this.database.extractNoteHTML(
              note_pk
            )
            // DEBUG: write the existing note content to the output folder
            // fs.writeFileSync(`output/${originalName}-existing.md`, existingContentMarkdown)
            // if for some reason we can't extract the existing note content, add the book to the failed list
            if (!existingContentMarkdown) {
              // this book failed to sync, add it to the failed list
              console.log(
                `MAIN: failed to extract existing note content for ${originalName} - (${bookId})`
              )
              this.failedBooks.push(bookId)
              return
            }

            // remove the top heading from the new content
            let updatedContent = existingContentMarkdown + '\n\n' + content.replace(/^# .*?\n\s*/s, '');

            // DEBUG: write the updated markdown to the output folder
            // fs.writeFileSync(`output/${originalName}-updated.md`, updatedContent)

            // convert the updated markdown to html for saving to Apple Notes
            let udpatedContentHTML = md.render(updatedContent)

            // DEBUG: write the updated html to the output folder
            // fs.writeFileSync(`output/${originalName}-updated.html`, udpatedContentHTML)

            // add a line break after each paragraph and heading tags for coesmetic purposes
            udpatedContentHTML = udpatedContentHTML.replace(TAGS_TO_REPLACE_REGEX, '$&<br>');

            // DEBUG: write the updated html to the output folder
            // fs.writeFileSync(`output/${originalName}-updated-add-breaks.html`, udpatedContentHTML)

            // NEW WAY THAT WORKS WITH ICLOUD ACCOUNTS (clears the note and rewrites it)
            result = await appendToExistingNote(udpatedContentHTML, note_id, notesFolder, account)
          } else {
            // OLD WAY THAT WORKS WITH non ICAccounts
            result = await updateExistingNote(contentToSaveHTML, note_id, notesFolder, account)
          }
        } else {
          // create a new note
          console.log(`MAIN: Note does not exist, creating note: ${originalName} - (${bookId})`)
          result = await createNewNote(contentToSaveHTML, originalName, notesFolder, account)
        }

        // track the result of the note creation
        // if it fails, add the book id to the failed list
        if (result) {
          console.log(`MAIN: successfully created note: ${originalName} - (${bookId})`)
          this.bookIdsMap[bookId] = result // track the note id for future updates
          this.sendToRenderer('syncing-progress')
        } else {
          console.log(`MAIN: failed to create note: ${originalName} - (${bookId})`)
          this.failedBooks.push(bookId)
          return
        }
      } else {
        console.log('MAIN: entry has no data')
        if (bookId) {
          this.failedBooks.push(bookId)
          return
        }
      }
    } catch (e) {
      console.log('MAIN: error reading file: ', e)
      if (bookId) {
        this.failedBooks.push(bookId)
        return
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
    //   // Send message to the renderer that the sync is completed
    //   this.mainWindow.webContents.send("syncing-complete");
    //   this.sendToRenderer('syncing-complete')
    //   await this.handleSyncSuccess(ReadwiseSyncMessage.ALREADY_SAVED);
    //   return;
    // }

    let response: Response | undefined, blob: Blob | undefined
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

    // if the database is not found or the account is not selected, stop the sync
    if (!this.database.database) {
      console.log('MAIN: database was not found')
      await this.handleSyncError(ReadwiseSyncMessage.FAILED)
      return
    }
    // check if the account is an iCloud account or note
    // if it's an iCloud account, we need to use a different method to update notes which
    // involves clearing the note and rewriting it with the new content extracted the SQLite database
    // if false, we can just update the note using AppleScript
    const isICAccount = await this.database.getAccountType()
    console.log('MAIN: is iCloud account: ', isICAccount)

    if (!notesFolder) {
      console.log('MAIN: no folder selected')
      this.sendToRenderer('toast:show', {
        variant: 'destructive',
        message: 'No folder selected'
      })
      await this.handleSyncError(ReadwiseSyncMessage.FAILED)
      return
    }

    if (!account) {
      console.log('MAIN: no account selected')
      this.sendToRenderer('toast:show', {
        variant: 'destructive',
        message: 'No account selected'
      })
      await this.handleSyncError(ReadwiseSyncMessage.FAILED)
      return
    }

    this.bookIdsMap = this.store.get('booksIDsMap') || {}
    this.failedBooks = this.store.get('failedBooks') || []

    if (entries.length) {
      this.sendToRenderer('syncing-start', entries.length)
      console.log('MAIN: syncing', entries.length, 'entries')

      const concurrency = 5
      const running: Promise<void>[] = []

      for (const entry of entries) {
        const p = this.writeZipEntryToAppleNotes(entry, notesFolder, isICAccount, account)
        running.push(p)

        // when p finishes, remove it from the array
        p.then(() => {
          running.splice(running.indexOf(p), 1)
        })

        // if we already have 5 running, wait for one to finish
        if (running.length >= concurrency) {
          await Promise.race(running)
        }
      }

      // wait for all to finish
      await Promise.all(running)
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
    await this.handleSyncSuccess(ReadwiseSyncMessage.SYNCED, exportID)

    // Send message to the renderer that the sync is completed
    this.sendToRenderer('syncing-complete')

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
            console.log(`MAIN: Exporting Readwise data (${data.booksExported} / ${data.totalBooks}) ...`)
            this.sendToRenderer('export-progress', data)
          } else {
            console.log('MAIN: Building export...')
          }

          // wait 1 second
          await new Promise((resolve) => setTimeout(resolve, 1000))
          // then keep polling
          await this.getExportStatus(statusID, token, uuid)
        } else if (SUCCESS_STATUSES.includes(data.taskStatus)) {
          this.sendToRenderer('export-complete', true)
          console.log('Export completed')
          await this.downloadExport(statusID)
        } else {
          console.log('MAIN: unknown status in getExportStatus: ', data)
          this.sendToRenderer('export-error', 'Download Export failed')
          await this.handleSyncError(ReadwiseSyncMessage.FAILED)
          return
        }
      } else {
        console.log('MAIN: bad response in getExportStatus: ', response)
        this.sendToRenderer('export-error', 'Download Export failed')
        await this.handleSyncError(this.getErrorMessageFromResponse(response))
      }
    } catch (e) {
      console.log('MAIN: fetch failed in getExportStatus: ', e)
      this.sendToRenderer('export-error', 'Download Export failed')
      await this.handleSyncError(ReadwiseSyncMessage.FAILED)
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

  async handleSyncSuccess(msg = ReadwiseSyncMessage.SYNCED, exportID: number | null = null): Promise<void> {
    await this.clearSettingsAfterRun()
    this.store.set('lastSyncFailed', false)
    if (exportID) {
      this.store.set('lastSavedStatusID', exportID)
    }
    console.log('MAIN: ', msg)
  }

  async queueExport(statusId?: number, auto?: boolean): Promise<void> {
    if (this.store.get('isSyncing')) {
      console.log('MAIN: Readwise sync already in progress')
      this.sendToRenderer('toast:show', {
        variant: 'default',
        message: ReadwiseSyncMessage.SYNC_ALREADY_IN_PROGRESS.toString()
      })
      return
    }

    console.log('MAIN: requesting archive...')
    this.store.set('isSyncing', true)

    const readwiseDir = this.store.get('readwiseDir')
    const account = this.store.get('currentAccount')

    console.log('Readwise app: syncing to folder and account: ', { readwiseDir, account })

    if (!readwiseDir) {
      console.log('MAIN: no folder selected')
      this.sendToRenderer('toast:show', {
        variant: 'destructive',
        message: 'No folder selected'
      })
      await this.handleSyncError('Sync failed')
      return
    }

    if (!account) {
      console.log('MAIN: no account selected')
      this.sendToRenderer('toast:show', {
        variant: 'destructive',
        message: 'No account selected'
      })
      await this.handleSyncError('Sync failed')
      return
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
        this.sendToRenderer('toast:show', {
          variant: 'destructive',
          message: 'Failed to create folder'
        })
        return
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
      return
    }

    if (response && response.ok) {
      data = await response.json()

      // check if data is defined
      if (!data) {
        console.log('MAIN: no data in queueExport')
        await this.handleSyncError('Sync failed')
        this.sendToRenderer('toast:show', {
          variant: 'destructive',
          message: ReadwiseSyncMessage.FAILED.toString()
        })
        return
      }

      const lastest_id = this.store.get('lastSavedStatusID')
      console.log(data.latest_id)
      if (data.latest_id <= lastest_id) {
        await this.handleSyncSuccess() // Data is already up to date
        console.log('MAIN: Readwise data is already up to date')
        this.sendToRenderer('toast:show', {
          variant: 'default',
          message: ReadwiseSyncMessage.ALREADY_SAVED.toString()
        })
        return
      }

      this.store.set('lastSavedStatusID', data.latest_id)
      console.log('MAIN: saved currentSyncStatusID: ', data.latest_id)

      // save the sync status id so it can be polled until the archive is ready
      if (response.status === 201) {
        console.log('MAIN: Syncing Readwise data')
        await this.getExportStatus(data.latest_id, token, uuid)
        console.log('MAIN: queueExport done')
        this.sendToRenderer('toast:show', {
          variant: 'success',
          message: ReadwiseSyncMessage.SYNCED.toString()
        })
        return
      } else {
        await this.handleSyncSuccess(ReadwiseSyncMessage.SYNCED, data.latest_id)
        console.log(
          'Latest Readwise sync already happended on your other device. Data should be up to date: ',
          response
        )
        this.sendToRenderer('toast:show', {
          variant: 'success',
          message: ReadwiseSyncMessage.SAVED_ON_ANOTHER_DEVICE.toString()
        })
        return
      }
    } else {
      console.log('MAIN: bad response in queueExport: ', response)
      await this.handleSyncError(this.getErrorMessageFromResponse(response))
      return
    }
  }

  // https://github.com/readwiseio/obsidian-readwise/blob/56d903b8d1bc18a7816603c300c6b0afa1241d0e/src/main.ts#L436
  async syncHighlights(bookIds?: Array<string>, auto = false): Promise<void> {
    if (!this.store.get('token')) return

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
      return
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
        return
      } else {
        console.log(`MAIN: saving book id ${bookIds} to refresh later`)
        const booksToRefresh = store.get('booksToRefresh')
        const deduplicatedBookIds = new Set([...booksToRefresh, ...bookIds])
        this.store.set('booksToRefresh', Array.from(deduplicatedBookIds))
        return 
      }
    } catch (e) {
      console.log('MAIN: fetch failed in syncBookHighlights: ', e)
      return
    }
  }
}
