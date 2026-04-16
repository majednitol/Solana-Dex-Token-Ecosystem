import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { Flame, Sparkles, TrendingUp, Rocket, Users, UserPlus, UserCheck, Calendar, ExternalLink, Edit3, X, Image, Video, Upload, Trash2, FileText, Repeat2, Shield, Download, AlertTriangle } from 'lucide-react'
import { TAG_COLORS } from '../data/contentData'

const API = import.meta.env.VITE_API_URL || '/api'
const SORT_OPTIONS = ['Hot', 'New', 'Top', 'Rising']

function formatVotes(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toString()
}

function shortenAddress(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

function MiniChartSVG({ variant = 0 }) {
  const charts = [
    { line: 'M0,30 L8,28 L16,32 L24,20 L32,24 L40,18 L48,22 L56,10 L64,16 L72,8 L80,14 L88,6 L96,12 L104,4 L112,10 L120,7', color: '#00d18c', gradId: `profGrad${variant}a` },
    { line: 'M0,10 L8,14 L16,8 L24,18 L32,12 L40,22 L48,16 L56,28 L64,20 L72,30 L80,24 L88,34 L96,28 L104,36 L112,30 L120,32', color: '#ef4444', gradId: `profGrad${variant}b` },
    { line: 'M0,25 L10,20 L20,28 L30,15 L40,22 L50,10 L60,18 L70,8 L80,14 L90,6 L100,12 L110,4 L120,8', color: '#7b61ff', gradId: `profGrad${variant}c` },
  ]
  const c = charts[variant % charts.length]
  return (
    <svg viewBox="0 0 120 40" style={{ width: '100%', height: '50px' }}>
      <defs>
        <linearGradient id={c.gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={c.color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={c.line} fill="none" stroke={c.color} strokeWidth="2" />
      <path d={`${c.line} L120,40 L0,40Z`} fill={`url(#${c.gradId})`} />
    </svg>
  )
}

function toEmbedUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed${u.pathname}`
    }
    if ((u.hostname === 'youtube.com' || u.hostname === 'www.youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) {
        return `https://www.youtube.com/embed/${u.pathname.replace('/shorts/', '')}`
      }
      const vid = u.searchParams.get('v')
      if (vid) return `https://www.youtube.com/embed/${vid}`
      if (u.pathname.startsWith('/embed/')) return url
    }
    if (u.hostname === 'vimeo.com' || u.hostname === 'www.vimeo.com') {
      const match = u.pathname.match(/\/(\d+)/)
      if (match) return `https://player.vimeo.com/video/${match[1]}`
    }
    if (u.hostname === 'player.vimeo.com') return url
  } catch {}
  return url
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

