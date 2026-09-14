import { TripWorkspace } from '../components/TripWorkspace';
export default function Assistant({ initialPrompt }: { initialPrompt: string }) {
  return <TripWorkspace initialPrompt={initialPrompt} />;
}
