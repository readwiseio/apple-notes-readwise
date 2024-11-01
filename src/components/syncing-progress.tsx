import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../components/ui/card";

export function SyncingProgress() {

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exporting your highlights to Apple Notes...</CardTitle>
        <CardDescription>The export will finish in the background</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Syncing highlights...</p>
      </CardContent>
      <CardFooter>
      </CardFooter>
    </Card>
  );
}
