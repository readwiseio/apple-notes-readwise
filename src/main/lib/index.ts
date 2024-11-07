import * as zip from '@zip.js/zip.js'
import MarkdownIt from 'markdown-it'

import { store } from './store'

import {
  ExportRequestResponse,
  ExportStatusResponse,
  ReadwiseAuthResponse
} from '../../shared/types'
import {
  checkIfNoteExist,
  checkIfFolderIsEmtpy,
  checkFolderExistsInAppleNotes,
  updateExistingNote,
  createNewNote
} from './utils'
import { baseURL } from '../../shared/constants'

const md = new MarkdownIt()

function getAuthHeaders() {
  return {
    AUTHORIZATION: `Token ${store.get('token')}`,
    'Obsidian-Client': `${getObsidianClientID()}`
  }
}

async function downloadExport(exportID: number): Promise<void> {
  // download archive from this endpoint
  const artifactURL = `${baseURL}/api/download_artifact/${exportID}`
  // TODO: not sure when this applies... seems to stop all syncing.
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
    response = await fetch(artifactURL, { headers: getAuthHeaders() })
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

  const notesFolder = store.get('readwiseDir')
  const account = store.get('account')

  const bookIdsMap = store.get('booksIDsMap')

  if (entries.length) {
    // Output entry names
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
      await removeBooksFromRefresh([bookId])
      await removeBookFromFailedBooks([bookId])
    }
  }

  // Close the reader
  await zipReader.close()
  await acknowledgeSyncCompleted()
  await handleSyncSuccess('Synced', exportID)
  console.log('Readwise Official plugin: Synced!', exportID)
  console.log('Readwise Official plugin: completed sync')
}

async function removeBooksFromRefresh(bookIds: Array<string>) {
  if (!bookIds.length) return

  console.log(
    `Readwise Official plugin: removing books ids ${bookIds.join(', ')} from refresh list`
  )

  const booksToRefresh = store.get('booksToRefresh')
  const deduplicatedBooksToRefresh = booksToRefresh.filter(
    (bookId: string) => !bookIds.includes(bookId)
  )
  store.set('booksToRefresh', deduplicatedBooksToRefresh)
}

async function removeBookFromFailedBooks(bookIds: Array<string>) {
  if (!bookIds.length) return

  console.log(`Readwise Official plugin: removing books ids ${bookIds.join(', ')} from failed list`)
  const failedBooks = store.get('failedBooks')
  const deduplicatedFailedBooks = failedBooks.filter((bookId: string) => !bookIds.includes(bookId))
  store.set('failedBooks', deduplicatedFailedBooks)
}

async function acknowledgeSyncCompleted() {
  let response
  try {
    response = await fetch(`${baseURL}/api/obsidian/sync_ack`, {
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      method: 'POST'
    })
  } catch (e) {
    console.log('Readwise Official plugin: fetch failed in acknowledgeSyncCompleted: ', e)
  }
  if (response && response.ok) {
    return
  } else {
    console.log('Readwise Official plugin: bad response in acknowledgeSyncCompleted: ', response)
    await handleSyncError(getErrorMessageFromResponse(response))
    return
  }
}

async function getExportStatus(statusID: number, token: string, uuid: string) {
  try {
    const response = await fetch(
      // status of archive build from this endpoint
      `${baseURL}/api/get_export_status?exportStatusId=${statusID}`,
      {
        headers: {
          ...getAuthHeaders()
        }
      }
    )

    if (response && response.ok) {
      const data: ExportStatusResponse = await response.json()

      const WAITING_STATUSES = ['PENDING', 'RECEIVED', 'STARTED', 'RETRY']
      const SUCCESS_STATUSES = ['SUCCESS']

      if (WAITING_STATUSES.includes(data.taskStatus)) {
        if (data.booksExported) {
          const progressMsg = `Exporting Readwise data (${data.booksExported} / ${data.totalBooks}) ...`
          console.log(progressMsg)
        } else {
          console.log('Building export...')
        }

        // wait 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000))
        // then keep polling
        await getExportStatus(statusID, token, uuid)
      } else if (SUCCESS_STATUSES.includes(data.taskStatus)) {
        await downloadExport(statusID)
      } else {
        console.log('Readwise Official plugin: unknown status in getExportStatus: ', data)
        await handleSyncError('Sync failed')
        return
      }
    } else {
      console.log('Readwise Official plugin: bad response in getExportStatus: ', response)
      await handleSyncError(getErrorMessageFromResponse(response))
    }
  } catch (e) {
    console.log('Readwise Official plugin: fetch failed in getExportStatus: ', e)
    await handleSyncError('Sync failed')
  }
}

function getErrorMessageFromResponse(response: Response) {
  if (response && response.status === 409) {
    return 'Sync in progress initiated by different client'
  }
  if (response && response.status === 417) {
    return 'Obsidian export is locked. Wait for an hour.'
  }
  return `${response ? response.statusText : "Can't connect to server"}`
}

async function handleSyncError(msg = 'Sync failed') {
  await clearSettingsAfterRun()
  store.set('lastSyncFailed', true)
  console.log('Readwise Official plugin: ', msg)
}

async function clearSettingsAfterRun() {
  store.set('isSyncing', false)
  store.set('currentSyncStatusID', 0)
}

async function handleSyncSuccess(msg = 'Synced', exportID: number | null = null): Promise<void> {
  await clearSettingsAfterRun()
  store.set('lastSyncFailed', false)
  if (exportID) {
    store.set('lastSavedStatusID', exportID)
  }
  console.log('Readwise Official plugin: ', msg)
}