function UserPostCard({ post, onDelete, isAuthor, onShare }) {
  const navigate = useNavigate()
  const [voted, setVoted] = useState(null)
  const [voteCount, setVoteCount] = useState(post.votes || 0)

  const handleVote = async (dir, e) => {
    e.stopPropagation()
    if (voted === dir) {
      setVoted(null)
      setVoteCount(post.votes || 0)
      return
    }
    const prevVoted = voted
    const prevCount = voteCount
    setVoted(dir)
    setVoteCount(prevCount + (dir === 'up' ? 1 : -1))
    try {
      const res = await fetch(`${API}/posts/${post.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: dir }),
      })
      const data = await res.json()
      if (data.ok) {
        setVoteCount(data.votes)
      } else {
        setVoted(prevVoted)
        setVoteCount(prevCount)
      }
    } catch {
      setVoted(prevVoted)
      setVoteCount(prevCount)
    }
  }

  const authorName = post.display_name || post.username || shortenAddress(post.author_wallet)
  const profileLink = post.username ? `/C/${post.username}` : null

  return (
    <div className="feed-post">
      <div className="feed-post-vote">
        <button
          className={`feed-vote-btn ${voted === 'up' ? 'voted-up' : ''}`}
          onClick={(e) => handleVote('up', e)}
        >
          ▲
        </button>
        <span className={`feed-vote-count ${voted === 'up' ? 'voted-up' : voted === 'down' ? 'voted-down' : ''}`}>
          {formatVotes(voteCount)}
        </span>
        <button
          className={`feed-vote-btn ${voted === 'down' ? 'voted-down' : ''}`}
          onClick={(e) => handleVote('down', e)}
        >
          ▼
        </button>
      </div>

      <div className="feed-post-content">
        <div className="feed-post-meta">
          {profileLink ? (
            <span className="feed-subreddit" onClick={() => navigate(profileLink)} style={{ cursor: 'pointer' }}>
              C/{post.username}
            </span>
          ) : (
            <span className="feed-subreddit">{shortenAddress(post.author_wallet)}</span>
          )}
          <span className="feed-meta-dot">·</span>
          <span className="feed-post-by">Posted by <span className="feed-username">{authorName}</span></span>
          <span className="feed-meta-dot">·</span>
          <span className="feed-post-time">{timeAgo(post.created_at)}</span>
          {post.type === 'video' && (
            <span className="feed-post-type-badge feed-post-type-video"><Video size={11} /> Video</span>
          )}
          {post.type === 'blog' && (
            <span className="feed-post-type-badge feed-post-type-blog"><FileText size={11} /> Blog</span>
          )}
        </div>

        {post.title && <h3 className="feed-post-title">{post.title}</h3>}
        {post.category && post.category !== 'General' && (
          <span className="feed-post-tag" style={{ background: TAG_COLORS[post.category] || '#7b61ff' }}>
            {post.category}
          </span>
        )}
        {post.body && <p className="feed-post-body">{post.body.length > 300 ? post.body.slice(0, 300) + '...' : post.body}</p>}

        {post.image_url && (
          <div className="feed-post-image">
            <img src={post.image_url.startsWith('/') ? `${API.replace('/api', '')}${post.image_url}` : post.image_url} alt={post.title || 'Post image'} loading="lazy" />
          </div>
        )}

        {post.video_url && /youtube\.com|youtu\.be|vimeo\.com/.test(post.video_url) && (
          <div className="feed-post-video">
            <iframe
              src={toEmbedUrl(post.video_url)}
              title={post.title || 'Video'}
              allowFullScreen
              style={{ width: '100%', height: '280px', borderRadius: '8px', border: 'none' }}
            />
          </div>
        )}

        <div className="feed-post-actions" onClick={(e) => e.stopPropagation()}>
          <button className="feed-action-btn" onClick={() => onShare && onShare(post)}>
            <span className="feed-action-icon"><Repeat2 size={14} /></span>
            <span>Share</span>
          </button>
          {isAuthor && onDelete && (
            <button className="feed-action-btn feed-action-delete" onClick={() => onDelete(post.id)}>
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CreatePostModal({ onClose, onCreated }) {
  const { publicKey } = useWallet()
  const [postType, setPostType] = useState('blog')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('General')
  const [imageUrl, setImageUrl] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef(null)

  const categories = ['General', 'Trading', 'Analysis', 'News', 'Meme', 'Tutorial', 'Discussion']

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API}/posts/upload-image`, {
        method: 'POST',
        headers: { 'x-wallet-address': publicKey.toBase58() },
        body: formData,
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setImageUrl(data.imageUrl)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async () => {
    if (!publicKey) return
    if (!title.trim()) { setError('Title is required'); return }
    if (!body.trim()) { setError('Body is required'); return }
    if (postType === 'video' && (!videoUrl.trim() || !/youtube\.com|youtu\.be|vimeo\.com/.test(videoUrl))) {
      setError('A valid YouTube or Vimeo URL is required for video posts'); return
    }
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58(),
        },
        body: JSON.stringify({
          type: postType,
          title: title.trim(),
          body: body.trim(),
          imageUrl,
          videoUrl: postType === 'video' ? videoUrl.trim() : '',
          category,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      onCreated(data.post)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="prof-create-modal prof-post-modal" onClick={e => e.stopPropagation()}>
        <div className="prof-create-modal-header">
          <h3>Create Post</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="prof-create-modal-body">
          <div className="post-type-toggle">
            <button
              className={`post-type-btn ${postType === 'blog' ? 'active' : ''}`}
              onClick={() => setPostType('blog')}
            >
              <FileText size={16} /> Blog Post
            </button>
            <button
              className={`post-type-btn ${postType === 'video' ? 'active' : ''}`}
              onClick={() => setPostType('video')}
            >
              <Video size={16} /> Video Post
            </button>
          </div>

          <div className="prof-create-field">
            <label>Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 256))}
              placeholder="Post title..."
              className="prof-create-input prof-create-input-full"
            />
          </div>

          <div className="prof-create-field">
            <label>Category</label>
            <div className="post-category-row">
              {categories.map(c => (
                <button
                  key={c}
                  className={`post-category-chip ${category === c ? 'active' : ''}`}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="prof-create-field">
            <label>Body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value.slice(0, 10000))}
              placeholder="Write your post..."
              className="prof-create-textarea post-body-textarea"
              rows={6}
            />
          </div>

          {postType === 'video' && (
            <div className="prof-create-field">
              <label>Video URL (YouTube or Vimeo)</label>
              <input
                type="url"
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="prof-create-input prof-create-input-full"
              />
              {videoUrl && !/youtube\.com|youtu\.be|vimeo\.com/.test(videoUrl) && (
                <span style={{ color: '#ef4444', fontSize: '11px', marginTop: '4px', display: 'block' }}>Only YouTube and Vimeo URLs are supported</span>
              )}
            </div>
          )}

          <div className="prof-create-field">
            <label>Image (optional)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            {imageUrl ? (
              <div className="post-image-preview">
                <img src={imageUrl.startsWith('/') ? `${API.replace('/api', '')}${imageUrl}` : imageUrl} alt="Preview" />
                <button className="post-image-remove" onClick={() => { setImageUrl(''); if (fileInputRef.current) fileInputRef.current.value = '' }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                className="post-upload-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={16} />
                {uploading ? 'Uploading...' : 'Upload Image'}
              </button>
            )}
          </div>

          {(title.trim() || body.trim()) && (
            <div className="prof-create-field">
              <label>Preview</label>
              <div className="post-preview-card">
                <div className="feed-post-meta">
                  <span className="feed-subreddit">C/you</span>
                  <span className="feed-meta-dot">·</span>
                  <span className="feed-post-time">just now</span>
                  {postType === 'video' && <span className="feed-post-type-badge feed-post-type-video"><Video size={11} /> Video</span>}
                  {postType === 'blog' && <span className="feed-post-type-badge feed-post-type-blog"><FileText size={11} /> Blog</span>}
                </div>
                {title.trim() && <h3 className="feed-post-title">{title}</h3>}
                {category !== 'General' && (
                  <span className="feed-post-tag" style={{ background: TAG_COLORS[category] || '#7b61ff' }}>{category}</span>
                )}
                {body.trim() && <p className="feed-post-body" style={{ marginTop: '6px' }}>{body.length > 200 ? body.slice(0, 200) + '...' : body}</p>}
                {imageUrl && (
                  <div className="feed-post-image" style={{ marginTop: '8px' }}>
                    <img src={imageUrl.startsWith('/') ? `${API.replace('/api', '')}${imageUrl}` : imageUrl} alt="Preview" style={{ maxHeight: '120px' }} />
                  </div>
                )}
                {postType === 'video' && videoUrl && /youtube\.com|youtu\.be|vimeo\.com/.test(videoUrl) && (
                  <div className="feed-post-video" style={{ marginTop: '8px' }}>
                    <iframe
                      src={toEmbedUrl(videoUrl)}
                      title="Video preview"
                      allowFullScreen
                      style={{ width: '100%', height: '160px', borderRadius: '8px', border: 'none' }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {error && <div className="prof-create-error">{error}</div>}
          <button
            className="prof-create-submit"
            onClick={handleSubmit}
            disabled={loading || !title.trim() || !body.trim()}
          >
            {loading ? 'Publishing...' : 'Publish Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfileSidebar({ profile, isOwner, isFollowing, isMember, onFollow, onUnfollow, onJoin, onLeave, onEdit, onCreatePost }) {
  const joinDate = profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''

  return (
    <div className="prof-sidebar-wrapper">
      {isOwner && (
        <button className="prof-create-post-btn" onClick={onCreatePost}>
          + Create Post
        </button>
      )}
      <div className="prof-sidebar-card">
        <div className="prof-sidebar-banner" />
        <div className="prof-sidebar-avatar-row">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.display_name} className="prof-sidebar-avatar" />
          ) : (
            <div className="prof-sidebar-avatar prof-sidebar-avatar-placeholder">
              {(profile.display_name || profile.username || '?').charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="prof-sidebar-info">
          <h2 className="prof-sidebar-displayname">{profile.display_name || profile.username}</h2>
          <span className="prof-sidebar-username">C/{profile.username}</span>
          {profile.bio && <p className="prof-sidebar-bio">{profile.bio}</p>}
          <div className="prof-sidebar-stats">
            <div className="prof-sidebar-stat">
              <span className="prof-stat-value">{profile.members || 0}</span>
              <span className="prof-stat-label">Members</span>
            </div>
            <div className="prof-sidebar-stat">
              <span className="prof-stat-value">{profile.followers || 0}</span>
              <span className="prof-stat-label">Followers</span>
            </div>
            <div className="prof-sidebar-stat">
              <span className="prof-stat-value">{profile.following || 0}</span>
              <span className="prof-stat-label">Following</span>
            </div>
          </div>
          <div className="prof-sidebar-meta">
            {joinDate && (
              <span className="prof-meta-item">
                <Calendar size={13} />
                Joined {joinDate}
              </span>
            )}
            <span className="prof-meta-item prof-meta-wallet" title={profile.wallet}>
              <ExternalLink size={13} />
              {shortenAddress(profile.wallet)}
            </span>
          </div>
          {isOwner ? (
            <button className="prof-sidebar-btn prof-edit-btn" onClick={onEdit}>
              <Edit3 size={14} />
              Edit Profile
            </button>
          ) : (
            <div className="prof-sidebar-actions">
              <button
                className={`prof-sidebar-btn ${isMember ? 'prof-following-btn' : 'prof-join-btn'}`}
                onClick={isMember ? onLeave : onJoin}
              >
                <Users size={14} />
                {isMember ? 'Joined' : 'Join'}
              </button>
              <button
                className={`prof-sidebar-btn ${isFollowing ? 'prof-following-btn' : 'prof-follow-btn'}`}
                onClick={isFollowing ? onUnfollow : onFollow}
              >
                {isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />}
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateProfileModal({ onClose, onCreated }) {
  const { publicKey } = useWallet()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [gdprAccepted, setGdprAccepted] = useState(false)

  const handleCreate = async () => {
    if (!publicKey || !gdprAccepted) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          bio: bio.trim(),
        }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || 'Failed to create profile')
      } else {
        onCreated(data.profile)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="prof-create-modal" onClick={e => e.stopPropagation()}>
        <div className="prof-create-modal-header">
          <h3>Create Your Profile</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="prof-create-modal-body">
          {!gdprAccepted ? (
            <div className="gdpr-consent-notice">
              <div className="gdpr-consent-icon">
                <Shield size={20} />
              </div>
              <div className="gdpr-consent-content">
                <h4>Data & Privacy Notice</h4>
                <p>
                  By creating a profile, you agree that we store your wallet address, username, display name, and bio.
                  Your posts, reposts, and social connections will also be stored. You can export or delete all your data
                  at any time from your profile settings. We follow data minimization principles and only store what is
                  necessary to provide the service.
                </p>
                <div className="gdpr-consent-actions">
                  <button className="gdpr-accept-btn" onClick={() => setGdprAccepted(true)}>I Understand & Accept</button>
                  <button className="gdpr-decline-btn" onClick={onClose}>Cancel</button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="prof-create-field">
                <label>Username</label>
                <div className="prof-create-username-wrap">
                  <span className="prof-create-prefix">C/</span>
                  <input
                    type="text"
                    placeholder="your_name"
                    value={username}
                    onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24))}
                    className="prof-create-input"
                  />
                </div>
              </div>
              <div className="prof-create-field">
                <label>Display Name</label>
                <input
                  type="text"
                  placeholder="Display Name (optional)"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value.slice(0, 64))}
                  className="prof-create-input prof-create-input-full"
                />
              </div>
              <div className="prof-create-field">
                <label>Bio</label>
                <textarea
                  placeholder="Tell us about yourself..."
                  value={bio}
                  onChange={e => setBio(e.target.value.slice(0, 280))}
                  className="prof-create-textarea"
                  rows={3}
                />
              </div>
              {error && <div className="prof-create-error">{error}</div>}
              <button
                className="prof-create-submit"
                onClick={handleCreate}
                disabled={!username.trim() || username.trim().length < 3 || loading}
              >
                {loading ? 'Creating...' : 'Create Profile'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PrivacyDataSection({ profile, onDeleted }) {
  const { publicKey, signMessage } = useWallet()
  const navigate = useNavigate()
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [exportError, setExportError] = useState('')

  const walletSign = async (msg) => {
    const encodedMessage = new TextEncoder().encode(msg)
    if (signMessage) {
      const signed = await signMessage(encodedMessage)
      return btoa(String.fromCharCode(...new Uint8Array(signed)))
    }
    throw new Error('Wallet does not support message signing')
  }

  const handleExport = async () => {
    if (!publicKey || !profile) return
    setExporting(true)
    setExportError('')
    try {
      const signature = await walletSign(`Export data for ${profile.username}`)
      const res = await fetch(`${API}/profiles/${profile.username}/export`, {
        headers: {
          'x-wallet-address': publicKey.toBase58(),
          'x-wallet-signature': signature,
        },
      })
      const data = await res.json()
      if (data.ok) {
        const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${profile.username}_data_export.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        setExportError(data.error || 'Failed to export data')
      }
    } catch (e) {
      setExportError(e.message || 'Wallet signature required for export')
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async () => {
    if (!publicKey || !profile) return
    setDeleting(true)
    setDeleteError('')
    try {
      const signature = await walletSign(`Delete all data for ${profile.username}`)
      const res = await fetch(`${API}/profiles/${profile.username}/data`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58(),
        },
        body: JSON.stringify({ signature }),
      })
      const data = await res.json()
      if (data.ok) {
        if (onDeleted) onDeleted()
        navigate('/community')
      } else {
        setDeleteError(data.error || 'Failed to delete data')
      }
    } catch (e) {
      setDeleteError(e.message || 'Wallet signature required to confirm deletion')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="privacy-data-section">
      <h4 className="privacy-data-title">
        <Shield size={16} />
        Privacy & Data
      </h4>
      <p className="privacy-data-desc">
        You have control over your data. Export a copy of all your data or permanently delete your account and all associated content.
      </p>
      <div className="privacy-data-actions">
        <button
          className="privacy-export-btn"
          onClick={handleExport}
          disabled={exporting || !signMessage}
          title={!signMessage ? 'Your wallet does not support message signing' : ''}
        >
          <Download size={14} />
          {exporting ? 'Signing & Exporting...' : 'Export My Data'}
        </button>
        {exportError && <div className="prof-create-error">{exportError}</div>}
        {!showDeleteConfirm ? (
          <button
            className="privacy-delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 size={14} />
            Delete All My Data
          </button>
        ) : (
          <div className="privacy-delete-confirm">
            <div className="privacy-delete-warning">
              <AlertTriangle size={16} />
              <span>This will permanently delete your profile, all posts, reposts, and social connections. This action cannot be undone.</span>
            </div>
            {deleteError && <div className="prof-create-error">{deleteError}</div>}
            <div className="privacy-delete-confirm-actions">
              <button
                className="privacy-delete-confirm-btn"
                onClick={handleDelete}
                disabled={deleting || !signMessage}
              >
                {deleting ? 'Signing & Deleting...' : 'Yes, Delete Everything'}
              </button>
              <button
                className="privacy-delete-cancel-btn"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EditProfileModal({ profile, onClose, onUpdated }) {
  const { publicKey } = useWallet()
  const [displayName, setDisplayName] = useState(profile.display_name || '')
  const [bio, setBio] = useState(profile.bio || '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!publicKey) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/profiles/${profile.username}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58(),
        },
        body: JSON.stringify({
          displayName: displayName.trim(),
          bio: bio.trim(),
        }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || 'Failed to update')
      } else {
        onUpdated(data.profile)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="prof-create-modal" onClick={e => e.stopPropagation()}>
        <div className="prof-create-modal-header">
          <h3>Edit Profile</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="prof-create-modal-body">
          <div className="prof-create-field">
            <label>Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value.slice(0, 64))}
              className="prof-create-input prof-create-input-full"
            />
          </div>
          <div className="prof-create-field">
            <label>Bio</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value.slice(0, 280))}
              className="prof-create-textarea"
              rows={3}
            />
          </div>
          {error && <div className="prof-create-error">{error}</div>}
          <button
            className="prof-create-submit"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

const SHARE_CATEGORY_OPTIONS = ['Trading Analysis', 'Market Analysis', 'Technology', 'Institutional', 'Price Analysis', 'Research']

function ProfileShareModal({ post, onClose }) {
  const { publicKey } = useWallet()
  const [commentary, setCommentary] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : prev.length < 5 ? [...prev, tag] : prev
    )
  }

  const handleSubmit = async () => {
    if (!publicKey) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/reposts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58(),
        },
        body: JSON.stringify({
          original_post_id: post.id,
          commentary: commentary.trim(),
          category_tags: selectedTags,
        }),
      })
      const data = await res.json()
      if (data.ok) setDone(true)
    } catch {} finally {
      setSubmitting(false)
    }
  }

  const authorName = post.display_name || post.username || shortenAddress(post.author_wallet)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={e => e.stopPropagation()}>
        <div className="share-modal-header">
          <h3><Repeat2 size={18} /> Share Post</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="share-modal-body">
          {done ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <Repeat2 size={32} style={{ color: 'var(--accent-purple)', marginBottom: '12px' }} />
              <p style={{ color: '#fff', fontSize: '16px' }}>Post shared to community feed!</p>
              <button className="share-submit-btn" onClick={onClose} style={{ marginTop: '16px' }}>Done</button>
            </div>
          ) : (
            <>
              <div className="share-original-preview">
                <div className="share-original-meta">
                  <span className="share-original-author">C/{post.username || shortenAddress(post.author_wallet)}</span>
                  <span className="feed-meta-dot">·</span>
                  <span>{authorName}</span>
                  <span className="feed-meta-dot">·</span>
                  <span>{timeAgo(post.created_at)}</span>
                </div>
                {post.title && <h4 className="share-original-title">{post.title}</h4>}
                {post.body && <p className="share-original-body">{post.body.length > 150 ? post.body.slice(0, 150) + '...' : post.body}</p>}
              </div>
              <div className="share-field">
                <label>Your Commentary</label>
                <textarea
                  className="share-textarea"
                  placeholder="Add your thoughts..."
                  value={commentary}
                  onChange={e => setCommentary(e.target.value)}
                  maxLength={2000}
                  rows={3}
                />
                <span className="share-char-count">{commentary.length}/2000</span>
              </div>
              <div className="share-field">
                <label>Category Tags</label>
                <div className="share-tags">
                  {SHARE_CATEGORY_OPTIONS.map(tag => (
                    <button
                      key={tag}
                      className={`share-tag-chip ${selectedTags.includes(tag) ? 'active' : ''}`}
                      style={selectedTags.includes(tag) ? { background: TAG_COLORS[tag] || '#7b61ff' } : {}}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="share-submit-btn"
                onClick={handleSubmit}
                disabled={submitting || !publicKey}
              >
                {submitting ? 'Sharing...' : !publicKey ? 'Connect Wallet to Share' : 'Share Post'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Profile() {
  const { username } = useParams()
  const navigate = useNavigate()
  const { connected, publicKey } = useWallet()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sortBy, setSortBy] = useState('Hot')
  const [showCreateProfile, setShowCreateProfile] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [posts, setPosts] = useState([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [shareTarget, setShareTarget] = useState(null)

  const isOwner = connected && publicKey && profile && profile.wallet === publicKey.toBase58()

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      setLoading(true)
      setNotFound(false)
      try {
        const viewerWallet = publicKey ? publicKey.toBase58() : ''
        const res = await fetch(`${API}/profiles/${username}${viewerWallet ? `?viewer=${viewerWallet}` : ''}`)
        const data = await res.json()
        if (cancelled) return
        if (!data.ok) {
          setNotFound(true)
          setProfile(null)
        } else {
          setProfile(data.profile)
        }
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadProfile()
    return () => { cancelled = true }
  }, [username, publicKey])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    async function loadPosts() {
      setPostsLoading(true)
      try {
        const res = await fetch(`${API}/posts?wallet=${profile.wallet}`)
        const data = await res.json()
        if (!cancelled && data.ok) setPosts(data.posts || [])
      } catch {} finally {
        if (!cancelled) setPostsLoading(false)
      }
    }
    loadPosts()
    return () => { cancelled = true }
  }, [profile?.wallet])

  const sortedPosts = useMemo(() => {
    const list = [...posts]
    switch (sortBy) {
      case 'New':
        return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      case 'Top':
        return list.sort((a, b) => (b.votes || 0) - (a.votes || 0))
      case 'Rising': {
        const now = Date.now()
        return list.sort((a, b) => {
          const ageA = (now - new Date(a.created_at).getTime()) / 3600000 || 1
          const ageB = (now - new Date(b.created_at).getTime()) / 3600000 || 1
          return ((b.votes || 0) / ageB) - ((a.votes || 0) / ageA)
        })
      }
      case 'Hot':
      default: {
        const now = Date.now()
        return list.sort((a, b) => {
          const ageA = (now - new Date(a.created_at).getTime()) / 3600000 + 2
          const ageB = (now - new Date(b.created_at).getTime()) / 3600000 + 2
          return ((b.votes || 0) / Math.pow(ageB, 1.5)) - ((a.votes || 0) / Math.pow(ageA, 1.5))
        })
      }
    }
  }, [sortBy, posts])

  const handleDeletePost = async (postId) => {
    if (!publicKey) return
    try {
      const res = await fetch(`${API}/posts/${postId}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': publicKey.toBase58() },
      })
      const data = await res.json()
      if (data.ok) setPosts(prev => prev.filter(p => p.id !== postId))
    } catch {}
  }

  const handleFollow = async () => {
    if (!connected || !publicKey || !profile) return
    setFollowLoading(true)
    try {
      await fetch(`${API}/profiles/${profile.username}/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58(),
        },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      })
      setProfile(prev => ({ ...prev, isFollowing: true, followers: (prev.followers || 0) + 1 }))
    } catch {} finally {
      setFollowLoading(false)
    }
  }

  const handleUnfollow = async () => {
    if (!connected || !publicKey || !profile) return
    setFollowLoading(true)
    try {
      await fetch(`${API}/profiles/${profile.username}/follow?wallet=${publicKey.toBase58()}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': publicKey.toBase58() },
      })
      setProfile(prev => ({ ...prev, isFollowing: false, followers: Math.max(0, (prev.followers || 1) - 1) }))
    } catch {} finally {
      setFollowLoading(false)
    }
  }

  const handleJoin = async () => {
    if (!connected || !publicKey || !profile) return
    try {
      await fetch(`${API}/profiles/${profile.username}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58(),
        },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      })
      setProfile(prev => ({ ...prev, isMember: true, members: (prev.members || 0) + 1 }))
    } catch {}
  }

  const handleLeave = async () => {
    if (!connected || !publicKey || !profile) return
    try {
      await fetch(`${API}/profiles/${profile.username}/join?wallet=${publicKey.toBase58()}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': publicKey.toBase58() },
      })
      setProfile(prev => ({ ...prev, isMember: false, members: Math.max(0, (prev.members || 1) - 1) }))
    } catch {}
  }

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
          <div className="dash-loading-spinner" />
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="page-container">
        <div className="prof-not-found">
          <Users size={48} />
          <h2>Profile Not Found</h2>
          <p>C/{username} doesn't exist yet.</p>
          {connected && (
            <button className="prof-create-cta" onClick={() => setShowCreateProfile(true)}>
              Create Your Profile
            </button>
          )}
        </div>
        {showCreateProfile && (
          <CreateProfileModal
            onClose={() => setShowCreateProfile(false)}
            onCreated={(p) => {
              setShowCreateProfile(false)
              navigate(`/C/${p.username}`, { replace: true })
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="prof-container">
        <div className="prof-main">
          <div className="feed-sort-bar">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt}
                className={`feed-sort-btn ${sortBy === opt ? 'active' : ''}`}
                onClick={() => setSortBy(opt)}
              >
                {opt === 'Hot' && <Flame size={14} />} {opt === 'New' && <Sparkles size={14} />} {opt === 'Top' && <TrendingUp size={14} />} {opt === 'Rising' && <Rocket size={14} />} {opt}
              </button>
            ))}
          </div>

          <div className="feed-posts">
            {postsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                <div className="dash-loading-spinner" />
              </div>
            ) : sortedPosts.length === 0 ? (
              <div className="prof-no-posts">
                <p>No posts yet.</p>
                {isOwner && <p style={{ color: 'var(--accent-purple)', fontSize: '13px' }}>Click "Create Post" to share something!</p>}
              </div>
            ) : (
              sortedPosts.map(post => (
                <UserPostCard
                  key={post.id}
                  post={post}
                  isAuthor={isOwner}
                  onDelete={handleDeletePost}
                  onShare={setShareTarget}
                />
              ))
            )}
          </div>
        </div>

        <ProfileSidebar
          profile={profile}
          isOwner={isOwner}
          isFollowing={profile.isFollowing}
          isMember={profile.isMember}
          onFollow={handleFollow}
          onUnfollow={handleUnfollow}
          onJoin={handleJoin}
          onLeave={handleLeave}
          onEdit={() => setShowEditProfile(true)}
          onCreatePost={() => setShowCreatePost(true)}
        />
      </div>

      {isOwner && profile && (
        <PrivacyDataSection profile={profile} />
      )}

      {showEditProfile && profile && (
        <EditProfileModal
          profile={profile}
          onClose={() => setShowEditProfile(false)}
          onUpdated={(p) => {
            setProfile(prev => ({ ...prev, ...p }))
            setShowEditProfile(false)
          }}
        />
      )}

      {showCreatePost && (
        <CreatePostModal
          onClose={() => setShowCreatePost(false)}
          onCreated={(newPost) => {
            setPosts(prev => [{ ...newPost, username: profile.username, display_name: profile.display_name, avatar_url: profile.avatar_url }, ...prev])
            setShowCreatePost(false)
          }}
        />
      )}

      {shareTarget && (
        <ProfileShareModal
          post={shareTarget}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  )
}

export default Profile
