import { useState, useEffect } from "react";
import { Toaster } from "./components/ui/toaster";
import { LoginCard } from "./components/login";
import { SettingsOptions } from "./components/settings-options";
import { SyncingProgress } from "./components/syncing-progress";
import { useToast } from "./hooks/use-toast";

export default function App() {
  const { toast } = useToast();

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const checkLoginStatus = async () => {
    const token = await window.api.getStoreValue("token");
    setIsLoggedIn(Boolean(token)); // Set state based on the token existence
  };

  useEffect(() => {
    checkLoginStatus();

    window.api.on("login-status", (event, loggedIn) => {
      setIsLoggedIn(loggedIn);

      if (loggedIn) {
        toast({
          variant: "success",
          description: "Successfully connected to Readwise",
          duration: 5000,
        });
      }
    });

    return () => {
      window.api.removeAllListeners("login-status");
    };
  }, []);

  return (
    <div className="grid grid-rows-1 min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col">
        <div className="md:container space-y-3">
          <h1 className="text-4xl font-bold text-black mb-1">
            Apple Notes Export
          </h1>
          <hr className="border-[1px] border-black"></hr>
          {isLoggedIn ? (
            isSyncing ? (
              <SyncingProgress />
            ) : (
              <SettingsOptions onIsSyncing={setIsSyncing} />
            )
          ) : (
            <LoginCard />
          )}
          <Toaster />
        </div>
      </main>
    </div>
  );
}
