import * as React from "react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

export function LoginCard() {

  async function handleLogin() {
    const msg = await window.api.readwise.connectToReadwise();
    console.log(msg);
  }

  return (
    <div className="flex flex-row items-center">
      <div className="basis-2/3">
        <Label
          className="flex basis-2/3 font-bold"
          htmlFor="connect-to-readwise"
        >
          Connect to Readwise
        </Label>
      </div>
      <div className="flex basis-1/3 justify-end">
        <Button variant="primary" size="sm" onClick={handleLogin}>
          Connect to Readwise
        </Button>
      </div>
    </div>
  );
}
