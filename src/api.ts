import Store from "electron-store";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as zip from "@zip.js/zip.js";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt();

const execFileAsync = promisify(execFile);
interface ReadwisePluginSettings {
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

  /** The account within Apple Notes to export to... */
  account: string;
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
  account: "iCloud",
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
    AUTHORIZATION: `Token ${store.get("token")}`,
    "Obsidian-Client": `${getObsidianClientID()}`,
  };
}

async function runAppleScript(
  script: string,
  { humanReadableOutput = true } = {},
): Promise<string> {
  const outputArguments = humanReadableOutput ? [] : ["-ss"];

  const { stdout } = await execFileAsync("osascript", [
    "-e",
    script,
    ...outputArguments,
  ]);

  return stdout.trim();
}

function _escape_for_applescript(text: string | number | null | undefined) {
  if (!text && text !== 0) return ""; // Handle undefined, null, or empty cases
  return text
    .toString()
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\n/g, "\\n"); // Escape newlines
}

const executeAppleScript = async (script: string): Promise<string> => {
  try {
    const result = await runAppleScript(script);
    return result;
  } catch (error) {
    console.error("Error executing AppleScript:", error);
    throw error;
  }
};

async function checkIfNoteExist(
  title: string,
  folder: string,
  account: string,
): Promise<boolean> {
  const script = `
    tell application "Notes"
    set noteExist to false
      try
          set theAccount to account "${account}" -- specify your account name here
          set theFolder to folder "${folder}" of theAccount -- specify your folder name here
          set theNote to the first note in theFolder whose name is "${title}"
          set noteExist to true
      on error
          set noteExist to false
      end try
    end tell
    return noteExist
  `;

  const result = await executeAppleScript(script);
  return result === "true";
}

export async function getAppleNotesAccounts(): Promise<string[]> {
  const script = `
  tell application "Notes"
    set accountNames to {}
    
    -- Loop through each account and collect names
    repeat with anAccount in accounts
        set end of accountNames to name of anAccount
    end repeat
    
    -- Return the list of account names
    return accountNames
  end tell
  `;

  const result = await executeAppleScript(script);
  return result.split(", ");
}

const checkFolderExistsInAppleNotes = async (
  folder: string,
  account: string,
): Promise<boolean> => {
  const script = `
    tell application "Notes"
      set folderName to "${folder}"
      set accountName to "${account}"
      
      try
          set targetFolder to folder folderName of account accountName
          return true -- Folder exists
      on error
          return false -- Folder does not exist
      end try
    end tell
  `;

  const result = await executeAppleScript(script);
  return result === "true";
};

const checkIfFolderIsEmtpy = async (
  folder: string,
  account: string,
): Promise<boolean> => {
  const script = `
    tell application "Notes"
      set folderName to "${folder}"
      set accountName to "${account}"
      try
          set targetFolder to folder folderName of account accountName
          if (count of notes of targetFolder) is 0 then
              return true -- Folder is empty
          else
              return false -- Folder is not empty
          end if
      on error
          return false -- Folder does not exist
      end try
    end tell
  `;

  const result = await executeAppleScript(script);
  return result === "true";
};

function appendContentToExistingNote(
  content: string,
  title: string,
  folder: string,
  account: string,
) {
  const script = `
    tell application "Notes"
    set noteCreated to false
    try
      set theAccount to account "${account}" -- specify your account name here
      set theFolder to folder "${folder}" of theAccount -- specify your folder name here
      set theNote to the first note in theFolder whose name is "${title}"
      set currentContent to the body of theNote -- retrieve existing content
      set newContent to currentContent & "<div><br></div>" & "${content}" -- modify appended text here
      set body of theNote to newContent
      set noteCreated to true
    on error
      set noteCreated to false
    end try
  end tell
  return noteCreated
    `;

  return script;
}

