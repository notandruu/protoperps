import MarginCard from '@/components/portfolio/MarginCard';
import DepositWithdraw from '@/components/portfolio/DepositWithdraw';
import PositionHistory from '@/components/portfolio/PositionHistory';
import FaucetButton from '@/components/portfolio/FaucetButton';

export default function PortfolioPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Portfolio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your margin account and open positions.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          <MarginCard />
        </div>
        <div className="flex flex-col gap-3">
          <FaucetButton />
          <DepositWithdraw />
        </div>
      </div>

      <PositionHistory />
    </div>
  );
}
