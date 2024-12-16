import { Root } from 'protobufjs'
import Database from 'better-sqlite3'
import { BrowserWindow } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import { descriptor } from '@shared/descriptor'
import zlib from 'node:zlib'
import { NOTE_FOLDER_PATH, NOTE_DB } from '@shared/constants'
import {
  PrimaryKeyRow,
  Note,
  ANNoteData,
  NoteAccount,
  NoteFolder,
  ANAttachment,
  ANAccount
} from '@shared/models'
import { NoteConverter } from './convert-note'

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
  database: any
  protobufRoot: Root
  window: BrowserWindow

  keys: Record<string, number> = {}
  owners: Record<number, number> = {}
  resolvedAccounts: Record<number, ANAccount> = {}

  multiAccount = false
  noteCount = 0
  parsedNotes = 0

  omitFirstLine = false

  constructor(window: BrowserWindow, omitFirstLine = false) {
    this.protobufRoot = Root.fromJSON(descriptor)
    this.window = window
    this.omitFirstLine = omitFirstLine
  }

  async getNotesDatabase(): Promise<any> {
    const dataPath = path.join(os.homedir(), NOTE_FOLDER_PATH)

    const originalDB = path.join(dataPath, NOTE_DB)
    const cloneDB = path.join(os.tmpdir(), NOTE_DB)

    // copy the database to a temporary location
    await fsPromises.copyFile(originalDB, cloneDB)
    await fsPromises.copyFile(originalDB + '-shm', cloneDB + '-shm')
    await fsPromises.copyFile(originalDB + '-wal', cloneDB + '-wal')

    return new Database(cloneDB, { readonly: true })
  }

  async resolveNote(id: number): Promise<string | void> {
    const row = this.database
      .prepare(
        `SELECT
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
            AND zcso.z_pk = ${id}`
      )
      .get() as ANNoteData

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
    const html = await converter.format()
    console.log('HTML: ', html)

    // Write the file
    fs.writeFileSync(file, html, 'utf8')
    return html
  }

  async resolveAccount(id: number): Promise<void> {
    if (!this.multiAccount && Object.keys(this.resolvedAccounts).length) {
      this.multiAccount = true
    }

    const account = await this.database
      .prepare(
        `
			SELECT ZNAME as zname, ZIDENTIFIER as zidentifier FROM ziccloudsyncingobject
			WHERE z_ent = ${this.keys.ICAccount} AND z_pk = ${id}
		`
      )
      .get()

    this.resolvedAccounts[id] = {
      name: account.zname,
      uuid: account.zidentifier,
      path: path.join(os.homedir(), NOTE_FOLDER_PATH, 'Accounts', account.zidentifier)
    }

    console.log('Resolved Account: ', this.resolvedAccounts[id])
  }

  async extractNoteHTML(name: string, folder: string): Promise<string | void> {
    if (this.database === undefined) {
      this.database = await this.getNotesDatabase()
    }

    // Get the primary keys
    const rows = this.database
      .prepare('SELECT Z_ENT as z_ent, Z_NAME as z_name FROM z_primarykey')
      .all() as PrimaryKeyRow[]
    this.keys = Object.fromEntries(rows.map((r) => [r.z_name, r.z_ent]))

    const noteAccounts = this.database
      .prepare(
        `SELECT Z_PK as z_pk FROM ziccloudsyncingobject WHERE z_ent = ${this.keys.ICAccount}`
      )
      .all() as NoteAccount[]

    const noteFolders = this.database
      .prepare(
        `SELECT Z_PK as z_pk, ZTITLE2 as ztitle2 FROM ziccloudsyncingobject WHERE z_ent = ${this.keys.ICFolder} AND ztitle2 = '${folder}'`
      )
      .all() as NoteFolder[]

    console.log('Keys: ', this.keys)
    console.log('Note Accounts: ', noteAccounts)
    console.log('Note Folders: ', noteFolders)

    // Resolve the account
    for (let a of noteAccounts) await this.resolveAccount(a.z_pk)
    this.owners[noteFolders[0].z_pk] = noteAccounts[0].z_pk

    const notes = this.database
      .prepare(
        `SELECT
          Z_PK as z_pk, ZFOLDER as zfolder, ZTITLE1 as ztitle1 FROM ziccloudsyncingobject
        WHERE
          z_ent = ${this.keys.ICNote}
          AND ztitle1 = '${name}'
          AND ztitle1 IS NOT NULL
          AND zfolder = ${noteFolders[0].z_pk}
          AND zfolder NOT IN (1)`
      )
      .all() as Note[]

    console.log('Notes: ', notes.length)
    console.log('Notes: ', notes)
    console.log('Note ID: ', notes[0].z_pk)

    // decode the protobuf
    const html = await this.resolveNote(notes[0].z_pk)
    console.log('HTML: ', html)

    this.database.close()

    return html
  }

  decodeData(hexdata: string, converterType: any) {
    // TODO: Implement the converterType
    const unzipped = zlib.gunzipSync(Buffer.from(hexdata, 'hex'))
    const decoded = this.protobufRoot.lookupType('ciofecaforensics.Document').decode(unzipped)
    return new converterType(this, decoded, true)
  }

  async resolveAttachment(id: number, uti: ANAttachment | string): Promise<any | null> {
    let sourcePath, outName, outExt, row, file

    switch (uti) {
      case ANAttachment.ModifiedScan:
        // A PDF only seems to be generated when you modify the scan :(
        row = await this.database
          .prepare(
            `
  				SELECT
  					zidentifier, zfallbackpdfgeneration, zcreationdate, zmodificationdate, znote
  				FROM
  					(SELECT *, NULL AS zfallbackpdfgeneration FROM ziccloudsyncingobject)
  				WHERE
  					z_ent = ${this.keys.ICAttachment}
  					AND z_pk = ${id}
  			`
          )
          .get()

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
        row = await this.database
          .prepare(
            `
  				SELECT
  					zidentifier, zsizeheight, zsizewidth, zcreationdate, zmodificationdate, znote
  				FROM ziccloudsyncingobject
  				WHERE
  					z_ent = ${this.keys.ICAttachment}
  					AND z_pk = ${id}
  			`
          )
          .get()

        sourcePath = path.join(
          'Previews',
          `${row.ZIDENTIFIER}-1-${row.ZSIZEWIDTH}x${row.ZSIZEHEIGHT}-0.jpeg`
        )
        outName = 'Scan Page'
        outExt = 'jpg'
        break

      case ANAttachment.Drawing:
        row = await this.database
          .prepare(
            `
  				SELECT
  					zidentifier, zfallbackimagegeneration, zcreationdate, zmodificationdate,
  					znote, zhandwritingsummary
  				FROM
  					(SELECT *, NULL AS zfallbackimagegeneration FROM ziccloudsyncingobject)
  				WHERE
  					z_ent = ${this.keys.ICAttachment}
  					AND z_pk = ${id}
  			`
          )
          .get()

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
        row = await this.database
          .prepare(
            `
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
          )
          .get()

        sourcePath = path.join('Media', row.ZIDENTIFIER, row.ZGENERATION1 || '', row.ZFILENAME)
        ;[outName, outExt] = splitext(row.ZFILENAME)
        break
    }

    console.log('Source Path: ', sourcePath)
    console.log('Out Name: ', outName)
    console.log('Out Ext: ', outExt)
    console.log('Row: ', row)

    console.log('Account: ', this.resolvedAccounts[2])

    try {
      const binary = await this.getAttachmentSource(this.resolvedAccounts[2], sourcePath)
      const attachmentPath = path.join(os.homedir(), 'Documents', 'Readwise', 'Attachments')

      if (!fs.existsSync(attachmentPath)) {
        fs.mkdirSync(attachmentPath, { recursive: true })
      }

      // file = await this.vault.createBinary(
      // 	attachmentPath, binary,
      // 	{ ctime: this.decodeTime(row.ZCREATIONDATE), mtime: this.decodeTime(row.ZMODIFICATIONDATE) }
      // );
      // create a binary file
      fs.writeFileSync(path.join(attachmentPath, `${outName}.${outExt}`), binary, 'utf8')
    } catch (e) {
      // this.ctx.reportFailed(sourcePath);
      console.error(e)
      return null
    }

    // this.resolvedFiles[id] = file;
    // this.ctx.reportAttachmentSuccess(this.resolvedFiles[id].path);

    // the path to the original attachment file
    const attachmentFilePath = path.join(this.resolvedAccounts[2].path, sourcePath)
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
