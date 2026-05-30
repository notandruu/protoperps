import MarketsTable from '@/components/markets/MarketsTable';

export default function MarketsPage() {
  return (
    <div className="pb-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Markets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live perpetuals on BTC, ETH, and SOL — prices sourced from Pyth Network.
        </p>
      </div>
      <MarketsTable />
    </div>
  );
}
