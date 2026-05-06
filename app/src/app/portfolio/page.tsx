import MarginCard from '@/components/portfolio/MarginCard';
import DepositWithdraw from '@/components/portfolio/DepositWithdraw';
import PositionHistory from '@/components/portfolio/PositionHistory';
import FaucetButton from '@/components/portfolio/FaucetButton';

export default function PortfolioPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        <p className="text-sm text-text-muted mt-1">
          Manage your margin account and view open positions across all markets.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <MarginCard />
        </div>
        <div className="flex flex-col gap-4">
          <FaucetButton />
          <DepositWithdraw />
        </div>
      </div>

      <PositionHistory />
    </div>
  );
}
