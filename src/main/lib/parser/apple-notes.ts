// @ts-nocheck
import { BrowserWindow, dialog } from 'electron'
import Store from 'electron-store'
import protobufjs from 'protobufjs'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { promises as fsPromises } from 'fs'
import { descriptor } from '@shared/descriptor'
import zlib from 'node:zlib'
import { NOTE_FOLDER_PATH, NOTE_DB } from '@shared/constants'
import {
  Note,
  ANNoteData,
  NoteAccount,
  NoteFolder,
  ANAttachment,
  ANAccount,
  SQLiteTagSpawned
} from '@shared/models'
import type { ReadwisePluginSettings } from '../../../shared/types'
import { NoteConverter } from './convert-note'
// @ts-ignore
import SQLiteTag from './sqlite/index.js'

const { Root } = protobufjs

// source: https://github.com/obsidianmd/obsidian-importer/blob/577036ad55fe79c92eeee6f961f8073da26622f5/src/filesystem.ts#L228
export function splitext(name: string) {
  let dotIndex = name.lastIndexOf('.')
  let basename = name
  let extension = ''

  if (dotIndex > 0) {
    basename = name.substring(0, dotIndex)
    extension = name.substring(dotIndex + 1).toLowerCase()
  }

  return [basename, extension]
}

// Source: https://github.com/obsidianmd/obsidian-importer/blob/577036ad55fe79c92eeee6f961f8073da26622f5/src/formats/apple-notes.ts#L18
export class AppleNotesExtractor {
  window: BrowserWindow
  store: Store<ReadwisePluginSettings>

  database: SQLiteTagSpawned | null = null
  protobufRoot: Root

  keys: Record<string, number> = {}
  owners: Record<number, number> = {}

  accountID = 0
  account: ANAccount = { name: '', uuid: '', path: '' }
  folder: NoteFolder = { z_pk: 0, ztitle: '' }

  noteCount = 0
  parsedNotes = 0
  omitFirstLine = false
  isICAccount = true // Assume it's an iCloud account by default, until proven otherwise

  constructor(
    mainWindow: BrowserWindow,
    omitFirstLine = false,
    store: Store<ReadwisePluginSettings>
  ) {
    this.protobufRoot = Root.fromJSON(descriptor)
    this.window = mainWindow
    this.omitFirstLine = omitFirstLine
    this.store = store
  }

  async init(folder: string, account: string): Promise<void> {
    console.log('MAIN: Initializing Apple Notes Extractor...')
    console.log(`MAIN: Getting notes database from ${folder}...`)
    this.database = (await this.getNotesDatabase()) as SQLiteTagSpawned
    if (!this.database) return
    console.log('MAIN: Database loaded...')

    console.log('MAIN: Getting primary keys...')
    this.keys = Object.fromEntries(
      (await this.database.all`SELECT z_ent, z_name FROM z_primarykey`).map((k) => [
        k.Z_NAME,
        k.Z_ENT
      ])
    )

    console.log('MAIN: Getting note account...')
    const noteAccount = await this.database.all`
      SELECT Z_PK as z_pk FROM ziccloudsyncingobject WHERE z_ent = ${this.keys.ICAccount}`
    console.log('MAIN: noteAccount: ', noteAccount)

    console.log('MAIN: Getting note folder...')
    this.folder = (
      await this.database.all`
        SELECT Z_PK as z_pk, ZTITLE2 as ztitle2 
        FROM ziccloudsyncingobject 
        WHERE z_ent = ${this.keys.ICFolder} 
        AND ztitle2 = ${folder} 
        AND zmarkedfordeletion = 0
      `
    )[0] // zmarkedfordeletion = 0 is to exclude deleted folders
    console.log('MAIN: Folder: ', this.folder)
    await this.resolveAccount(noteAccount[0].z_pk)

    // determine the account we are working with
    this.isICAccount = await this.resolveAccountType(account)
  }

  async getAccountType(): boolean {
    return this.isICAccount
  }