function createNewNote(
  content: string,
  title: string,
  folder: string,
  account: string,
) {
  const appleScript = `
      tell application "Notes"
        set desiredAccountName to "${account}" -- Specify the account name
        set folderName to "${folder}" -- Use JavaScript string here
        set noteTitle to "${title}" -- Use JavaScript string here
        set noteBody to "${content}" -- Use JavaScript string here

        set folderExists to false

        -- Check if the specified folder exists in the desired account
        repeat with eachFolder in folders of account desiredAccountName
            if name of eachFolder is folderName then
                set folderExists to true
                exit repeat
            end if
        end repeat

        -- If the folder does not exist, create it
        if not folderExists then
            make new folder with properties {name:folderName} at account desiredAccountName
            log "Folder '" & folderName & "' created in " & desiredAccountName & " account."
        else
            log "Folder '" & folderName & "' already exists in " & desiredAccountName & " account."
        end if

        -- Create a new note in the specified folder of the desired account
        if folderExists or (count of folders of account desiredAccountName) > 0 then
            set newNote to make new note at folder folderName of account desiredAccountName with properties {name:noteTitle, body:noteBody}
            log "Note '" & noteTitle & "' created in folder '" & folderName & "' of " & desiredAccountName & " account."
        else
            log "No folders found in the specified account."
        end if
      end tell
      `;

  return appleScript;
}

async function downloadExport(exportID: number): Promise<void> {
  // download archive from this endpoint
  const artifactURL = `${baseURL}/api/download_artifact/${exportID}`;
  // TODO: not sure when this applies... seems to stop all syncing.
  // const lastSavedStatusID = store.get("lastSavedStatusID");
  // if (exportID <= lastSavedStatusID) {
  //   console.log(
  //     `Readwise Official plugin: Already saved data from export ${exportID}`
  //   );
  //   await handleSyncSuccess("Synced");
  //   return;
  // }

  let response, blob;
  try {
    response = await fetch(artifactURL, { headers: getAuthHeaders() });
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in downloadExport: ",
      e,
    );
  }
  if (response && response.ok) {
    blob = await response.blob();
  } else {
    console.log(
      "Readwise Official plugin: bad response in downloadExport: ",
      response,
    );
    return;
  }

  const zipReader = new zip.ZipReader(new zip.BlobReader(blob));

  const entries = await zipReader.getEntries();

  const notesFolder = store.get("readwiseDir");
  const account = store.get("account");

  const bookIdsMap = store.get("booksIDsMap");

  if (entries.length) {
    // Output entry names
    for (const entry of entries) {
      console.log(`Found entry: ${entry.filename}`);

      // Readwise/Books/Introduction-to-Algorithms--44011615.md
      // extract the filename and book id
      // 44011615
      const originalFileName = entry.filename;
      const originalName = originalFileName.split("--")[0].split("/")[2];
      const bookId = originalFileName.split("--")[1].split(".")[0];
      console.log(`Original name: ${originalName}`);
      console.log(`Book ID: ${bookId}`);

      // track the book
      bookIdsMap[originalName] = bookIdsMap;

      try {
        // Read the contents of the file
        const content = await entry.getData(new zip.TextWriter());

        // convert the markdown to html
        const contentToSaveHTML = md.render(content);

        // clean the html for AppleScript
        const contentToSave = _escape_for_applescript(contentToSaveHTML);

        // create the script to save the note
        let script = "";
        // check if the note already exists
        if (await checkIfNoteExist(originalName, notesFolder, account)) {
          console.log("Note already exists, appending content");
          script = appendContentToExistingNote(
            contentToSave,
            originalName,
            notesFolder,
            account,
          );
        } else { // create a new note
          console.log("Note doesn't exist, creating new note");
          script = createNewNote(
            contentToSave,
            originalName,
            notesFolder,
            account,
          );
        }

        // run the script
        if (script) {
          // export the note to Apple Notes
          try {
            const result = await executeAppleScript(script);
            console.log(result);
          } catch (e) {
            console.log("Readwise Official plugin: error running script: ", e);
            const failedBooks = store.get("failedBooks");
            const deduplicatedFailedBooks = new Set([...failedBooks, bookId]);
            store.set("failedBooks", Array.from(deduplicatedFailedBooks));
          }
        } else { // failed to create script for note creation or appending content to existing note
          console.log("Readwise Official plugin: no script to run");
          const failedBooks = store.get("failedBooks");
          const deduplicatedFailedBooks = new Set([...failedBooks, bookId]);
          store.set("failedBooks", Array.from(deduplicatedFailedBooks));
        }
      } catch (e) {
        console.log("Readwise Official plugin: error reading file: ", e);
        if (bookId) {
          const failedBooks = store.get("failedBooks");
          const deduplicatedFailedBooks = new Set([...failedBooks, bookId]);
          store.set("failedBooks", Array.from(deduplicatedFailedBooks));
        }
      }
      await removeBooksFromRefresh([bookId]);
      await removeBookFromFailedBooks([bookId]);
    }
  }

  // Close the reader
  await zipReader.close();
  await acknowledgeSyncCompleted();
  await handleSyncSuccess("Synced", exportID);
  console.log("Readwise Official plugin: Synced!", exportID);
  console.log("Readwise Official plugin: completed sync");
}

