import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from '@/components/Layout'
import Dashboard from '@/pages/Dashboard'
import Today from '@/pages/Today'
import Stats from '@/pages/Stats'
import Import from '@/pages/Import'
import BetLog from '@/pages/BetLog'
import CLV from '@/pages/CLV'
import DailyReport from '@/pages/DailyReport'
import AccountSettings from '@/pages/AccountSettings'
import StrategiesList from '@/pages/strategies/StrategiesList'
import StrategyNew from '@/pages/strategies/StrategyNew'
import StrategyDetail from '@/pages/strategies/StrategyDetail'
import RunViewer from '@/pages/strategies/RunViewer'
import LineShop from '@/pages/LineShop'
import { AuthProvider } from '@/lib/auth'
import { LoginDialog } from '@/components/auth/LoginDialog'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/today" element={<Today />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/import" element={<Import />} />
            <Route path="/bets" element={<BetLog />} />
            <Route path="/clv" element={<CLV />} />
            <Route path="/report" element={<DailyReport />} />
            <Route path="/account" element={<AccountSettings />} />
            <Route path="/strategies" element={<StrategiesList />} />
            <Route path="/strategies/new" element={<StrategyNew />} />
            <Route path="/strategies/:id" element={<StrategyDetail />} />
            <Route
              path="/strategies/:id/runs/:runId"
              element={<RunViewer />}
            />
            <Route path="/line-shop" element={<LineShop />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <LoginDialog />
    </AuthProvider>
  )
}

export default App
