import Store from "electron-store";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as zip from "@zip.js/zip.js";
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt();

const execFileAsync = promisify(execFile);
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

// async function saveZipFile(blob, fileName = "backup.zip") {
//   try {
//     // Convert the blob to an array buffer
//     const arrayBuffer = await blob.arrayBuffer();
//     const buffer = Buffer.from(arrayBuffer);

//     // Set the path to the Downloads folder with the given filename
//     const downloadsPath = path.join(app.getPath("downloads"), fileName);

//     // Write the file
//     fs.writeFileSync(downloadsPath, buffer);

//     console.log(`ZIP file saved to: ${downloadsPath}`);
//   } catch (error) {
//     console.error("Error saving ZIP file: ", error);
//   }
// }

async function runAppleScript(script: string, { humanReadableOutput = true } = {}): Promise<string> {

  const outputArguments = humanReadableOutput ? [] : ["-ss"];

  const { stdout } = await execFileAsync("osascript", ["-e", script, ...outputArguments]);
  return stdout.trim();
}

function _escape_for_applescript(text: string | number | null | undefined) {
  if (!text && text !== 0) return '' // Handle undefined, null, or empty cases
  return text
    .toString()
    .replace(/\\/g, '\\\\') // Escape backslashes
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\n/g, '\\n') // Escape newlines
}

const executeAppleScript = async (script: string): Promise<string> => {
  try {
    const result = await runAppleScript(script)
    return result
  } catch (error) {
    console.error("Error executing AppleScript:", error)
    throw error
  }
}

function buildAppleScripts(content: string, title: string, folder: string) {
  
  const appleScript = `
        tell application "Notes"
          set noteTitle to "${title}"
          set noteBody to "${content}"
          set folderName to "${folder}"
          set theFolder to missing value
          repeat with eachFolder in folders
            if name of eachFolder is folderName then
              set theFolder to eachFolder
              exit repeat
            end if
          end repeat
          if theFolder is missing value then
            set theFolder to (make new folder with properties {name:folderName})
          end if
          make new note at theFolder with properties {name: noteTitle, body: noteBody}
        end tell
      `

  console.log('[MAIN]: AppleScript:', appleScript)

  return appleScript
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

  const zipReader = new zip.ZipReader(new zip.BlobReader(blob));

  const entries = await zipReader.getEntries();

  const notesFolder = store.get("readwiseDir");

  // Output entry names
  for (const entry of entries) {
    console.log(`Found entry: ${entry.filename}`);

    // Readwise/Books/Introduction-to-Algorithms--44011615.md
    // extract the filename and book id
    // 44011615
    const originalFileName = entry.filename;
    const originalName = originalFileName.split('--')[0].split('/')[2];
    const bookId = originalFileName.split('--')[1].split('.')[0];
    console.log(`Original name: ${originalName}`);
    console.log(`Book ID: ${bookId}`);

    // Read the contents of the file and convert it to html
    const content = await entry.getData(new zip.TextWriter());

    const html = md.render(content);
    
    // clean the html for AppleScript
    const cleanedHtml = _escape_for_applescript(html);

    // build the AppleScript
    const script = buildAppleScripts(cleanedHtml, originalName, notesFolder);

    // execute the AppleScript
    const result = await executeAppleScript(script);

    console.log(result);
  }

  // Close the reader
  await zipReader.close();
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
