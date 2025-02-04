import { app, shell, MenuItemConstructorOptions, dialog } from 'electron'

export const template: MenuItemConstructorOptions[] = [
  {
    label: 'File',
    submenu: [
      {
        label: 'About',
        click: async () => {
          dialog.showMessageBox({
            title: 'About',
            message: 'Readwise to Apple Notes',
            detail: `Version ${app.getVersion()}`,
            type: 'info',
            buttons: ['OK']
          })
        }
      },
      {
        label: 'Settings',
        click: async () => {
          shell.openExternal('https://readwise.io/export/apple-notes/preferences')
        }
      },
      {
        label: 'Exit',
        accelerator: 'CommandOrControl+Q',
        click: () => {
          app.quit()
        }
      },
    ]
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload', accelerator: 'CommandOrControl+R' },
      { role: 'toggleDevTools', accelerator: 'F12' }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' }
    ]
  },
  {
    role: 'window',
    submenu: [{ role: 'minimize' }, { role: 'close', accelerator: 'CommandOrControl+Shift+Q' }]
  },
  {
    role: 'help',
    submenu: [
      {
        label: 'Learn More',
        click: async () => {
          shell.openExternal('https://github.com/Scarvy/apple-notes-readwise/blob/main/README.md')
        }
      },
      {
        label: 'Report an Issue',
        click: async () => {
          shell.openExternal('mailto:hello@readwise.io')
        }
      },
      {
        label: 'Permission Issues?',
        click: async () => {
          shell.openExternal(
            'https://scottsplace.notion.site/Apple-Notes-Readwise-Export-Fixing-permission-issues-14474debfabc805e8701f8534d1854a8?pvs=4'
          )
        }
      },
      {
        label: 'Check latest release',
        click: async () => {
          shell.openExternal('https://github.com/Scarvy/apple-notes-readwise/releases')
        }
      }
    ]
  }
]
