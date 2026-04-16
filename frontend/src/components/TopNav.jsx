import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Search, Coins, Users, FileText, Globe, ArrowRight } from 'lucide-react'
import { useLanguage } from '../stores/useLanguageStore'

const API = import.meta.env.VITE_API_URL || '/api'

function shortenAddr(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

function TopNav({ onToggleSidebar, sidebarOpen }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const debounceRef = useRef(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const term = searchQuery.trim()
    if (term.length < 2) {
      setResults(null)
      setOpen(false)
      return
    }
    setLoading(true)
    setOpen(true)
    clearTimeout(debounceRef.current)
    const currentReqId = ++requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/search/query?q=${encodeURIComponent(term)}`)
        const data = await res.json()
        if (currentReqId !== requestIdRef.current) return
        if (data.ok) {
          setResults({ tokens: data.tokens || [], profiles: data.profiles || [], posts: data.posts || [], networkPosts: data.networkPosts || [] })
        }
      } catch {
        if (currentReqId === requestIdRef.current) {
          setResults({ tokens: [], profiles: [], posts: [], networkPosts: [] })
        }
      } finally {
        if (currentReqId === requestIdRef.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const goTo = (path) => {
    setOpen(false)
    setSearchQuery('')
    setResults(null)
    navigate(path)
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchQuery.trim().length >= 2) {
      goTo(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
    }
  }

  const total = results ? results.tokens.length + results.profiles.length + results.posts.length + results.networkPosts.length : 0

  return (
    <nav className="top-nav">
      <div className="nav-logo-group">
        <button
          className="hamburger-btn"
          onClick={onToggleSidebar}
          aria-label="Toggle menu"
        >
          <span className={`hamburger-icon ${sidebarOpen ? 'open' : ''}`}>
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
        <NavLink to="/" className="nav-logo">
          <img src="/logo.png" alt="Cryptonite" className="logo-img" />
          <div>
            <span className="logo-text">Cryptonite</span>
            <span className="logo-sub">Cryptonite Swap</span>
          </div>
        </NavLink>
      </div>
      <div className="nav-links">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
          {t('nav_cryptocurrencies')}
        </NavLink>
        <NavLink to="/exchange" className={({ isActive }) => isActive ? 'active' : ''}>
          {t('nav_exchanges')}
        </NavLink>
        <NavLink to="/community" className={({ isActive }) => isActive ? 'active' : ''}>
          {t('nav_community')}
        </NavLink>
        <NavLink to="/announcements" className={({ isActive }) => isActive ? 'active' : ''}>
          {t('nav_announcements')}
        </NavLink>
        <NavLink to="/support" className={({ isActive }) => isActive ? 'active' : ''}>
          {t('nav_support')}
        </NavLink>
      </div>
      <div className="nav-search-wrapper" ref={wrapperRef}>
        <form className="nav-search" onSubmit={handleSearchSubmit}>
          <Search size={14} className="nav-search-icon" />
          <input
            type="text"
            className="nav-search-input"
            placeholder="Search..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => { if (results) setOpen(true) }}
          />
        </form>
        {open && (
          <div className="nav-search-dropdown">
            {loading && (
              <div className="nav-search-loading">
                <div className="dash-loading-spinner" style={{ width: 18, height: 18 }} />
                <span>Searching...</span>
              </div>
            )}
            {!loading && results && total === 0 && (
              <div className="nav-search-empty">No results found</div>
            )}
            {!loading && results && total > 0 && (
              <>
                {results.tokens.length > 0 && (
                  <div className="nav-search-section">
                    <div className="nav-search-section-title"><Coins size={13} /> Tokens</div>
                    {results.tokens.slice(0, 5).map(t => (
                      <div key={t.mint || t.symbol} className="nav-search-item" onClick={() => goTo(`/exchange?token=${encodeURIComponent(t.symbol)}`)}>
                        <div className="nav-search-item-icon">
                          {t.image_url ? <img src={t.image_url} alt="" /> : <span>{(t.symbol || '?')[0]}</span>}
                        </div>
                        <div className="nav-search-item-text">
                          <span className="nav-search-item-primary">{t.symbol}</span>
                          <span className="nav-search-item-secondary">{t.name}</span>
                        </div>
                        <ArrowRight size={12} className="nav-search-item-arrow" />
                      </div>
                    ))}
                  </div>
                )}
                {results.profiles.length > 0 && (
                  <div className="nav-search-section">
                    <div className="nav-search-section-title"><Users size={13} /> Profiles</div>
                    {results.profiles.slice(0, 5).map(p => (
                      <div key={p.wallet} className="nav-search-item" onClick={() => goTo(`/C/${p.username}`)}>
                        <div className="nav-search-item-icon avatar">
                          {p.avatar_url ? <img src={p.avatar_url.startsWith('/') ? `${API.replace('/api', '')}${p.avatar_url}` : p.avatar_url} alt="" /> : <span>{(p.username || '?')[0].toUpperCase()}</span>}
                        </div>
                        <div className="nav-search-item-text">
                          <span className="nav-search-item-primary">C/{p.username}</span>
                          {p.display_name && <span className="nav-search-item-secondary">{p.display_name}</span>}
                        </div>
                        <ArrowRight size={12} className="nav-search-item-arrow" />
                      </div>
                    ))}
                  </div>
                )}
                {results.networkPosts.length > 0 && (
                  <div className="nav-search-section">
                    <div className="nav-search-section-title"><Globe size={13} /> Network Posts</div>
                    {results.networkPosts.slice(0, 4).map(p => (
                      <div key={p.id} className="nav-search-item" onClick={() => goTo(`/networks/post/${p.id}`)}>
                        <div className="nav-search-item-text">
                          <span className="nav-search-item-primary">{p.title || p.body?.slice(0, 50) || 'Post'}</span>
                          <span className="nav-search-item-secondary">{p.category !== 'General' ? p.category + ' · ' : ''}{shortenAddr(p.author_wallet)}</span>
                        </div>
                        <ArrowRight size={12} className="nav-search-item-arrow" />
                      </div>
                    ))}
                  </div>
                )}
                {results.posts.length > 0 && (
                  <div className="nav-search-section">
                    <div className="nav-search-section-title"><FileText size={13} /> Community Posts</div>
                    {results.posts.slice(0, 4).map(p => (
                      <div key={p.id} className="nav-search-item" onClick={() => goTo(`/community?post=${p.id}`)}>
                        <div className="nav-search-item-text">
                          <span className="nav-search-item-primary">{p.title || p.body?.slice(0, 50) || 'Post'}</span>
                          <span className="nav-search-item-secondary">{p.username ? `C/${p.username}` : shortenAddr(p.author_wallet)}</span>
                        </div>
                        <ArrowRight size={12} className="nav-search-item-arrow" />
                      </div>
                    ))}
                  </div>
                )}
                <div className="nav-search-footer" onClick={() => goTo(`/search?q=${encodeURIComponent(searchQuery.trim())}`)}>
                  View all {total} results <ArrowRight size={12} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <button className="nav-search-mobile" onClick={() => navigate('/search')} aria-label="Search">
        <Search size={18} />
      </button>
    </nav>
  )
}

export default TopNav