async function queueExport(statusId?: number): Promise<string> {
  if (store.get('isSyncing')) {
    console.log('Readwise sync already in progress')
    return 'Sync already in progress'
  }

  console.log('Readwise Official plugin: requesting archive...')
  store.set('isSyncing', true)

  const readwiseDir = store.get('readwiseDir')
  const account = store.get('account')

  console.log('Readwise app: syncing to folder and account: ', { readwiseDir, account })

  let parentDeleted = false
  // If user is syncing with iCloud account, check if the parent folder is deleted
  if (account === 'iCloud') {
    parentDeleted = !(await checkFolderExistsInAppleNotes(readwiseDir, account))
    console.log('Parent folder deleted: ', parentDeleted)
  } else {
    // If user is syncing with non-iCloud account, check if the folder name is 'Notes'
    // If not, return an error
    if (account !== 'iCloud' && readwiseDir !== 'Notes') {
      console.log("Readwise Official plugin: folder name must be 'Notes' for non-iCloud accounts")
      await handleSyncError('Sync failed')
      return 'Sync failed'
    } else {
      // Check if non-iCloud accounts default to 'Notes' folder is empty or not this will be the replacement for parentDeleted
      parentDeleted = await checkIfFolderIsEmtpy(readwiseDir, account)
      console.log(`${account} parent folder deleted: `, parentDeleted)
    }
  }

  let url = `${baseURL}/api/obsidian/init?parentPageDeleted=${parentDeleted}`
  if (statusId) {
    url += `&statusId=${statusId}`
  }
  console.log('Readwise Official plugin: queueExport url: ', url)

  let response: Response | undefined
  let data: ExportRequestResponse | undefined

  const token = store.get('token')
  const uuid = getObsidianClientID()

  try {
    response = await fetch(url, {
      headers: {
        ...getAuthHeaders()
      }
    })
  } catch (e) {
    console.log('Readwise Official plugin: fetch failed in queueExport: ', e)
    await handleSyncError('Sync failed')
    return 'Sync failed'
  }

  if (response && response.ok) {
    data = await response.json()

    // check if data is defined
    if (!data) {
      console.log('Readwise Official plugin: no data in queueExport')
      await handleSyncError('Sync failed')
      return 'Sync failed'
    }

    const lastest_id = store.get('lastSavedStatusID')
    console.log(data.latest_id)
    if (data.latest_id <= lastest_id) {
      await handleSyncSuccess() // Data is already up to date
      console.log('Readwise data is already up to date')
      return 'Data is already up to date'
    }

    store.set('lastSavedStatusID', data.latest_id)
    console.log('Readwise Official plugin: saved currentSyncStatusID: ', data.latest_id)

    // save the sync status id so it can be polled until the archive is ready
    if (response.status === 201) {
      console.log('Syncing Readwise data')
      await getExportStatus(data.latest_id, token, uuid)
      console.log('Readwise Official plugin: queueExport done')
      return 'Sync completed'
    } else {
      await handleSyncSuccess('Synced', data.latest_id)
      console.log(
        'Latest Readwise sync already happended on your other device. Data should be up to date: ',
        response
      )
      return 'Data is already up to date'
    }
  } else {
    console.log('Readwise Official plugin: bad response in queueExport: ', response)
    await handleSyncError(getErrorMessageFromResponse(response))
    return 'Sync failed'
  }
}

export async function syncHighlights(bookIds?: Array<string>) {
  if (!store.get('token')) return 'Not connected to Readwise'

  const failedBooks = store.get('failedBooks')

  let targetBookIds = [...(bookIds || []), ...failedBooks]

  console.log('Readwise Official plugin: syncing highlights for books: ', targetBookIds)

  const booksToRefresh = store.get('booksToRefresh')
  const refreshBooks = store.get('refreshBooks')

  if (refreshBooks) {
    targetBookIds = [...targetBookIds, ...booksToRefresh]
  }

  if (!targetBookIds.length) {
    console.log('Readwise Official plugin: no targetBookIds, checking for new highlights')
    await queueExport()
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
          ...getAuthHeaders(),
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
      await queueExport()
      return 'Synced'
    } else {
      console.log(`Readwise Official plugin: saving book id ${bookIds} to refresh later`)
      const booksToRefresh = store.get('booksToRefresh')
      const deduplicatedBookIds = new Set([...booksToRefresh, ...bookIds])
      store.set('booksToRefresh', Array.from(deduplicatedBookIds))
      return 'Sync failed'
    }
  } catch (e) {
    console.log('Readwise Official plugin: fetch failed in syncBookHighlights: ', e)
    return 'Sync failed'
  }
}

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
    return ""
  }
  if (response && response.ok) {
    data = await response.json()
  } else {
    console.log('Readwise Official plugin: bad response in getUserAuthToken: ', response)
    return ""
  }

  if (!data) {
    console.log('Readwise Official plugin: no data in getUserAuthToken')
    return ""
  }

  if (data.userAccessToken) {
    console.log('Readwise Official plugin: successfully authenticated with Readwise')
    return data.userAccessToken
  } else {
    if (attempt > 20) {
      console.log('Readwise Official plugin: reached attempt limit in getUserAuthToken')
      return ""
    }
    console.log(
      `Readwise Official plugin: didn't get token data, retrying (attempt ${attempt + 1})`
    )
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return await getUserAuthToken(uuid, attempt + 1)
  }
}
