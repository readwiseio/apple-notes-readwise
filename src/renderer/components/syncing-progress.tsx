import React, { useEffect, useState } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from '../components/ui/card'
import { useToast } from '../hooks/use-toast'
import { ExportStatusResponse } from '../../shared/types'

export function SyncingProgress({ onIsSyncing }: { onIsSyncing: (isSyncing: boolean) => void }) {
  const { toast } = useToast()

  const [booksExported, setBooksExported] = useState(0)
  const [totalBooks, setTotalBooks] = useState(0)
  const [bookSynced, setBookSynced] = useState(0)
  const [totalBooksToSync, setTotalBooksToSync] = useState(0)
  const [error, setError] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [complete, setComplete] = useState(false)
  const [isStarting, setIsStarting] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    const handleExportProgress = (_, data: ExportStatusResponse) => {
      console.log('Export progress', data.booksExported)
      setBooksExported(data.booksExported)
      setTotalBooks(data.totalBooks)
    }

    const handleExportPending = (_, isPending: boolean) => {
      console.log('Export pending', isPending)
      setIsPending(isPending)
    }

    const handleExportError = (_, msg: string) => {
      setError(msg)
      setComplete(true)
      onIsSyncing(false)
    }

    const handleExportComplete = (_) => {
      console.log('Export complete')
      setComplete(true)
    }

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
      setIsSyncing(false)
      onIsSyncing(false)
    }

    window.api.on('export-progress', handleExportProgress)
    window.api.on('export-pending', handleExportPending)
    window.api.on('export-error', handleExportError)
    window.api.on('export-complete', handleExportComplete)

    window.api.on('syncing-start', handleSyncStart)
    window.api.on('syncing-progress', handleSyncingProgress)
    window.api.on('syncing-complete', handleSyncComplete)

    setTimeout(() => setIsStarting(false), 800)

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
    <Card>
      <CardHeader>
        <CardTitle>Exporting your highlights to Apple Notes...</CardTitle>
        <CardDescription>The export will finish in the background</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        {/* Starting Phase */}
        {isStarting ? (
          <p>Starting Export...</p>
        ) : (
          <>
            {/* Export Process Phase */}
            {isPending ? (
              <p>Building export...</p>
            ) : complete ? (
              // Syncing Phase after Export Completes
              isSyncing ? (
                <p>
                  Syncing highlights ({bookSynced} / {totalBooksToSync})...
                </p>
              ) : (
                <p>Export complete!</p>
              )
            ) : (
              // Export Progress Phase (if not completed yet)
              <p>
                Exporting Readwise data ({booksExported} / {totalBooks})...
              </p>
            )}
          </>
        )}
      </CardContent>
      <CardFooter></CardFooter>
    </Card>
  )
}