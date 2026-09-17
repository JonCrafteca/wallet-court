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
import About from '@/pages/About';
import Challenge from '@/pages/Challenge';
import Wallet from '@/pages/Wallet';
import AdminCourtDispatches from '@/pages/AdminCourtDispatches';
import AdminNansenUsage from '@/pages/AdminNansenUsage';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import { Navigate } from 'react-router-dom';

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
              <Route path="/about" element={<About />} />
              <Route path="/challenge/:sourceCaseSlug" element={<Challenge />} />
              <Route path="/wallet/:claimSlug" element={<Wallet />} />
              <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
                <Route path="/admin/court-dispatches" element={<AdminCourtDispatches />} />
                <Route path="/admin/nansen-usage" element={<AdminNansenUsage />} />
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