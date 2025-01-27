import * as React from "react";

import { useToast } from "../hooks/use-toast";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

export function LoginCard() {
  const { toast } = useToast();

  async function handleLogin() {
    try {
      // @ts-ignore
      const msg = await window.api.readwise.connectToReadwise();
      console.log(msg);
      toast({
        variant: "success",
        description: "Connected to Readwise",
      });
    } catch (error) {
      console.error("Error connecting to Readwise:", error);
    }
  }

  return (
    <div className="flex flex-row items-center gap-1">
      {/* Label Section */}
      <div className="basis-2/3">
        <Label className="flex basis-2/3 font-bold" htmlFor="connect-to-readwise">
          Connect Apple Notes to Readwise
        </Label>
        <p className="text-xs mt-1">
          The Readwise app enables automatic syning of all your highlights from Kindle, Instapaper, Pocket, and more.
          <b> Note: Requires Readwise account</b>
        </p>
      </div>

      {/* Button Section */}
      <div className="flex basis-1/3 justify-end">
        <Button variant="primary" size="sm" type="button" onClick={handleLogin}>
          Connect
        </Button>
      </div>
    </div>
  );
}
