import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { useToast } from "../hooks/use-toast";

interface SettingsOptionsProps {
  onIsSyncing: (isSyncing: boolean) => void;
}

export function SettingsOptions({ onIsSyncing }: SettingsOptionsProps) {
  const { toast } = useToast();

  async function handleSyncHighlights() {
    onIsSyncing(true); // Start syncing
    try {
      const msg = await window.api.readwise.syncHighlights();
      toast({
        variant: "success",
        description: msg,
        duration: 5000,
      });
      console.log("Message from main process: ", "Sync successful");
    } catch (error) {
      console.error("Sync error: ", error);
      toast({
        variant: "destructive",
        description: "Sync failed. Please try again.",
        duration: 5000,
      });
    } finally {
      onIsSyncing(false); // End syncing
    }
  }

  async function handleOpenCustomFormatWindow() {
    window.api.readwise.openCustomFormatWindow();
  }

  return (
    <>
      <div className="mb-2">
        <span className=" text-sm">
          If you take new highlights on documents you&apos;ve already exported
          at least once, those new highlights will be appended to the end of the
          existing files.
        </span>
      </div>
      <div className="space-y-4">
        <div className="flex flex-row">
          <div className="basis-2/3">
            <Label
              className="flex basis-2/3 font-bold"
              htmlFor="sync-highlights"
            >
              Sync your Readwise data with Apple Notes
            </Label>
            <Label className="flex basis-2/3 text-xs" htmlFor="sync-highlights">
              On first sync, the app will create a new folder containing all
              your highlights
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
            <Label
              className="flex basis-2/3 font-bold"
              htmlFor="connect-to-readwise"
            >
              Customize formatting options
            </Label>
            <Label
              className="flex basis-2/3 text-xs"
              htmlFor="connect-to-readwise"
            >
              You can customize which items export to Apple Notes and how they
              appear from the Readwise website
            </Label>
          </div>
          <div className="flex basis-1/3 justify-end">
            <Button
              variant="default"
              size="sm"
              onClick={handleOpenCustomFormatWindow}
            >
              Customize
            </Button>
          </div>
        </div>
        {/** TODO: Will add this back later */}
        {/* <div className="flex flex-row">
          <div className="basis-2/3">
            <Label
              className="flex basis-2/3 font-bold"
              htmlFor="connect-to-readwise"
            >
              Customize base folder
            </Label>
            <Label
              className="flex basis-2/3 text-xs"
              htmlFor="connect-to-readwise"
            >
              By default, the app will save all your highlights into a folder
              named Readwise
            </Label>
          </div>
          <div className="flex basis-1/3 justify-end">
            <Input
              type="text"
              id="base-folder"
              value={baseFolder}
              onChange={(e) => setBaseFolder(e.target.value)}
            />
          </div>
        </div> */}
      </div>
    </>
  );
}
