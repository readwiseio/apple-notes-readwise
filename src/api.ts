import { app, ipcMain } from "electron";
import Store from "electron-store";
import fs from "fs";
import path from "path";

interface ReadwisePluginSettings {
  token: string;

  /** Folder to save highlights */
  readwiseDir: string;

  /** Polling for pending export */
  isSyncing: boolean;

  /** Frequency of automatic sync */
  frequency: string;

  /** Automatically sync on load */
  triggerOnLoad: boolean;

  lastSyncFailed: boolean;
  lastSavedStatusID: number;
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
}

const DEFAULT_SETTINGS: ReadwisePluginSettings = {
  token: "",
  readwiseDir: "Readwise",
  frequency: "0",
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
};

export const store = new Store<ReadwisePluginSettings>({
  defaults: DEFAULT_SETTINGS,
});

const baseURL = "https://readwise.io";

interface ReadwiseAuthResponse {
  userAccessToken: string;
}

interface ExportRequestResponse {
  latest_id: number;
  status: string;
}

interface ExportStatusResponse {
  totalBooks: number;
  booksExported: number;
  isFinished: boolean;
  taskStatus: string;
}

function getAuthHeaders() {
  return {
    'AUTHORIZATION': `Token ${store.get("token")}`,
    "Obsidian-Client": `${getObsidianClientID()}`,
  };
}

async function saveZipFile(blob, fileName = "backup.zip") {
  try {
    // Convert the blob to an array buffer
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Set the path to the Downloads folder with the given filename
    const downloadsPath = path.join(app.getPath("downloads"), fileName);

    // Write the file
    fs.writeFileSync(downloadsPath, buffer);

    console.log(`ZIP file saved to: ${downloadsPath}`);
  } catch (error) {
    console.error("Error saving ZIP file: ", error);
  }
}

async function downloadExport(exportID: number): Promise<void> {
  // download archive from this endpoint
  let artifactURL = `${baseURL}/api/download_artifact/${exportID}`;
  // const lastSavedStatusID = store.get("lastSavedStatusID");
  // if (exportID <= lastSavedStatusID) {
  //   console.log(
  //     `Readwise Official plugin: Already saved data from export ${exportID}`
  //   );
  //   await handleSyncSuccess();
  //   return;
  // }

  let response, blob;
  try {
    response = await fetch(artifactURL, { headers: getAuthHeaders() });
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in downloadExport: ",
      e
    );
  }
  if (response && response.ok) {
    blob = await response.blob();
  } else {
    console.log(
      "Readwise Official plugin: bad response in downloadExport: ",
      response
    );
    return;
  }

  // save the zip file to the user's downloads folder before extracting the contents
  await saveZipFile(blob, `readwise-export-${exportID}.zip`);

  // const blobReader = new zip.BlobReader(blob);
  // const zipReader = new zip.ZipReader(blobReader);
  // const entries = await zipReader.getEntries();
  // // this.notice("Saving files...", false, 30);
  // console.log("Readwise Official plugin: Saving files...");
  // if (entries.length) {
  //   for (const entry of entries) {
  //     // will be derived from the entry's filename
  //     let bookID: string;

  //     /** Combo of file `readwiseDir`, book name, and book ID.
  //      * Example: `Readwise/Books/Name of Book--12345678.md` */
  //     const readwiseDir = store.get("readwiseDir");
  //     const processedFileName = normalizePath(entry.filename.replace(/^Readwise/, readwiseDir));

  //     // derive the original name `(readwiseDir + book name).md`
  //     let originalName = processedFileName;
  //     // extracting book ID from file name
  //     let split = processedFileName.split("--");
  //     if (split.length > 1) {
  //       originalName = split.slice(0, -1).join("--") + ".md";
  //       bookID = split.last().match(/\d+/g)[0];

  //       // track the book
  //       this.settings.booksIDsMap[originalName] = bookID;
  //     }

  //     try {
  //       const undefinedBook = !bookID || !processedFileName;
  //       const isReadwiseSyncFile = processedFileName === `${readwiseDir}/${READWISE_SYNC_FILENAME}.md`;
  //       if (undefinedBook && !isReadwiseSyncFile) {
  //         throw new Error(`Book ID or file name not found for entry: ${entry.filename}`);
  //       }
  //     } catch (e) {
  //       console.error(`Error while processing entry: ${entry.filename}`);
  //     }

  //     // save the entry in settings to ensure that it can be
  //     // retried later when deleted files are re-synced if
  //     // the user has `settings.refreshBooks` enabled
  //     if (bookID) await this.saveSettings();

  //     try {
  //       // ensure the directory exists
  //       let dirPath = processedFileName.replace(/\/*$/, '').replace(/^(.+)\/[^\/]*?$/, '$1');
  //       const exists = await this.fs.exists(dirPath);
  //       if (!exists) {
  //         await this.fs.mkdir(dirPath);
  //       }
  //       // write the actual files
  //       const contents = await entry.getData(new zip.TextWriter());
  //       let contentToSave = contents;

  //       if (await this.fs.exists(originalName)) {
  //         // if the file already exists we need to append content to existing one
  //         const existingContent = await this.fs.read(originalName);
  //         contentToSave = existingContent + contents;
  //       }
  //       await this.fs.write(originalName, contentToSave);
  //     } catch (e) {
  //       console.log(`Readwise Official plugin: error writing ${processedFileName}:`, e);
  //       this.notice(`Readwise: error while writing ${processedFileName}: ${e}`, true, 4, true);
  //       if (bookID) {
  //         // handles case where user doesn't have `settings.refreshBooks` enabled
  //         await this.addToFailedBooks(bookID);
  //         await this.saveSettings();
  //         return;
  //       }
  //       // communicate with readwise?
  //     }

  //     await this.removeBooksFromRefresh([bookID]);
  //     await this.removeBookFromFailedBooks([bookID]);
  //   }
  //   await this.saveSettings();
  // }
  // close the ZipReader
  // await zipReader.close();
  await acknowledgeSyncCompleted();
  await handleSyncSuccess("Synced", exportID);
  console.log("Readwise Official plugin: Synced!", exportID);
  // this.notice("Readwise sync completed", true, 1, true);
  console.log("Readwise Official plugin: completed sync");
  // if (this.app.isMobile) {
  //   this.notice("If you don't see all of your readwise files reload obsidian app", true,);
  // }
}

