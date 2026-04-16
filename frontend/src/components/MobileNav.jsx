import { useNavigate, useLocation } from 'react-router-dom'
import { useLanguage } from '../stores/useLanguageStore'
import { LayoutDashboard, ArrowLeftRight, Megaphone, Wallet, Settings, Users } from 'lucide-react'

function MobileNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useLanguage()

  const tabs = [
    { path: '/', icon: <LayoutDashboard size={20} />, label: t('sidebar_dashboard') },
    { path: '/exchange', icon: <ArrowLeftRight size={20} />, label: t('nav_exchanges') },
    { path: '/announcements', icon: <Megaphone size={20} />, label: t('nav_announcements') },
    { path: '/assets', icon: <Wallet size={20} />, label: t('sidebar_assets') },
    { path: '/community', icon: <Users size={20} />, label: t('nav_community') },
    { path: '/settings', icon: <Settings size={20} />, label: t('sidebar_settings') },
  ]

  return (
    <nav className="mobile-bottom-nav">
      {tabs.map(tab => (
        <button
          key={tab.path}
          className={`mobile-nav-tab ${location.pathname === tab.path ? 'active' : ''}`}
          onClick={() => navigate(tab.path)}
        >
          <span className="mobile-nav-icon">{tab.icon}</span>
          <span className="mobile-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}

export default MobileNav
