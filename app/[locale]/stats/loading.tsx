import { BlueprintHeading } from "@/components/BlueprintGrid";
import { StatsPanelSkeleton } from "@/components/ui/AsyncPanelSkeleton";

export default function StatsLoading() {
  return (
    <div className="pb-10">
      <BlueprintHeading>Live on-chain stats</BlueprintHeading>
      <div className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6 lg:px-8">
        <header className="mb-8">
          <p className="text-center text-sm text-pv-muted">
            Every number on this page is read directly from the Mimir contract on Stellar Testnet.
          </p>
        </header>
        <StatsPanelSkeleton />
      </div>
    </div>
  );
}