async function acknowledgeSyncCompleted() {
  let response;
  try {
    response = await fetch(
      `${baseURL}/api/obsidian/sync_ack`,
      {
        headers: { ...getAuthHeaders() , "Content-Type": "application/json" },
        method: "POST",
      }
    );
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in acknowledgeSyncCompleted: ",
      e
    );
  }
  if (response && response.ok) {
    return;
  } else {
    console.log(
      "Readwise Official plugin: bad response in acknowledgeSyncCompleted: ",
      response
    );
    await handleSyncError(getErrorMessageFromResponse(response));
    return;
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
        },
      }
    );

    if (response && response.ok) {
      const data: ExportStatusResponse = await response.json();

      const WAITING_STATUSES = ["PENDING", "RECEIVED", "STARTED", "RETRY"];
      const SUCCESS_STATUSES = ["SUCCESS"];

      if (WAITING_STATUSES.includes(data.taskStatus)) {
        if (data.booksExported) {
          const progressMsg = `Exporting Readwise data (${data.booksExported} / ${data.totalBooks}) ...`;
          console.log(progressMsg);
        } else {
          console.log("Building export...");
        }

        // wait 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // then keep polling
        await getExportStatus(statusID, token, uuid);
      } else if (SUCCESS_STATUSES.includes(data.taskStatus)) {
        await downloadExport(statusID);
      } else {
        console.log(
          "Readwise Official plugin: unknown status in getExportStatus: ",
          data
        );
        await handleSyncError("Sync failed");
        return;
      }
    } else {
      console.log(
        "Readwise Official plugin: bad response in getExportStatus: ",
        response
      );
      await handleSyncError(getErrorMessageFromResponse(response));
    }
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in getExportStatus: ",
      e
    );
    await handleSyncError("Sync failed");
  }
}