async function removeBooksFromRefresh(bookIds: Array<string>) {
  if (!bookIds.length) return;

  console.log(
    `Readwise Official plugin: removing books ids ${
      bookIds.join(", ")
    } from refresh list`,
  );

  const booksToRefresh = store.get("booksToRefresh");
  const deduplicatedBooksToRefresh = booksToRefresh.filter(
    (bookId: string) => !bookIds.includes(bookId),
  );
  store.set("booksToRefresh", deduplicatedBooksToRefresh);
}

async function removeBookFromFailedBooks(bookIds: Array<string>) {
  if (!bookIds.length) return;

  console.log(
    `Readwise Official plugin: removing books ids ${
      bookIds.join(", ")
    } from failed list`,
  );
  const failedBooks = store.get("failedBooks");
  const deduplicatedFailedBooks = failedBooks.filter(
    (bookId: string) => !bookIds.includes(bookId),
  );
  store.set("failedBooks", deduplicatedFailedBooks);
}

async function acknowledgeSyncCompleted() {
  let response;
  try {
    response = await fetch(`${baseURL}/api/obsidian/sync_ack`, {
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in acknowledgeSyncCompleted: ",
      e,
    );
  }
  if (response && response.ok) {
    return;
  } else {
    console.log(
      "Readwise Official plugin: bad response in acknowledgeSyncCompleted: ",
      response,
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
          ...getAuthHeaders(),
        },
      },
    );

    if (response && response.ok) {
      const data: ExportStatusResponse = await response.json();

      const WAITING_STATUSES = ["PENDING", "RECEIVED", "STARTED", "RETRY"];
      const SUCCESS_STATUSES = ["SUCCESS"];

      if (WAITING_STATUSES.includes(data.taskStatus)) {
        if (data.booksExported) {
          const progressMsg =
            `Exporting Readwise data (${data.booksExported} / ${data.totalBooks}) ...`;
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
          data,
        );
        await handleSyncError("Sync failed");
        return;
      }
    } else {
      console.log(
        "Readwise Official plugin: bad response in getExportStatus: ",
        response,
      );
      await handleSyncError(getErrorMessageFromResponse(response));
    }
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in getExportStatus: ",
      e,
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
    return "Sync already in progress";
  }

  console.log("Readwise Official plugin: requesting archive...");
  store.set("isSyncing", true);

  const readwiseDir = store.get("readwiseDir");
  const account = store.get("account");

  console.log("Readwise app: syncing to folder and account: ", { readwiseDir, account });

  let parentDeleted = false;
  // If user is syncing with iCloud account, check if the parent folder is deleted
  if (account === "iCloud") {
    parentDeleted = !(await checkFolderExistsInAppleNotes(
      readwiseDir,
      account,
    ));
    console.log("Parent folder deleted: ", parentDeleted);
  } else {
    // If user is syncing with non-iCloud account, check if the folder name is 'Notes'
    // If not, return an error
    if (account !== "iCloud" && readwiseDir !== "Notes") {
      console.log(
        "Readwise Official plugin: folder name must be 'Notes' for non-iCloud accounts",
      );
      await handleSyncError("Sync failed");
      return "Sync failed";
    } else {
      // Check if non-iCloud accounts default to 'Notes' folder is empty or not this will be the replacement for parentDeleted
      parentDeleted = await checkIfFolderIsEmtpy(readwiseDir, account);
      console.log(`${account} parent folder deleted: `, parentDeleted);
    }
  }

  let url = `${baseURL}/api/obsidian/init?parentPageDeleted=${parentDeleted}`;
  if (statusId) {
    url += `&statusId=${statusId}`;
  }
  console.log("Readwise Official plugin: queueExport url: ", url);

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
    console.log(data.latest_id);
    if (data.latest_id <= lastest_id) {
      await handleSyncSuccess(); // Data is already up to date
      console.log("Readwise data is already up to date");
      return "Data is already up to date";
    }

    store.set("lastSavedStatusID", data.latest_id);
    console.log(
      "Readwise Official plugin: saved currentSyncStatusID: ",
      data.latest_id,
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
        response,
      );
      return "Data is already up to date";
    }
  } else {
    console.log(
      "Readwise Official plugin: bad response in queueExport: ",
      response,
    );
    await handleSyncError(getErrorMessageFromResponse(response));
    return "Sync failed";
  }
}