  async getNotesDatabase(): Promise<SQLiteTagSpawned | null> {
    console.log('MAIN: Getting notes database...')
    const dataPath = path.join(os.homedir(), NOTE_FOLDER_PATH)

    // confirm we still have access to this folder path
    fs.access(dataPath, fs.constants.R_OK, (err) => {
      if (err) {
        console.log('MAIN: Failed to access Apple Notes data path...')
        console.log('MAIN: Asking for permission for Apple Notes folder...')
        this.store.set('hasAppleNotesFileSystemPermission', false)
        return null
      }
      console.log('MAIN: Apple Notes data path found...')
    })

    const hasPermission = this.store.get('hasAppleNotesFileSystemPermission')
    if (hasPermission) {
      console.log('MAIN: Already have permission for Apple Notes folder...')
    } else {
      this.window.webContents.send('toast:show', {
        variant: 'default',
        message: 'Asking for permission for Apple Notes folder.'
      })
      console.log('MAIN: Asking for permission for Apple Notes folder...')  
      const names = dialog.showOpenDialogSync({
        defaultPath: dataPath,
        properties: ['openDirectory'],
        //see https://developer.apple.com/videos/play/wwdc2019/701/
        message:
          'Select the "group.com.apple.notes" folder to allow Readwise to read Apple Notes data.'
      })
      if (!names?.includes(dataPath)) {
        this.window.webContents.send('toast:show', {
          variant: 'destructive',
          message: 'Did not obtain permission for the correct folder :('
        })
        return null
      }
      this.window.webContents.send('toast:show', {
        variant: 'default',
        message: 'Got permission, writing to Apple Notes.'
      })
      console.log('MAIN: Got permission for Apple Notes folder...')
      this.store.set('hasAppleNotesFileSystemPermission', true)
      console.log('MAIN: Permission set for Apple Notes folder...')
    }

    if (!fs.existsSync(dataPath)) {
      console.error('MAIN: Apple Notes data path not found...')
      return null
    }

    const originalDB = path.join(dataPath, NOTE_DB)
    const cloneDB = path.join(os.tmpdir(), NOTE_DB)

    // copy the database to a temporary location
    await fsPromises.copyFile(originalDB, cloneDB)
    await fsPromises.copyFile(originalDB + '-shm', cloneDB + '-shm')
    await fsPromises.copyFile(originalDB + '-wal', cloneDB + '-wal')

    return new SQLiteTag(cloneDB, { readonly: true, persistent: true })
  }

  close() {
    console.log('MAIN: Closing Apple Notes Extractor...')
    if (this.database) {
      this.database.close()
      console.log('MAIN: Database closed...')
    }
  }

  async extractNoteHTML(note_pk: string): Promise<string | void> {
    if (!this.database) {
      console.error('MAIN: Database not found...')
      return
    }
    console.log('MAIN: Note Primary Key: ', note_pk)

    const notes = await this.database.get`
    SELECT
          Z_PK as z_pk, ZFOLDER as zfolder, ZTITLE1 as ztitle1 FROM ziccloudsyncingobject
        WHERE
          z_ent = ${this.keys.ICNote}
          AND z_pk = ${note_pk}
          AND ztitle1 IS NOT NULL
          AND zfolder = ${this.folder.z_pk}
          AND zfolder NOT IN (1)
    `
    console.log('MAIN: Extracting note: ', notes)

    // decode the protobuf
    const html = await this.resolveNote(notes.z_pk)
    console.log('HTML: ', html)

    return html
  }

  async resolveNote(id: number): Promise<string | void> {
    if (!this.database) {
      console.error('Database not found...')
      return
    }
    console.log('Resolving note ID: ', id)
    const row = (await this.database.get`SELECT
            nd.z_pk, hex(nd.zdata) as zhexdata, zcso.ztitle1 as ztitle1, zfolder as zfolder,
            zcreationdate1 as zcreationdate1, zcreationdate2 as zcreationdate2, zcreationdate3 as zcreationdate3, 
            zmodificationdate1 as zmodificationdate1 
        FROM
            zicnotedata AS nd,
            (SELECT
                *, NULL AS zcreationdate3, NULL AS zcreationdate2,
                NULL AS zispasswordprotected FROM ziccloudsyncingobject
            ) AS zcso
        WHERE
            zcso.z_pk = nd.znote
            AND zcso.z_pk = ${id}`) as ANNoteData

    if (!row) {
      console.error('Note not found: ', id)
      return
    }

    // Write the html to a file for debugging purposes... for now
    const title = `${row.ztitle1}.html`
    const file = path.join(os.homedir(), 'Documents', 'Readwise', title)
    console.log(`Resolving note: ${title}`)

    // Decode the protobuf into HTML
    const converter = this.decodeData(row.zhexdata, NoteConverter)
    console.log('Successfully decoded note data...')
    const html = await converter.format()
    console.log('Successfully formatted note data to html...')
    console.log('MAIN: Final HTML: ', html)

    // Write the file
    fs.writeFileSync(file, html, 'utf8')
    return html
  }

  async resolveAccountType(name: string): Promise<boolean> {
    if (!this.database) {
      console.error('Database not found...')
      return
    }
    console.log('MAIN: checking account type for', name)
    const account = await this.database.get`
      SELECT ZNAME as zname, ZIDENTIFIER as zidentifier FROM ziccloudsyncingobject
      WHERE z_ent = ${this.keys.ICAccount} AND zname = ${name}
    `
    console.log('Account: ', account ? account.zname : 'Non-iCloud Account')
    return true ? account !== undefined : false
  }

