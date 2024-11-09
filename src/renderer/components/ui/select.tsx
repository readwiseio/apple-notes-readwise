import React from 'react'
import { cn } from '../../lib/utils' // assuming `cn` is your utility for conditional class names

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: string[]
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:ring-offset-slate-950 dark:text-slate-50 dark:placeholder:text-slate-400 dark:focus-visible:ring-slate-300",
          className
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option} value={option} className="text-slate-900 dark:text-slate-50">
            {option}
          </option>
        ))}
      </select>
    )
  }
)

Select.displayName = "Select"

export { Select }
