import * as React from 'react'
import { useEffect, useState } from 'react'
import { LoginCard } from './LoginCard'
import { SettingsOptions } from './SettingsOptions'
import { SyncingProgress } from './SyncingProgress'
import PermissionPage from './PermissionPage'

interface AppleNotesExportProps {
  onSettingsPageVisible: (visible: boolean) => void
}

export default function AppleNotesExport({ onSettingsPageVisible }: AppleNotesExportProps) {
  const [showSettings, setShowSettings] = useState(true)
  const [state, setState] = useState({
    isLoggedIn: false,
    isSyncing: false,
    isPermissioned: false,
    isFirstSync: false
  })

  useEffect(() => {
    const fetchInitialState = async () => {
      const token = await window.api.getStoreValue('token')
      const permission = await window.api.getStoreValue('hasAppleNotesFileSystemPermission')
      const firstSync = await window.api.getStoreValue('firstSync')

      setState((prevState) => ({
        ...prevState,
        isLoggedIn: Boolean(token),
        isPermissioned: permission,
        isFirstSync: firstSync
      }))
    }

    fetchInitialState()
  }, [])

  useEffect(() => {
    const handleLoginStatus = (_event, isLoggedIn: boolean) => {
      setState((prevState) => ({
        ...prevState,
        isLoggedIn
      }))
    }

    const handlePermissionStatus = (_event, isPermissioned: boolean) => {
      setState((prevState) => ({
        ...prevState,
        isPermissioned
      }))
    }

    const handleSyncStart = () => {
      setState((prevState) => ({ ...prevState, isSyncing: true }))
    }

    const handleSyncComplete = () => {
      setState((prevState) => {
        return { ...prevState, isSyncing: false }
      })
    }

    // Login and permission events
    window.api.on('login-status', handleLoginStatus)
    window.api.on('permission-status', handlePermissionStatus)

    // Syncing events
    window.api.on('syncing-start', handleSyncStart)
    window.api.on('syncing-complete', handleSyncComplete)

    return () => {
      window.api.removeAllListeners('login-status', handleLoginStatus)
      window.api.removeAllListeners('permission-status', handlePermissionStatus)
      window.api.removeAllListeners('syncing-start', handleSyncStart)
      window.api.removeAllListeners('syncing-complete', handleSyncComplete)
    }
  }, [])

  useEffect(() => {
    onSettingsPageVisible(state.isLoggedIn && state.isPermissioned && showSettings)
  }, [state.isLoggedIn, state.isPermissioned, showSettings, onSettingsPageVisible])

  async function handleSyncHighlights() {
    setState((prevState) => ({ ...prevState, isSyncing: true }))
    setShowSettings(false)
    try {
      await window.api.readwise.syncHighlights(undefined, false)
      console.log('Sync complete')
    } catch (error) {
      console.error('Sync error: ', error)
    }
  }

  return (
    <>
      <div className="md:container space-y-3">
        <h1 className="text-4xl font-bold text-black mb-1">Apple Notes Export</h1>
        <hr className="border-[1px] border-black"></hr>
        {state.isLoggedIn ? (
          !state.isPermissioned ? (
            <PermissionPage
              onIsPermissioned={(isPermissioned: boolean) =>
                setState((prevState) => ({
                  ...prevState,
                  isPermissioned
                }))
              }
            />
          ) : showSettings ? (
            <SettingsOptions handleSyncHighlights={handleSyncHighlights} />
          ) : (
            <SyncingProgress
              isFirstSync={state.isFirstSync}
              setAppState={setState}
              onShowSettings={setShowSettings}
            />
          )
        ) : (
          <LoginCard />
        )}
      </div>
    </>
  )
}
