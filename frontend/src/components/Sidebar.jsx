import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useLanguage } from '../stores/useLanguageStore'
import { useAdmin } from '../hooks/useAdminHook'
import { LayoutDashboard, Wallet, Users, Megaphone, MessageCircle, Eye, FileText, Star, Settings, ShieldCheck } from 'lucide-react'

function Sidebar({ isOpen, onClose }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [activeItem, setActiveItem] = useState('dashboard')
  const { t } = useLanguage()
  const { isAdmin } = useAdmin()

  const handleNav = (item, path) => {
    setActiveItem(item)
    navigate(path)
    if (onClose) onClose()
  }

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-section">
          <div
            className={`sidebar-item ${activeItem === 'dashboard' ? 'active' : ''}`}
            onClick={() => handleNav('dashboard', '/')}
          >
            <span className="icon"><LayoutDashboard size={18} /></span>
            <span>{t('sidebar_dashboard')}</span>
          </div>
          <div
            className={`sidebar-item ${location.pathname === '/assets' ? 'active' : activeItem === 'assets' ? 'active' : ''}`}
            onClick={() => handleNav('assets', '/assets')}
          >
            <span className="icon"><Wallet size={18} /></span>
            <span>{t('sidebar_assets')}</span>
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <div
            className={`sidebar-item ${location.pathname === '/community' ? 'active' : ''}`}
            onClick={() => handleNav('community', '/community')}
          >
            <span className="icon"><Users size={18} /></span>
            <span>{t('nav_community')}</span>
          </div>
          <div
            className={`sidebar-item ${location.pathname === '/announcements' ? 'active' : ''}`}
            onClick={() => handleNav('announcements', '/announcements')}
          >
            <span className="icon"><Megaphone size={18} /></span>
            <span>{t('nav_announcements')}</span>
          </div>
          <div
            className={`sidebar-item ${location.pathname === '/support' ? 'active' : ''}`}
            onClick={() => handleNav('support', '/support')}
          >
            <span className="icon"><MessageCircle size={18} /></span>
            <span>{t('nav_support')}</span>
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <div
            className={`sidebar-item ${location.pathname === '/oracle' ? 'active' : ''}`}
            onClick={() => handleNav('oracle', '/oracle')}
          >
            <span className="icon"><Eye size={18} /></span>
            <span>Oracle</span>
          </div>
          <div
            className={`sidebar-item ${location.pathname === '/docs' ? 'active' : activeItem === 'docs' ? 'active' : ''}`}
            onClick={() => handleNav('docs', '/docs')}
          >
            <span className="icon"><FileText size={18} /></span>
            <span>{t('sidebar_docs')}</span>
          </div>
          <div
            className={`sidebar-item ${location.pathname === '/saved' ? 'active' : activeItem === 'saved' ? 'active' : ''}`}
            onClick={() => handleNav('saved', '/saved')}
          >
            <span className="icon"><Star size={18} /></span>
            <span>{t('sidebar_saved')}</span>
          </div>
          <div
            className={`sidebar-item ${location.pathname === '/settings' ? 'active' : activeItem === 'theme' ? 'active' : ''}`}
            onClick={() => handleNav('theme', '/settings')}
          >
            <span className="icon"><Settings size={18} /></span>
            <span>{t('sidebar_settings')}</span>
          </div>
        </div>

        {isAdmin && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div
                className={`sidebar-item sidebar-item-admin ${location.pathname === '/admin' ? 'active' : activeItem === 'admin' ? 'active' : ''}`}
                onClick={() => handleNav('admin', '/admin')}
              >
                <span className="icon"><ShieldCheck size={18} /></span>
                <span>{t('sidebar_admin')}</span>
              </div>
            </div>
          </>
        )}

      </aside>
    </>
  )
}

export default Sidebar
