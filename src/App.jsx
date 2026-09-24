import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import ReownMount from '@/components/walletcourt/ReownMount';
import CourtLayout from '@/components/walletcourt/CourtLayout';
import Home from '@/pages/Home';
import Case from '@/pages/Case';
import Hall from '@/pages/Hall';
import HallCategory from '@/pages/HallCategory';
import About from '@/pages/About';
import Challenge from '@/pages/Challenge';
import Wallet from '@/pages/Wallet';
import AdminCourtDispatches from '@/pages/AdminCourtDispatches';
import AdminNansenUsage from '@/pages/AdminNansenUsage';
import AdminDefenses from '@/pages/AdminDefenses';
import AdminContestControl from '@/pages/AdminContestControl';
import AdminCalibrationDocket from '@/pages/AdminCalibrationDocket';
import AdminAttribution from '@/pages/AdminAttribution';
import AdminRobinhoodValidation from '@/pages/AdminRobinhoodValidation';
import AdminOwnerNotifications from '@/pages/AdminOwnerNotifications';
import Account from '@/pages/Account';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <Routes>
            <Route element={<CourtLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/case/:slug" element={<Case />} />
              <Route path="/hall" element={<Hall />} />
              <Route path="/hall/:categorySlug" element={<HallCategory />} />
              <Route path="/about" element={<About />} />
              <Route path="/challenge/:sourceCaseSlug" element={<Challenge />} />
              <Route path="/wallet/:claimSlug" element={<Wallet />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/account" element={<Account />} />
                <Route path="/admin/court-dispatches" element={<AdminCourtDispatches />} />
                <Route path="/admin/nansen-usage" element={<AdminNansenUsage />} />
                <Route path="/admin/defenses" element={<AdminDefenses />} />
                <Route path="/admin/contest-control" element={<AdminContestControl />} />
                <Route path="/admin/calibration-docket" element={<AdminCalibrationDocket />} />
                <Route path="/admin/robinhood-validation" element={<AdminRobinhoodValidation />} />
                <Route path="/admin/attribution" element={<AdminAttribution />} />
                <Route path="/admin/owner-notifications" element={<AdminOwnerNotifications />} />
              </Route>
            </Route>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
          <ReownMount />
          <Toaster />
        </Router>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App