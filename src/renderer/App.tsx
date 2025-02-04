import * as React from 'react'
import { useEffect, useState } from 'react'
import { useToast } from './hooks/use-toast'
import { Toaster } from './components/ui/toaster'
import AppleNotesExport from './components/AppleNotesExport'
import { Button } from './components/ui/button'
import { LogOutIcon } from 'lucide-react'

export default function App() {
  const { toast } = useToast()
  const [showLogout, setShowLogout] = useState(false)

  useEffect(() => {
    const handleToastMessage = (_event, data) => {
      toast({
        variant: data.variant,
        description: data.message,
        duration: data.duration || 5000, // Optional: Provide a default duration
      });
    };

    // Set up the global listener for 'toast:show'
    window.api.on('toast:show', handleToastMessage);

    return () => {
      // Clean up the listener on unmount
      window.api.removeAllListeners('toast:show');
    };
  }, [toast]);

  const DISCONNECT_MSG = `
  Are you sure you want to disconnect? This will allow you to reset your local settings, but could cause duplicate files.

  If you just want to start a fresh export from Readwise, you don't need to disconnect -- just delete the Readwise folder from Apple Notes and initiate another sync.
    `

  const handleDisconnect = async () => {
    const confirmed = window.confirm(DISCONNECT_MSG)
    if (confirmed) {
      const result = await window.api.readwise.disconnect()
      console.log(result)
      toast({
        variant: 'default',
        description:
          result === 'success'
            ? 'Disconnected from Readwise'
            : 'Failed to disconnect from Readwise',
        duration: 5000,
      })
    }
  }

  return (
    <div className="grid grid-rows-1 min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <header className="absolute top-4 right-4">
        {showLogout && (
          <div className="absolute top-1 right-1">
            <Button variant="link" size="sm" onClick={handleDisconnect}>
              <LogOutIcon className="w-4 h-4" />
                Disconnect
            </Button>
          </div>)}
      </header>
      <main className="flex flex-col">
        <AppleNotesExport onSettingsPageVisible={setShowLogout} />
        <Toaster />
      </main>
      <footer className="text-center text-sm text-black">
        <p>
          Questions? Please see our{' '}
          <a
            className="text-blue-500"
            href="https://github.com/Scarvy/apple-notes-readwise?tab=readme-ov-file#readwise--to-apple-notes-export-"
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
      </footer>
    </div>
  )
}
