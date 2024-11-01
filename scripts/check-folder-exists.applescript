tell application "Notes"
    set folderName to "${folder}"
    set folderExists to false
    repeat with eachFolder in folders
        if name of eachFolder is folderName then
            set folderExists to true
            exit repeat
        end if
    end repeat
    return folderExists
end tell