export async function syncHighlights(bookIds?: Array<string>) {
  if (!store.get("token")) return;

  const failedBooks = store.get("failedBooks");

  let targetBookIds = [...(bookIds || []), ...failedBooks];

  console.log(
    "Readwise Official plugin: syncing highlights for books: ",
    targetBookIds,
  );

  const booksToRefresh = store.get("booksToRefresh");
  const refreshBooks = store.get("refreshBooks");

  if (refreshBooks) {
    targetBookIds = [...targetBookIds, ...booksToRefresh];
  }

  if (!targetBookIds.length) {
    console.log(
      "Readwise Official plugin: no targetBookIds, checking for new highlights",
    );
    return await queueExport();
  }

  console.log("Readwise Official plugin: refreshing books: ", {
    targetBookIds,
  });

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
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          exportTarget: "obsidian",
          books: targetBookIds,
        }),
      },
    );

    if (response && response.ok) {
      return await queueExport();
    } else {
      console.log(
        `Readwise Official plugin: saving book id ${bookIds} to refresh later`,
      );
      const deduplicatedBookIds = new Set([
        ...this.settings.booksToRefresh,
        ...bookIds,
      ]);
      store.set("booksToRefresh", Array.from(deduplicatedBookIds));
      return;
    }
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in syncBookHighlights: ",
      e,
    );
  }
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

export async function getUserAuthToken(
  uuid: string,
  attempt = 0,
): Promise<string> {
  let response, data: ReadwiseAuthResponse;
  try {
    response = await fetch(`${baseURL}/api/auth?token=${uuid}`);
  } catch (e) {
    console.log(
      "Readwise Official plugin: fetch failed in getUserAuthToken: ",
      e,
    );
    return null;
  }
  if (response && response.ok) {
    data = await response.json();
  } else {
    console.log(
      "Readwise Official plugin: bad response in getUserAuthToken: ",
      response,
    );
    return null;
  }
  if (data.userAccessToken) {
    console.log(
      "Readwise Official plugin: successfully authenticated with Readwise",
    );
    return data.userAccessToken;
  } else {
    if (attempt > 20) {
      console.log(
        "Readwise Official plugin: reached attempt limit in getUserAuthToken",
      );
      return null;
    }
    console.log(
      `Readwise Official plugin: didn't get token data, retrying (attempt ${
        attempt + 1
      })`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await getUserAuthToken(uuid, attempt + 1);
  }
}