function getErrorMessageFromResponse(response: Response) {
  if (response && response.status === 409) {
    return "Sync in progress initiated by different client";
  }
  if (response && response.status === 417) {
    return "Obsidian export is locked. Wait for an hour.";
  }
  return `${response ? response.statusText : "Can't connect to server"}`;
}

async function handleSyncError(msg = "Sync failed") {
  await clearSettingsAfterRun();
  store.set("lastSyncFailed", true);
  console.log("Readwise Official plugin: ", msg);
}

async function clearSettingsAfterRun() {
  store.set("isSyncing", false);
  store.set("currentSyncStatusID", 0);
}

async function handleSyncSuccess(msg = "Synced", exportID: number = null) {
  await clearSettingsAfterRun();
  store.set("lastSyncFailed", false);
  if (exportID) {
    store.set("lastSavedStatusID", exportID);
  }
  console.log("Readwise Official plugin: ", msg);
}

async function queueExport(statusId?: number) {
  if (store.get("isSyncing")) {
    console.log("Readwise sync already in progress");
    return;
  }

  console.log("Readwise Official plugin: requesting archive...");
  store.set("isSyncing", true);

  const parentDeleted = true;

  let url = `${baseURL}/api/obsidian/init?parentPageDeleted=${parentDeleted}`;
  if (statusId) {
    url += `&statusId=${statusId}`;
  }

  let response, data: ExportRequestResponse;
  const token = store.get("token");
  const uuid = getObsidianClientID();
  try {
    response = await fetch(url, {
      headers: {
        ...getAuthHeaders(),
      },
    });
  } catch (e) {
    console.log("Readwise Official plugin: fetch failed in queueExport: ", e);
  }

  if (response && response.ok) {
    data = await response.json();

    const lastest_id = store.get("lastSavedStatusID");
    console.log(data.latest_id)
    if (data.latest_id <= lastest_id) {
      await handleSyncSuccess("Synced");
      console.log("Readwise data is already up to date");
      return;
    }

    store.set("lastSavedStatusID", data.latest_id);
    console.log(
      "Readwise Official plugin: saved currentSyncStatusID: ",
      data.latest_id
    );

    // save the sync status id so it can be polled until the archive is ready
    if (response.status === 201) {
      console.log("Syncing Readwise data");
      await getExportStatus(data.latest_id, token, uuid);
      console.log("Readwise Official plugin: queueExport done");
    } else {
      await handleSyncSuccess("Synced", data.latest_id);
      console.log(
        "Latest Readwise sync already happended on your other device. Data should be up to date: ",
        response
      );
      return;
    }
  } else {
    console.log(
      "Readwise Official plugin: bad response in queueExport: ",
      response
    );
    await handleSyncError(getErrorMessageFromResponse(response));
    return;
  }
}

export async function syncHighlights() {
  if (!store.get("token")) return;

  // Check if there's new highlights on the server
  await queueExport();
  return;
}

export function getObsidianClientID() {
  let obsidianClientId = store.get("rw-AppleNotesClientId");
  if (obsidianClientId) {
    return obsidianClientId;
  } else {
    obsidianClientId = Math.random().toString(36).substring(2, 15);
    store.set("rw-AppleNotesClientId", obsidianClientId);
    return obsidianClientId;
  }
}

export async function getUserAuthToken(uuid: string, attempt = 0) {
  let response, data: ReadwiseAuthResponse;
  try {
    response = await fetch(`${baseURL}/api/auth?token=${uuid}`);
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in getUserAuthToken: ",
      e
    );
  }
  if (response && response.ok) {
    data = await response.json();
  } else {
    console.log(
      "Readwise Official plugin: bad response in getUserAuthToken: ",
      response
    );
    return;
  }
  if (data.userAccessToken) {
    console.log(
      "Readwise Official plugin: successfully authenticated with Readwise"
    );
    store.set("token", data.userAccessToken);
  } else {
    if (attempt > 20) {
      console.log(
        "Readwise Official plugin: reached attempt limit in getUserAuthToken"
      );
      return;
    }
    console.log(
      `Readwise Official plugin: didn't get token data, retrying (attempt ${
        attempt + 1
      })`
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await getUserAuthToken(uuid, attempt + 1);
  }
  return true;
}
