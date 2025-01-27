import React from 'react'
import { useEffect } from 'react'
import { useToast } from './hooks/use-toast'
import { Toaster } from './components/ui/toaster'
import AppleNotesExport from './components/AppleNotesExport'

export default function App() {
  const { toast } = useToast()

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

  return (
    <div className="grid grid-rows-1 min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col">
        <AppleNotesExport />
        <Toaster />
      </main>
      <footer className="text-center text-sm text-black">
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
      </footer>
    </div>
  )
}
