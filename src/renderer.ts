/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';

// get the button element by id btn and add an event listener to it 
// when the button is clicked, the function will be executed
document.getElementById('connect-to-readwise').addEventListener('click', async () => {

    const msg = await window.api.readwise.connectToReadwise();
    
    console.log("Message from main process: ", msg);
});

document.getElementById('sync-highlights').addEventListener('click', async () => {
    const msg = await window.api.readwise.syncHighlights();
    
    console.log("Message from main process: ", msg);
});

console.log('👋 This message is being logged by "renderer.ts", included via Vite');
