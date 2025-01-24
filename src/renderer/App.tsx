import React, { useState, useEffect } from 'react'
import { Toaster } from './components/ui/toaster'
import { LoginCard } from './components/LoginCard'
import { SettingsOptions } from './components/SettingsOptions'
import { SyncingProgress } from './components/SyncingProgress'
import PermissionPage from './components/PermissionPage'

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isPermissioned, setIsPermissioned] = useState(false)
  const [isFirstSync, setIsFirstSync] = useState(true)

  const checkLoginStatus = async () => {
    const token = await window.api.getStoreValue('token')
    setIsLoggedIn(Boolean(token)) // Set state based on the token existence
  }

  const checkPermissonStatus = async () => {
    const permission = await window.api.getStoreValue('hasAppleNotesFileSystemPermission')
    console.log("Checking permission status: ", permission)
    setIsPermissioned(Boolean(permission))
  }

  const checkFirstSync = async () => {
    const firstSync = await window.api.getStoreValue('firstSync')
    console.log("Checking first sync status: ", firstSync)
    setIsFirstSync(Boolean(firstSync))
  }

  useEffect(() => {
    checkLoginStatus()

    window.api.on('login-status', (_event, loggedIn: boolean) => {
      setIsLoggedIn(loggedIn)

      if (loggedIn) {
        console.log('Logged in')
      } else {
        console.log('Logged out')
      }
    })

    return () => {
      window.api.removeAllListeners('login-status')
    }
  }, [isSyncing])

  useEffect(() => {
    checkPermissonStatus()

    window.api.on('permission-status', (_event, permissioned: boolean) => {
      console.log("Updating permission status: ", permissioned)
      setIsPermissioned(permissioned)

      if (permissioned) {
        console.log('Permissioned')
      } else {
        console.log('Not permissioned')
      }
    })

    return () => {
      window.api.removeAllListeners('permission-status')
    }
  }, [])

  useEffect(() => {
    checkFirstSync()

    window.api.on('first-sync-status', (_event, firstSync: boolean) => {
      console.log("Updating first sync status: ", firstSync)
      setIsFirstSync(firstSync)

      if (firstSync) {
        console.log('First sync')
      } else {
        console.log('Not first sync')
      }
    })

    return () => {
      window.api.removeAllListeners('first-sync-status')
    }
  }, [])

  return (
    <div className="grid grid-rows-1 min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col">
        <div className="md:container space-y-3">
          <h1 className="text-4xl font-bold text-black mb-1">Apple Notes Export</h1>
          <hr className="border-[1px] border-black"></hr>
          {isLoggedIn ? (
            !isPermissioned ? (
              <PermissionPage onIsPermissioned={setIsPermissioned} />
            ) :
            isSyncing ? (
              <SyncingProgress onIsSyncing={setIsSyncing} isFirstSync={isFirstSync} />
            ) : (
              <SettingsOptions onIsSyncing={setIsSyncing} />
            )
          ) : (
            <LoginCard />
          )}
          <Toaster />
        </div>
        {!isSyncing ? (
          <footer className="mt-10 text-center text-sm text-black">
            <p>
              Questions? Please see our{' '}
              <a
                className="text-blue-500"
                href="https://github.com/Scarvy/apple-notes-readwise/wiki/User-Guide"
                target="_blank"
              >
                docs
              </a>{' '}
              or email us at{' '}
              <a className="text-blue-500" href="mailto:hello@readwise.io" target="_blank">
                hello@readwise.io
              </a>{' '}
              🙂
            </p>
          </footer>) : null}
      </main>
    </div>
  )
}
