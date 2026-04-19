import MarketsTable from '@/components/markets/MarketsTable';

export default function MarketsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Markets</h1>
        <p className="text-sm text-text-muted mt-1">
          Synthetic perpetuals on private company valuations. All prices sourced from Prestocks DEX pools.
        </p>
      </div>

      <MarketsTable />
    </div>
  );
}
