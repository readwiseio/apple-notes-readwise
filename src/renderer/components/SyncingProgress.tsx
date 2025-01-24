import React, { useEffect, useState } from 'react'

import { ArrowRight, CornerUpLeft } from 'lucide-react'

import { useToast } from '../hooks/use-toast'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter } from './ui/card'
import { ExportStatusResponse } from '../../shared/types'
// @ts-ignore
import imageSyncExample from '../../images/sync-image-rendering.png'

interface SyncingProgressProps {
  onIsSyncing: (isSyncing: boolean) => void
  isFirstSync: boolean
}

export function SyncingProgress({ onIsSyncing, isFirstSync }: SyncingProgressProps) {
  const { toast } = useToast()

  // Export State
  const [isPending, setIsPending] = useState(false)
  const [booksExported, setBooksExported] = useState(0)
  const [totalBooks, setTotalBooks] = useState(0)
  const [exportComplete, setExportComplete] = useState(false)
  
  // Sync State
  const [bookSynced, setBookSynced] = useState(0)
  const [totalBooksToSync, setTotalBooksToSync] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncComplete, setSyncComplete] = useState(false)
  
  // Error state
  const [error, setError] = useState('')

  // For first time syncs only, wait for user to click the button to go back
  const handleTakeMeBack = (_) => {
    console.log('Return to the previous page')
    onIsSyncing(false)
  }

  useEffect(() => {
    const handleExportProgress = (_, data: ExportStatusResponse) => {
      console.log('Export progress', data.booksExported)
      setBooksExported(data.booksExported)
      setTotalBooks(data.totalBooks)
    }

    // Exporting Phase: Building the artifact to be exported
    const handleExportPending = (_, isPending: boolean) => {
      console.log('Export pending', isPending)
      setIsPending(isPending)
    }

    const handleExportError = (_, msg: string) => {
      setError(msg)
      setExportComplete(true)
      onIsSyncing(false)
    }

    const handleExportComplete = (_) => {
      console.log('Export complete')
      setExportComplete(true)
    }

    // Syncing Phase: Syncing the exported data to Apple Notes
    const handleSyncStart = (_, totalBooks: number) => {
      console.log('Syncing start', totalBooks)
      setTotalBooksToSync(totalBooks)
      setIsSyncing(true)
    }

    const handleSyncingProgress = (_) => {
      console.log('Syncing progress')
      setBookSynced((prev) => prev + 1)
    }

    const handleSyncComplete = (_) => {
      console.log('Syncing complete')
      setSyncComplete(true) // Mark sync as complete
    }

    window.api.on('export-progress', handleExportProgress)
    window.api.on('export-pending', handleExportPending)
    window.api.on('export-error', handleExportError)
    window.api.on('export-complete', handleExportComplete)

    window.api.on('syncing-start', handleSyncStart)
    window.api.on('syncing-progress', handleSyncingProgress)
    window.api.on('syncing-complete', handleSyncComplete)

    return () => {
      // Proper cleanup
      console.log('Cleaning up')
      window.api.removeAllListeners('export-progress', handleExportProgress)
      window.api.removeAllListeners('export-pending', handleExportPending)
      window.api.removeAllListeners('export-error', handleExportError)
      window.api.removeAllListeners('export-complete', handleExportComplete)
      window.api.removeAllListeners('syncing-start', handleSyncStart)
      window.api.removeAllListeners('syncing-progress', handleSyncingProgress)
      window.api.removeAllListeners('syncing-complete', handleSyncComplete)
    }
  }, [])

  useEffect(() => {
    async function handleToastMessages(_event, data) {
      console.log('', data.message)
      // if toast already on screen, clear it and show the new one
      toast({
        variant: data.variant,
        description: data.message,
        duration: 5000
      })
    }

    window.api.on('toast:show', handleToastMessages)

    return () => {
      window.api.removeAllListeners('toast:show')
    }
  }, [])

  return (
    <Card style={{ height: '450px' }}>
      <CardContent className="flex flex-col items-center justify-center text-xl mt-10">
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        <>
          {isPending && !exportComplete ? (
            <p>
              <b>
                Exporting Readwise data ({booksExported} / {totalBooks})...
              </b>
            </p>
          ) : exportComplete ? (
            // Syncing Phase after Export Completes
            isSyncing ? (
              <p>
                <b>
                  Syncing highlights ({bookSynced} / {totalBooksToSync})...
                </b>
              </p>
            ) : (
              <p>
                <b>Your highlights have successfully synced to Apple Notes!</b>
              </p>
            )
          ) : (
            // Export Progress Phase (if not completed yet)
            <p>
              <b>Building Export...</b>
            </p>
          )}
          <div className="flex flex-row items-center mt-10 gap-5">
            <p className="text-sm">
              PLEASE NOTE: Images in Apple Notes may take some time to render due to iCloud syncing.
              If you re-sync before the images have fully appeared, they won’t be included in the
              sync. Please wait for the images to fully load before syncing again.
            </p>
            {/* give the image some shadow */}
            <img
              src={imageSyncExample}
              alt="ImageSync"
              width={250}
              height={200}
              className="shadow"
            />
          </div>
          <div>
            {isFirstSync && syncComplete ? (
              <Button variant="primary" className="mt-10" onClick={handleTakeMeBack}>
                Take me back <CornerUpLeft />
              </Button>
            ) : null}
          </div>
        </>
      </CardContent>
      <CardFooter></CardFooter>
    </Card>
  )
}
