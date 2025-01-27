import React, { useEffect, useState } from 'react'
import { CornerUpLeft } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { ExportStatusResponse } from '../../shared/types'
// @ts-ignore
import imageSyncExample from '../../images/sync-image-rendering.png'

interface SyncingProgressProps {
  isFirstSync: boolean
  setAppState: React.Dispatch<
    React.SetStateAction<{
      isLoggedIn: boolean
      isSyncing: boolean
      isPermissioned: boolean
      isFirstSync: boolean
    }>
  >
  onShowSettings: (show: boolean) => void
}

export function SyncingProgress({
  isFirstSync,
  setAppState,
  onShowSettings
}: SyncingProgressProps) {
  // const { toast } = useToast()
  const [exportPending, setExportPending] = useState(true)
  const [exportProgress, setExportProgress] = useState({
    current: 0,
    total: 0,
    complete: false
  })
  const [syncProgress, setSyncProgress] = useState({
    current: 0,
    total: 0,
    complete: false
  })

  useEffect(() => {
    const handleExportProgress = (_, data: ExportStatusResponse) => {
      setExportPending(false)
      setExportProgress({
        current: data.booksExported,
        total: data.totalBooks,
        complete: false
      })
    }

    const handleSyncProgress = () => {
      setSyncProgress((prev) => ({
        ...prev,
        current: prev.current + 1
      }))
    }

    const handleSyncStart = (_, total: number) => {
      setSyncProgress((prev) => ({
        ...prev,
        total
      }))
    }

    const handleExportComplete = () => {
      setExportProgress((prev) => ({
        ...prev,
        complete: true
      }))
    }

    const handleSyncComplete = async () => {
      setSyncProgress((prev) => ({ ...prev, complete: true }))
      // Take user to settings page if not the first sync
      if (!isFirstSync) {
        onShowSettings(true)
      }
    }

    // Export progress
    window.api.on('export-progress', handleExportProgress)
    window.api.on('export-complete', handleExportComplete)

    // Syncing progress
    window.api.on('syncing-start', handleSyncStart)
    window.api.on('syncing-progress', handleSyncProgress)
    window.api.on('syncing-complete', handleSyncComplete)

    return () => {
      window.api.removeAllListeners('export-progress', handleExportProgress)
      window.api.removeAllListeners('export-complete', handleExportComplete)
      window.api.removeAllListeners('syncing-progress', handleSyncProgress)
    }
  }, [isFirstSync, onShowSettings, setAppState])

  const handleTakeMeBack = () => {
    if (isFirstSync && syncProgress.complete) {
      setAppState((prev) => ({ ...prev, isFirstSync: false }))
      onShowSettings(true)
    }
  }

  const renderMessage = () => {
    if (!exportPending && !exportProgress.complete) {
      return (
        <>
          Exporting Readwise data ({exportProgress.current}/{exportProgress.total})...
        </>
      )
    }

    if (exportProgress.complete && !syncProgress.complete) {
      return (
        <>
          Syncing highlights ({syncProgress.current}/{syncProgress.total})...
        </>
      )
    }

    if (syncProgress.complete) {
      return <>Your highlights have successfully synced to Apple Notes!</>
    }

    return <>Building export...</>
  }

  return (
    <Card style={{ height: '405px' }}>
      <CardContent className="flex flex-col items-center justify-center text-xl mt-10">
        <p>
          <b>{renderMessage()}</b>
        </p>
        <div className="mt-2 flex flex-row items-center justify-center">
          <p className="text-sm p-1">
            PLEASE NOTE: Due to iCloud syncing, images may take a few minutes to appear in Apple
            Notes after the sync is finished. Please wait for images to render before attempting
            another sync to ensure they appear in future syncs.
          </p>
          <img
            src={imageSyncExample}
            alt="ImageSync"
            width={250}
            height={200}
            className="shadow mt-5"
          />
        </div>
        {isFirstSync && syncProgress.complete && (
          <Button variant="primary" className="mt-6" onClick={handleTakeMeBack}>
            Take me back
            <CornerUpLeft size={16} />
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
