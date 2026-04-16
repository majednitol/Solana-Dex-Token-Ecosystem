import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search as SearchIcon, Coins, Users, FileText, Video, ArrowRight, Heart, MessageCircle, Globe } from 'lucide-react'
import { TAG_COLORS } from '../data/contentData'

const API = import.meta.env.VITE_API_URL || '/api'

function shortenAddress(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function TokenResultCard({ token }) {
  const navigate = useNavigate()
  return (
    <div className="search-result-card search-token-card" onClick={() => navigate(`/exchange?token=${encodeURIComponent(token.symbol)}`)}>
      <div className="search-token-icon">
        {token.image_url ? (
          <img src={token.image_url} alt={token.symbol} />
        ) : (
          <span>{(token.symbol || '?')[0]}</span>
        )}
      </div>
      <div className="search-token-info">
        <span className="search-token-symbol">{token.symbol}</span>
        <span className="search-token-name">{token.name}</span>
      </div>
      <div className="search-token-mint">{shortenAddress(token.mint)}</div>
      <ArrowRight size={14} className="search-card-arrow" />
    </div>
  )
}

function ProfileResultCard({ profile }) {
  const navigate = useNavigate()
  return (
    <div className="search-result-card search-profile-card" onClick={() => navigate(`/C/${profile.username}`)}>
      <div className="search-profile-avatar">
        {profile.avatar_url ? (
          <img src={profile.avatar_url.startsWith('/') ? `${API.replace('/api', '')}${profile.avatar_url}` : profile.avatar_url} alt={profile.username} />
        ) : (
          <span>{(profile.username || '?')[0].toUpperCase()}</span>
        )}
      </div>
      <div className="search-profile-info">
        <span className="search-profile-username">C/{profile.username}</span>
        {profile.display_name && <span className="search-profile-display">{profile.display_name}</span>}
        {profile.bio && <span className="search-profile-bio">{profile.bio.length > 80 ? profile.bio.slice(0, 80) + '...' : profile.bio}</span>}
      </div>
      <ArrowRight size={14} className="search-card-arrow" />
    </div>
  )
}

function PostResultCard({ post }) {
  const navigate = useNavigate()
  const authorName = post.display_name || post.username || shortenAddress(post.author_wallet)
  return (
    <div className="search-result-card search-post-card" onClick={() => navigate(`/community?post=${post.id}`)}>
      <div className="search-post-info">
        <div className="search-post-meta">
          {post.username && <span className="search-post-author">C/{post.username}</span>}
          <span className="search-post-by">{authorName}</span>
          <span className="feed-meta-dot">·</span>
          <span>{timeAgo(post.created_at)}</span>
          {post.type === 'video' && <span className="feed-post-type-badge feed-post-type-video"><Video size={10} /> Video</span>}
          {post.type === 'blog' && <span className="feed-post-type-badge feed-post-type-blog"><FileText size={10} /> Blog</span>}
        </div>
        {post.title && <h4 className="search-post-title">{post.title}</h4>}
        {post.category && post.category !== 'General' && (
          <span className="feed-post-tag" style={{ background: TAG_COLORS[post.category] || '#7b61ff', fontSize: '10px', padding: '1px 6px' }}>{post.category}</span>
        )}
        {post.body && <p className="search-post-body">{post.body.length > 120 ? post.body.slice(0, 120) + '...' : post.body}</p>}
        <div className="search-post-stats">
          <span>{post.votes || 0} votes</span>
        </div>
      </div>
      <ArrowRight size={14} className="search-card-arrow" />
    </div>
  )
}

function NetworkPostResultCard({ post }) {
  const navigate = useNavigate()
  const authorName = post.display_name || post.username || shortenAddress(post.author_wallet)
  return (
    <div className="search-result-card search-post-card" onClick={() => navigate(`/networks/post/${post.id}`)}>
      <div className="search-post-info">
        <div className="search-post-meta">
          {post.username && <span className="search-post-author">{post.username}</span>}
          <span className="search-post-by">{authorName}</span>
          <span className="feed-meta-dot">·</span>
          <span>{timeAgo(post.created_at)}</span>
          {post.media_type === 'video' && <span className="feed-post-type-badge feed-post-type-video"><Video size={10} /> Video</span>}
        </div>
        {post.title && <h4 className="search-post-title">{post.title}</h4>}
        {post.category && post.category !== 'General' && (
          <span className="feed-post-tag" style={{ background: TAG_COLORS[post.category] || '#7b61ff', fontSize: '10px', padding: '1px 6px' }}>{post.category}</span>
        )}
        {post.body && <p className="search-post-body">{post.body.length > 120 ? post.body.slice(0, 120) + '...' : post.body}</p>}
        {post.media_url && post.media_type === 'image' && (
          <img src={post.media_url} alt="" className="search-post-thumb" />
        )}
        <div className="search-post-stats">
          <span><Heart size={11} /> {post.likes_count || 0}</span>
          <span><MessageCircle size={11} /> {post.comments_count || 0}</span>
        </div>
      </div>
      <ArrowRight size={14} className="search-card-arrow" />
    </div>
  )
}

function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  const [query, setQuery] = useState(q)
  const [results, setResults] = useState({ tokens: [], profiles: [], posts: [], networkPosts: [] })
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    setQuery(q)
    if (q.length >= 2) {
      doSearch(q)
    }
  }, [q])

  const doSearch = async (term) => {
    setLoading(true)
    setSearched(true)
    try {
      const res = await fetch(`${API}/search/query?q=${encodeURIComponent(term)}`)
      const data = await res.json()
      if (data.ok) {
        setResults({ tokens: data.tokens || [], profiles: data.profiles || [], posts: data.posts || [], networkPosts: data.networkPosts || [] })
      }
    } catch {} finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim().length >= 2) {
      setSearchParams({ q: query.trim() })
    }
  }

  const totalResults = results.tokens.length + results.profiles.length + results.posts.length + results.networkPosts.length
  const hasResults = totalResults > 0

  return (
    <div className="page-container">
      <div className="search-page-header">
        <h1>Search</h1>
        <form onSubmit={handleSubmit} className="search-page-form">
          <SearchIcon size={18} className="search-page-icon" />
          <input
            type="text"
            className="search-page-input"
            placeholder="Search tokens, profiles, posts..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <button type="submit" className="search-page-btn" disabled={query.trim().length < 2}>Search</button>
        </form>
        {searched && !loading && (
          <p className="search-results-count">
            {hasResults ? `${totalResults} result${totalResults !== 1 ? 's' : ''} for "${q}"` : `No results for "${q}"`}
          </p>
        )}
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <div className="dash-loading-spinner" />
        </div>
      )}

      {!loading && searched && !hasResults && (
        <div className="search-empty">
          <SearchIcon size={48} />
          <h3>No results found</h3>
          <p>Try searching with different keywords or check your spelling.</p>
        </div>
      )}

      {!loading && hasResults && (
        <div className="search-results-grid">
          {results.tokens.length > 0 && (
            <div className="search-section">
              <div className="search-section-header">
                <Coins size={16} />
                <h3>Tokens</h3>
                <span className="search-section-count">{results.tokens.length}</span>
              </div>
              <div className="search-section-list">
                {results.tokens.map(token => (
                  <TokenResultCard key={token.mint || token.symbol} token={token} />
                ))}
              </div>
            </div>
          )}

          {results.profiles.length > 0 && (
            <div className="search-section">
              <div className="search-section-header">
                <Users size={16} />
                <h3>Profiles</h3>
                <span className="search-section-count">{results.profiles.length}</span>
              </div>
              <div className="search-section-list">
                {results.profiles.map(profile => (
                  <ProfileResultCard key={profile.wallet} profile={profile} />
                ))}
              </div>
            </div>
          )}

          {results.networkPosts.length > 0 && (
            <div className="search-section">
              <div className="search-section-header">
                <Globe size={16} />
                <h3>Network Posts</h3>
                <span className="search-section-count">{results.networkPosts.length}</span>
              </div>
              <div className="search-section-list">
                {results.networkPosts.map(post => (
                  <NetworkPostResultCard key={post.id} post={post} />
                ))}
              </div>
            </div>
          )}

          {results.posts.length > 0 && (
            <div className="search-section">
              <div className="search-section-header">
                <FileText size={16} />
                <h3>Community Posts</h3>
                <span className="search-section-count">{results.posts.length}</span>
              </div>
              <div className="search-section-list">
                {results.posts.map(post => (
                  <PostResultCard key={post.id} post={post} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Search
