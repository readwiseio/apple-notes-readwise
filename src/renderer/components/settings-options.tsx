import React, { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'
import { useToast } from '../hooks/use-toast'
import { debounce } from 'lodash'
import { Switch } from './ui/switch'

const frequencyOptions = [
  { value: '0', label: 'Manual' },
  { value: '60', label: 'Every 1 hour' },
  { value: '720', label: 'Every 12 hours' },
  { value: '1440', label: 'Every 24 hours' },
  { value: '10080', label: 'Every week' }
]
interface SettingsOptionsProps {
  onIsSyncing: (isSyncing: boolean) => void
}

export function SettingsOptions({ onIsSyncing }: SettingsOptionsProps) {
  const { toast } = useToast()
  const [baseFolder, setBaseFolder] = useState('')
  const [accounts, setAccounts] = useState<{ value: string; label: string }[]>([])
  const [currentAccount, setCurrentAccount] = useState('')
  const [syncFrequency, setSyncFrequency] = useState('')
  const [triggerOnLoad, setTriggerOnLoad] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      const folder = await window.api.getStoreValue('readwiseDir')
      const { accounts, defaultAccount, currentAccount } = await window.api.getUserAccounts()
      const frequency = await window.api.getStoreValue('frequency')
      const onLoad = await window.api.getStoreValue('triggerOnLoad')

      console.log('Settings loaded: ', folder, accounts, defaultAccount, currentAccount, frequency, onLoad)

      setBaseFolder(folder || 'Readwise')
      setAccounts(
        accounts.map((acc: string) => ({ value: acc, label: acc })) || [
          { value: '', label: 'No accounts found' }
        ]
      )
      setCurrentAccount(currentAccount || defaultAccount)
      setSyncFrequency(frequency.toString() || '0')
      setTriggerOnLoad(onLoad)
    }

    loadSettings()
  }, [])

  const saveBaseFolder = debounce(async (folder: string) => {
    try {
      const newName = await window.api.setStoreValue('readwiseDir', folder)
      console.log('Settings saved: ', newName)
    } catch (error) {
      console.error('Error saving settings: ', error)
    }
  }, 300)

  const saveAccount = debounce(async (account: string) => {
    try {
      const newName = await window.api.setStoreValue('currentAccount', account)
      console.log('Settings saved: ', newName)
    } catch (error) {
      console.error('Error saving settings: ', error)
    }
  }, 300)

  const saveFrequency = debounce(async (freq: string) => {
    try {
      const frequency = await window.api.setStoreValue('frequency', freq)
      console.log('Settings saved: ', frequency)
    } catch (error) {
      console.error('Error saving settings: ', error)
    }
  })

  const updateTriggerOnLoad = debounce(async (checked: boolean) => {
    try {
      const triggerOnLoad = await window.api.setStoreValue('triggerOnLoad', checked)
      console.log('Settings saved: ', triggerOnLoad)
    } catch (error) {
      console.error('Error saving settings: ', error)
    }
  })

  const handleBaseFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const folder = e.target.value
    setBaseFolder(folder)
    saveBaseFolder(folder)
    console.log('Base folder updated to: ', folder)
  }

  const handleAccountChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedAccount = e.target.value
    setCurrentAccount(selectedAccount)
    saveAccount(selectedAccount)

    console.log('Account updated to: ', selectedAccount)
    toast({
      variant: 'default',
      description: 'Your highlights will now sync to your "' + selectedAccount + '" account',
      duration: 5000
    })
  }

  const handleFrequencyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedFrequency = e.target.value
    setSyncFrequency(selectedFrequency)
    saveFrequency(selectedFrequency)
    
    const msg = await window.api.readwise.updateSyncFrequency(selectedFrequency)

    console.log('Sync frequency updated to: ', msg)
    toast({
      variant: 'default',
      description: 'Sync frequency updated to "' + frequencyOptions.find((f) => f.value === selectedFrequency)?.label + '"',
      duration: 5000
    })
  }

  const handleTriggerOnLoadChange = async (checked: boolean) => {
    setTriggerOnLoad(checked)
    updateTriggerOnLoad(checked)
    
    console.log('Sync on open updated to: ', checked)
    toast({
      variant: 'default',
      description: 'Sync on open updated to "' + checked + '"',
      duration: 5000
    })
  }

  async function handleSyncHighlights() {
    onIsSyncing(true) // Start syncing
    try {
      const msg = await window.api.readwise.syncHighlights(undefined, false)
      toast({
        variant: 'success',
        description: msg,
        duration: 5000
      })
      console.log('Sync successful: ', msg)
    } catch (error) {
      console.error('Sync error: ', error)
      toast({
        variant: 'destructive',
        description: 'Sync failed. Please try again.',
        duration: 5000
      })
    } finally {
      console.log('Sync complete')
      onIsSyncing(false) // End syncing
    }
  }

  async function handleOpenCustomFormatWindow() {
    window.api.readwise.openCustomFormatWindow()
  }

  useEffect(() => {
    async function handleSyncProgressMessages(_event, data) {
      console.log('Sync progress', data.message)
      // if toast already on screen, clear it and show the new one
      toast({
        variant: data.variant,
        description: data.message,
        duration: 5000
      })
    }

    window.api.on('toast:show', handleSyncProgressMessages)

    return () => {
      window.api.removeAllListeners('toast:show')
    }
  }, [])

  return (
    <>
      <div className="mb-2">
        <p className=" text-xs">
          If you take new highlights on documents you&apos;ve already exported at least once, those
          new highlights will be appended to the end of the existing files.
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex flex-row">
          <div className="basis-2/3">
            <Label className="flex basis-2/3 font-bold" htmlFor="sync-highlights">
              Sync your Readwise data with Apple Notes
            </Label>
            <Label className="flex basis-2/3 text-xs" htmlFor="sync-highlights">
              On first sync, the app will create a new folder containing all your highlights
            </Label>
          </div>
          <div className="flex basis-1/3 justify-end">
            <Button variant="default" size="sm" onClick={handleSyncHighlights}>
              Initiate Sync
            </Button>
          </div>
        </div>
        <div className="flex flex-row">
          <div className="basis-2/3">
            <Label className="flex basis-2/3 font-bold" htmlFor="sync-highlights">
              Customize formatting options
            </Label>
            <Label className="flex basis-2/3 text-xs" htmlFor="sync-highlights">
              You can customize which items export to Apple Notes and how they appear from the
              Readwise website
            </Label>
          </div>
          <div className="flex basis-1/3 justify-end">
            <Button variant="default" size="sm" onClick={handleOpenCustomFormatWindow}>
              Customize
            </Button>
          </div>
        </div>
        <div className="flex flex-row">
          <div className="basis-2/3">
            <Label className="flex basis-2/3 font-bold" htmlFor="sync-highlights">
              Customize base folder
            </Label>
            <Label className="flex basis-2/3 text-xs" htmlFor="sync-highlights">
              By default, the app will save all your highlights into a folder named Readwise
            </Label>
          </div>
          <div className="flex basis-1/3 justify-end">
            <Input
              type="text"
              id="base-folder"
              value={baseFolder}
              onChange={handleBaseFolderChange}
            />
          </div>
        </div>
        {/* Pick an account to export to in Apple Notes */}
        <div className="flex flex-row">
          <div className="basis-2/3">
            <Label className="flex basis-2/3 font-bold" htmlFor="sync-highlights">
              Pick an account to export to in Apple Notes
            </Label>
            <Label className="flex basis-2/3 text-xs" htmlFor="sync-highlights">
              Select the Apple Notes account you want to use for exporting highlights.
            </Label>
          </div>
          <div className="flex basis-1/3 justify-end">
            <Select
              id="account-select"
              value={currentAccount}
              onChange={handleAccountChange}
              options={accounts}
              disabled={true}
            />
          </div>
        </div>
        {/*Automatic sync */}
        <div className="flex flex-row">
          <div className="basis-2/3">
            <Label className="flex basis-2/3 font-bold" htmlFor="sync-highlights">
              Configure resync frequency
            </Label>
            <Label className="flex basis-2/3 text-xs" htmlFor="sync-highlights">
              If not set to Manual, Readwise will automatically resync with Apple Notes when the app is
              open at the specified interval
            </Label>
          </div>
          <div className="flex basis-1/3 justify-end">
            <Select
              id="frequency-select"
              value={syncFrequency}
              onChange={handleFrequencyChange}
              options={frequencyOptions}
            />
          </div>
        </div>
        {/* Sync on open */}
        <div className="flex flex-row">
          <div className="basis-2/3">
            <Label className="flex basis-2/3 font-bold" htmlFor="sync-highlights">
              Sync automatically on app open
            </Label>
            <Label className="flex basis-2/3 text-xs" htmlFor="sync-highlights">
              If enabled, Readwise will automatically sync with Apple Notes when the app is opened
            </Label>
          </div>
          <div className="flex basis-1/3 justify-end">
            <Switch 
              checked={triggerOnLoad}
              onCheckedChange={(checked) => handleTriggerOnLoadChange(checked)}
            />
          </div>
        </div>
      </div>
    </>
  )
}
