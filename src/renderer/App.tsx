import React, { useEffect } from 'react'
import { useToast } from './hooks/use-toast'
import { Toaster } from './components/ui/toaster'
import AppleNotesExport from './components/AppleNotesExport'

export default function App() {
  const { toast } = useToast()

  async function handleToast(_event, data) {
    toast({
      variant: data.variant,
      description: data.message,
      duration: 5000
    })
  }

  window.api.on('toast:show', handleToast)

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
