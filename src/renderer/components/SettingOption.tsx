import React from 'react'
import { Label } from './ui/label'
import { QuestionMarkCircledIcon } from '@radix-ui/react-icons'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

export default function SettingOption({ labelName, toolTipDescription, option }) {
  return (
    <>
      <div className="flex flex-row p-1 items-center">
        <div className="basis-2/3">
          <div className="flex flex-row">
            <div className="p-1">
              <Label className="flex basis-2/3 font-bold text-md" htmlFor="sync-highlights">
                {labelName}
              </Label>
            </div>
            <div className="mt-[7px]">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <QuestionMarkCircledIcon />
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    <p>{toolTipDescription}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
        <div className="flex basis-1/3 justify-end">{option}</div>
      </div>
    </>
  )
}
