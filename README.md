# Readwise 📚 to Apple Notes Export 📥

> [!WARNING]
> ⚠️ **Please note that this product is currently in early development, and you may encounter some issues during use or while syncing.** 
> 
> We are actively working towards a stable release and greatly appreciate your feedback. We welcome early beta testers to help us improve the app. 
> 
> If you experience any problems, please feel free to submit an issue. Pull requests are also welcome! 
> 
> Your contributions are invaluable as we work towards delivering a more reliable experience. Thank you for your support! ⚠️

This app enables you to easily export all your digital highlights to Apple Notes from a variety of sources such as Amazon Kindle, Apple Books, Google Play Books, Instapaper, Pocket, Medium, Twitter, PDFs, and more.

> [!NOTE]
> This app requires a subscription with [Readwise](https://readwise.io/) - a paid service that makes it easy to aggregate and review all your reading data into one place.

## Features

- **Customize Formatting** 💅: - use Readwise's formatting tool to change how the note appears in Apple Notes.
- **Multi-Account Support** 👥: Select from multiple Apple Notes accounts (e.g. iCloud, Gmail).
- **Folder Management** 📁: Automatically create and verify folders in Apple Notes.
- **Automatic Syncing** 🔄: Configure the frequency of when new highlights are added.

## Installation

1. Go to [https://readwise.io/apple_notes](https://readwise.io/apple_notes/start).

---

## Usage

1. **Launch the App:** Start the application after installation.
2. **Select Account:** Choose your Apple Notes account from the dropdown menu (e.g., iCloud, Gmail).
3. **Specify Folder:**
   - Enter the name of the folder where notes will be imported.
   - If the folder doesn’t exist, it will be created.
4. **Pick a sync frequency:**
   - Use the select box to pick a frequency your want your highlights to re-sync. (e.g. `Every 1 Hour`, `Every 12 Hours` etc.)
5. **Initiate Sync:** Click the 'Initiate Sync' button to start the sync process. You'll get messages on the progress of the current sync.
6. **Success Notification:** Once completed, you’ll receive a success message.

---

## Screenshots

![main-screen](/screenshots/app-and-apple-notes.png)

Track sync progress

![sync-highlights-progress](/screenshots/sync-highlights-progress.png)

Update sync frequency

![update-sync-frequency](/screenshots/update-sync-frequency.png)

Select account

![select-account](</screenshots/select-account.png>)

## Demo

![demo](/screenshots/apple-notes-readwise-demo.gif)

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Scarvy/apple-notes-readwise.git
   cd <repo>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the app in development mode:
   ```bash
   npm start
   ```

4. Build the app for production:
   ```bash
   npm run make
   ```

---

## Technical Details

### Built With

- [Electron](https://www.electronjs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [AppleScript](https://en.wikipedia.org/wiki/AppleScript)

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository.
2. Create a new branch:
   ```bash
   git checkout -b feature-name
   ```
3. Commit your changes:
   ```bash
   git commit -m "Add feature"
   ```
4. Push to the branch:
   ```bash
   git push origin feature-name
   ```
5. Submit a pull request.

---

## Known Limitations

- Only supports macOS due to reliance on AppleScript.
- Requires the Apple Notes app to be installed and configured.

---

## License

This project is licensed under the [GNU GENERAL](LICENSE).

---

## Contact

For any issues or feature requests, please open an issue on the [GitHub Issues](https://github.com/Scarvy/apple-notes-readwise/issues) page.