  async resolveAccount(id: number): Promise<void> {
    if (!this.database) {
      console.error('Database not found...')
      return
    }
    console.log('Resolving account ID: ', id)
    const account = await this.database.get`
			SELECT ZNAME as zname, ZIDENTIFIER as zidentifier FROM ziccloudsyncingobject
			WHERE z_ent = ${this.keys.ICAccount} AND z_pk = ${id}
		`

    this.account = {
      name: account.zname,
      uuid: account.zidentifier,
      path: path.join(os.homedir(), NOTE_FOLDER_PATH, 'Accounts', account.zidentifier)
    }
    console.log('Account: ', this.account)
  }

  decodeData(hexdata: string, converterType: any) {
    // TODO: Implement the converterType
    console.log('Decoding note data...')
    const unzipped = zlib.gunzipSync(Buffer.from(hexdata, 'hex'))
    const decoded = this.protobufRoot.lookupType('ciofecaforensics.Document').decode(unzipped)
    return new converterType(this, decoded, this.useHTMLformat)
  }

  async resolveAttachment(id: number, uti: ANAttachment | string): Promise<any | null> {
    if (!this.database) {
      console.error('Database not found...')
      return null
    }

    console.log('Resolving attachment ID: ', id)
    let sourcePath, outName, outExt, row, file

    switch (uti) {
      case ANAttachment.ModifiedScan:
        // A PDF only seems to be generated when you modify the scan :(
        console.log('Modified Scan')
        row = await this.database.get`
  				SELECT
  					zidentifier, zfallbackpdfgeneration, zcreationdate, zmodificationdate, znote
  				FROM
  					(SELECT *, NULL AS zfallbackpdfgeneration FROM ziccloudsyncingobject)
  				WHERE
  					z_ent = ${this.keys.ICAttachment}
  					AND z_pk = ${id}
  			`

        sourcePath = path.join(
          'FallbackPDFs',
          row.ZIDENTIFIER,
          row.ZFALLBACKPDFGENERATION || '',
          'FallbackPDF.pdf'
        )
        outName = 'Scan'
        outExt = 'pdf'
        break

      case ANAttachment.Scan:
        console.log('Scan')
        row = await this.database.get`
  				SELECT
  					zidentifier, zsizeheight, zsizewidth, zcreationdate, zmodificationdate, znote
  				FROM ziccloudsyncingobject
  				WHERE
  					z_ent = ${this.keys.ICAttachment}
  					AND z_pk = ${id}
  			`

        sourcePath = path.join(
          'Previews',
          `${row.ZIDENTIFIER}-1-${row.ZSIZEWIDTH}x${row.ZSIZEHEIGHT}-0.jpeg`
        )
        outName = 'Scan Page'
        outExt = 'jpg'
        break

      case ANAttachment.Drawing:
        console.log('Drawing')
        row = await this.database.get`
  				SELECT
  					zidentifier, zfallbackimagegeneration, zcreationdate, zmodificationdate,
  					znote, zhandwritingsummary
  				FROM
  					(SELECT *, NULL AS zfallbackimagegeneration FROM ziccloudsyncingobject)
  				WHERE
  					z_ent = ${this.keys.ICAttachment}
  					AND z_pk = ${id}
  			`

        if (row.ZFALLBACKIMAGEGENERATION) {
          // macOS 14/iOS 17 and above
          sourcePath = path.join(
            'FallbackImages',
            row.ZIDENTIFIER,
            row.ZFALLBACKIMAGEGENERATION,
            'FallbackImage.png'
          )
        } else {
          sourcePath = path.join('FallbackImages', `${row.ZIDENTIFIER}.jpg`)
        }

        outName = 'Drawing'
        outExt = 'png'
        break

      default:
        console.log('Default')
        row = await this.database.get`
  				SELECT
  					a.zidentifier, a.zfilename,
  					a.zgeneration1, b.zcreationdate, b.zmodificationdate, b.znote
  				FROM
  					(SELECT *, NULL AS zgeneration1 FROM ziccloudsyncingobject) AS a,
  					ziccloudsyncingobject AS b
  				WHERE
  					a.z_ent = ${this.keys.ICMedia}
  					AND a.z_pk = ${id}
  					AND a.z_pk = b.zmedia
  			`

        sourcePath = path.join('Media', row.ZIDENTIFIER, row.ZGENERATION1 || '', row.ZFILENAME)
        ;[outName, outExt] = splitext(row.ZFILENAME)
        break
    }

    // the path to the original attachment file
    const attachmentFilePath = path.join(this.account.path, sourcePath)
    console.log('File: ', attachmentFilePath)
    return attachmentFilePath
  }

  async getAttachmentSource(account: ANAccount, sourcePath: string): Promise<Buffer> {
    try {
      return await fsPromises.readFile(path.join(account.path, sourcePath))
    } catch (e) {
      return await fsPromises.readFile(path.join(os.homedir(), NOTE_FOLDER_PATH, sourcePath))
    }
  }
}
