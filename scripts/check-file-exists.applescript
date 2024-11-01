tell application "Notes"
    set folderName to "Readwise" -- Replace with your folder name variable
    set noteName to "Introduction-to-Algorithms-2" -- Replace with your note name variable
    set noteExists to false

    -- Check if the specific folder exists
    set targetFolder to folder folderName
    if targetFolder is not missing value then
        -- Iterate through all notes in the specified folder
        repeat with eachNote in notes of targetFolder
            if name of eachNote is noteName then
                set noteExists to true
                exit repeat
            end if
        end repeat
    end if

    return noteExists
end tell