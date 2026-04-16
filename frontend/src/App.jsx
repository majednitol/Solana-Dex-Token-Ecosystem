import { useState, useCallback, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import StoreInitializer from './components/StoreInitializer'
import useTracking from './hooks/useTracking'
import TopStatsBar from './components/TopStatsBar'
import TopNav from './components/TopNav'
import Sidebar from './components/Sidebar'
import MobileNav from './components/MobileNav'
import IntroSplash from './components/IntroSplash'

const Swap = lazy(() => import('./pages/Swap'))
const Markets = lazy(() => import('./pages/Markets'))
const Community = lazy(() => import('./pages/Community'))
const Announcements = lazy(() => import('./pages/Announcements'))
const Support = lazy(() => import('./pages/Support'))
const Assets = lazy(() => import('./pages/Assets'))
const Docs = lazy(() => import('./pages/Docs'))
const BuyTokens = lazy(() => import('./pages/BuyTokens'))
const Api = lazy(() => import('./pages/Api'))
const GetListed = lazy(() => import('./pages/GetListed'))
const Settings = lazy(() => import('./pages/Settings'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Saved = lazy(() => import('./pages/Saved'))
const Admin = lazy(() => import('./pages/Admin'))
const Oracle = lazy(() => import('./pages/Oracle'))
const ContentView = lazy(() => import('./pages/ContentView'))
const Profile = lazy(() => import('./pages/Profile'))
const Search = lazy(() => import('./pages/Search'))

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
      <div className="dash-loading-spinner" />
    </div>
  )
}

function App() {
  const [showIntro, setShowIntro] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useTracking()

  const handleIntroComplete = useCallback(() => {
    setShowIntro(false)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev)
  }, [])

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [])

  return (
    <>
      {showIntro && <IntroSplash onComplete={handleIntroComplete} />}
      <StoreInitializer />
      <div className="app-layout">
        <TopStatsBar />
        <TopNav onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} />
        <div className="main-wrapper">
          <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />
          <main className="content-area">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/exchange" element={<Swap />} />
                <Route path="/swap" element={<Navigate to="/exchange" replace />} />
                <Route path="/markets" element={<Markets />} />
                <Route path="/assets" element={<Assets />} />
                <Route path="/docs" element={<Docs />} />
                <Route path="/community" element={<Community />} />
                <Route path="/announcements" element={<Announcements />} />
                <Route path="/networks/post/:postId" element={<Announcements />} />
                <Route path="/support" element={<Support />} />
                <Route path="/buy" element={<BuyTokens />} />
                <Route path="/api" element={<Api />} />
                <Route path="/get-listed" element={<GetListed />} />
                <Route path="/saved" element={<Saved />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/post/:id" element={<ContentView />} />
                <Route path="/C/:username" element={<Profile />} />
                <Route path="/search" element={<Search />} />
                <Route path="/oracle" element={<Oracle />} />
                <Route path="/admin" element={<Admin />} />
              </Routes>
            </Suspense>
          </main>
        </div>
        <MobileNav />
      </div>
    </>
  )
}

export default App
