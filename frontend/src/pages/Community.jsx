import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { Flame, Sparkles, TrendingUp, Video, FileText, Repeat2, X, Plus, UserPlus, RefreshCw, Upload, Shield, Camera } from 'lucide-react'
import { useLanguage } from '../stores/useLanguageStore'
import { TAG_COLORS } from '../data/contentData'

const API = import.meta.env.VITE_API_URL || '/api'

const CATEGORY_OPTIONS = ['Trading Analysis', 'Market Analysis', 'Technology', 'Institutional', 'Price Analysis', 'Research']

function formatVotes(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return (n || 0).toString()
}

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

function toEmbedUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`
    if ((u.hostname === 'youtube.com' || u.hostname === 'www.youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) return `https://www.youtube.com/embed/${u.pathname.replace('/shorts/', '')}`
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

function GDPRConsentNotice({ onAccept, onDecline }) {
  return (
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
          <button className="gdpr-accept-btn" onClick={onAccept}>I Understand & Accept</button>
          <button className="gdpr-decline-btn" onClick={onDecline}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function CreateProfileModalCommunity({ onClose, onCreated }) {
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
            <GDPRConsentNotice
              onAccept={() => setGdprAccepted(true)}
              onDecline={onClose}
            />
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

function CreatePostModalCommunity({ onClose, onCreated, profile }) {
  const { publicKey } = useWallet()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('General')
  const [mediaFile, setMediaFile] = useState(null)
  const [mediaPreview, setMediaPreview] = useState(null)
  const [mediaType, setMediaType] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef(null)

  const categories = ['General', 'Trading', 'Analysis', 'News', 'Meme', 'Tutorial', 'Discussion']

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isImage) { setError('Only image or video files are allowed.'); return }
    setMediaFile(file)
    setMediaType(isVideo ? 'video' : 'image')
    setError('')
    if (isImage) {
      const reader = new FileReader()
      reader.onloadend = () => setMediaPreview(reader.result)
      reader.readAsDataURL(file)
    } else {
      setMediaPreview(URL.createObjectURL(file))
    }
  }

  const removeMedia = () => {
    setMediaFile(null)
    setMediaPreview(null)
    setMediaType(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async () => {
    if (!publicKey) return
    if (!title.trim()) { setError('Title is required'); return }
    if (!body.trim()) { setError('Body is required'); return }
    setError('')
    setLoading(true)
    try {
      let imageUrl = ''
      let videoUrl = ''
      let postType = 'blog'

      if (mediaFile) {
        setUploading(true)
        const formData = new FormData()
        formData.append('file', mediaFile)
        const uploadRes = await fetch(`${API}/posts/upload-media`, {
          method: 'POST',
          headers: { 'x-wallet-address': publicKey.toBase58() },
          body: formData,
        })
        const uploadData = await uploadRes.json()
        setUploading(false)
        if (!uploadData.ok) { setError(uploadData.error || 'Upload failed'); setLoading(false); return }
        if (mediaType === 'video') {
          videoUrl = uploadData.url
          postType = 'video'
        } else {
          imageUrl = uploadData.url
        }
      }

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
          videoUrl,
          category,
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      onCreated({ ...data.post, username: profile?.username, display_name: profile?.display_name, avatar_url: profile?.avatar_url })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setUploading(false)
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
          <div className="prof-create-field">
            <label>Category</label>
            <div className="post-category-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
            <label>Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 256))}
              placeholder="Post title (optional)..."
              className="prof-create-input prof-create-input-full"
            />
          </div>

          <div className="prof-create-field">
            <label>Content</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value.slice(0, 10000))}
              placeholder="Write your post content..."
              className="prof-create-textarea post-body-textarea"
              rows={4}
            />
          </div>

          <div className="prof-create-field">
            <label>Media (Image or Video)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {mediaPreview ? (
              <div className="post-image-preview" style={{ position: 'relative' }}>
                {mediaType === 'video' ? (
                  <video src={mediaPreview} style={{ width: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <img src={mediaPreview} alt="Preview" style={{ width: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'cover' }} />
                )}
                <button className="post-image-remove" onClick={removeMedia}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label
                className="ann-create-upload-area"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', border: '2px dashed rgba(255,255,255,0.15)', borderRadius: 10, cursor: 'pointer', gap: 8, background: 'rgba(255,255,255,0.03)' }}
                onClick={() => fileInputRef.current?.click()}
              >
                <span style={{ display: 'flex', gap: 8, color: 'rgba(255,255,255,0.5)' }}>
                  <Camera size={20} />
                  <Video size={20} />
                </span>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  {uploading ? 'Uploading...' : 'Click to upload image or video'}
                </span>
              </label>
            )}
          </div>

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

function ShareModal({ post, onClose, onShared }) {
  const { publicKey } = useWallet()
  const [commentary, setCommentary] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [submitting, setSubmitting] = useState(false)

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
      if (data.ok) {
        onShared(data.repost)
        onClose()
      }
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
              {CATEGORY_OPTIONS.map(tag => (
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
        </div>
      </div>
    </div>
  )
}

function OriginalPostEmbed({ post }) {
  const navigate = useNavigate()
  const authorName = post.display_name || post.username || shortenAddress(post.author_wallet)
  const profileLink = post.username ? `/C/${post.username}` : null

  return (
    <div className="repost-embedded-original">
      <div className="feed-post-meta">
        {profileLink ? (
          <span className="feed-subreddit" onClick={() => navigate(profileLink)} style={{ cursor: 'pointer' }}>C/{post.username}</span>
        ) : (
          <span className="feed-subreddit">{shortenAddress(post.author_wallet)}</span>
        )}
        <span className="feed-meta-dot">·</span>
        <span className="feed-post-by">Posted by <span className="feed-username">{authorName}</span></span>
        <span className="feed-meta-dot">·</span>
        <span className="feed-post-time">{timeAgo(post.created_at)}</span>
        {post.type === 'video' && <span className="feed-post-type-badge feed-post-type-video"><Video size={11} /> Video</span>}
        {post.type === 'blog' && <span className="feed-post-type-badge feed-post-type-blog"><FileText size={11} /> Blog</span>}
      </div>
      {post.title && <h3 className="feed-post-title">{post.title}</h3>}
      {post.category && post.category !== 'General' && (
        <span className="feed-post-tag" style={{ background: TAG_COLORS[post.category] || '#7b61ff' }}>{post.category}</span>
      )}
      {post.body && <p className="feed-post-body">{post.body.length > 200 ? post.body.slice(0, 200) + '...' : post.body}</p>}
      {post.image_url && (
        <div className="feed-post-image">
          <img src={post.image_url.startsWith('/') ? `${API.replace('/api', '')}${post.image_url}` : post.image_url} alt={post.title || 'Post image'} loading="lazy" />
        </div>
      )}
      {post.video_url && /youtube\.com|youtu\.be|vimeo\.com/.test(post.video_url) && (
        <div className="feed-post-video">
          <iframe src={toEmbedUrl(post.video_url)} title={post.title || 'Video'} allowFullScreen style={{ width: '100%', height: '200px', borderRadius: '8px', border: 'none' }} />
        </div>
      )}
      {post.video_url && /res\.cloudinary\.com/.test(post.video_url) && (
        <div className="feed-post-video">
          <video src={post.video_url} controls style={{ width: '100%', maxHeight: '300px', borderRadius: '8px' }} />
        </div>
      )}
    </div>
  )
}

function RepostCard({ item, onShare }) {
  const navigate = useNavigate()
  const reposterName = item.reposter_display_name || item.reposter_username || shortenAddress(item.reposter_wallet)
  const reposterLink = item.reposter_username ? `/C/${item.reposter_username}` : null
  const tags = Array.isArray(item.category_tags) ? item.category_tags : (typeof item.category_tags === 'string' ? JSON.parse(item.category_tags || '[]') : [])

  return (
    <div className="feed-post repost-card">
      <div className="feed-post-vote">
        <Repeat2 size={16} className="repost-icon" />
      </div>
      <div className="feed-post-content">
        <div className="repost-header">
          <Repeat2 size={13} className="repost-icon-inline" />
          {reposterLink ? (
            <span className="feed-subreddit" onClick={() => navigate(reposterLink)} style={{ cursor: 'pointer' }}>C/{item.reposter_username}</span>
          ) : (
            <span className="feed-subreddit">{shortenAddress(item.reposter_wallet)}</span>
          )}
          <span className="repost-label">shared</span>
          <span className="feed-meta-dot">·</span>
          <span className="feed-post-time">{timeAgo(item.reposted_at)}</span>
        </div>

        {item.commentary && (
          <p className="repost-commentary">{item.commentary}</p>
        )}

        {tags.length > 0 && (
          <div className="repost-tags">
            {tags.map(tag => (
              <span key={tag} className="feed-post-tag" style={{ background: TAG_COLORS[tag] || '#7b61ff' }}>{tag}</span>
            ))}
          </div>
        )}

        {item.original && <OriginalPostEmbed post={item.original} />}

        <div className="feed-post-actions" onClick={e => e.stopPropagation()}>
          {item.original && (
            <button className="feed-action-btn" onClick={() => onShare && onShare(item.original)}>
              <span className="feed-action-icon"><Repeat2 size={14} /></span>
              <span>Share</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CommunityPostCard({ post, onShare }) {
  const navigate = useNavigate()
  const [voted, setVoted] = useState(null)
  const [voteCount, setVoteCount] = useState(post.votes || 0)
  const [expanded, setExpanded] = useState(false)

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
        <button className={`feed-vote-btn ${voted === 'up' ? 'voted-up' : ''}`} onClick={(e) => handleVote('up', e)}>&#9650;</button>
        <span className={`feed-vote-count ${voted === 'up' ? 'voted-up' : voted === 'down' ? 'voted-down' : ''}`}>{formatVotes(voteCount)}</span>
        <button className={`feed-vote-btn ${voted === 'down' ? 'voted-down' : ''}`} onClick={(e) => handleVote('down', e)}>&#9660;</button>
      </div>
      <div className="feed-post-content">
        <div className="feed-post-meta">
          {profileLink ? (
            <span className="feed-subreddit" onClick={() => navigate(profileLink)} style={{ cursor: 'pointer' }}>C/{post.username}</span>
          ) : (
            <span className="feed-subreddit">{shortenAddress(post.author_wallet)}</span>
          )}
          <span className="feed-meta-dot">·</span>
          <span className="feed-post-by">Posted by <span className="feed-username">{authorName}</span></span>
          <span className="feed-meta-dot">·</span>
          <span className="feed-post-time">{timeAgo(post.created_at)}</span>
          {post.type === 'video' && <span className="feed-post-type-badge feed-post-type-video"><Video size={11} /> Video</span>}
          {post.type === 'blog' && <span className="feed-post-type-badge feed-post-type-blog"><FileText size={11} /> Blog</span>}
        </div>
        {post.title && <h3 className="feed-post-title">{post.title}</h3>}
        {post.category && post.category !== 'General' && (
          <span className="feed-post-tag" style={{ background: TAG_COLORS[post.category] || '#7b61ff' }}>{post.category}</span>
        )}
        {post.body && (
          <div className="feed-post-body">
            <p>{expanded || post.body.length <= 300 ? post.body : post.body.slice(0, 300) + '...'}</p>
            {post.body.length > 300 && (
              <button className="feed-see-more-btn" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}>
                {expanded ? 'See less' : 'See more'}
              </button>
            )}
          </div>
        )}
        {post.image_url && (
          <div className="feed-post-image">
            <img src={post.image_url.startsWith('/') ? `${API.replace('/api', '')}${post.image_url}` : post.image_url} alt={post.title || 'Post image'} loading="lazy" />
          </div>
        )}
        {post.video_url && /youtube\.com|youtu\.be|vimeo\.com/.test(post.video_url) && (
          <div className="feed-post-video">
            <iframe src={toEmbedUrl(post.video_url)} title={post.title || 'Video'} allowFullScreen style={{ width: '100%', height: '280px', borderRadius: '8px', border: 'none' }} />
          </div>
        )}
        {post.video_url && /res\.cloudinary\.com/.test(post.video_url) && (
          <div className="feed-post-video">
            <video src={post.video_url} controls style={{ width: '100%', maxHeight: '400px', borderRadius: '8px' }} />
          </div>
        )}
        <div className="feed-post-actions" onClick={(e) => e.stopPropagation()}>
          <button className="feed-action-btn" onClick={() => onShare && onShare(post)}>
            <span className="feed-action-icon"><Repeat2 size={14} /></span>
            <span>Share</span>
          </button>
        </div>
      </div>
    </div>
  )
}

const SORT_OPTIONS = ['New', 'Top', 'Hot']

function Community() {
  const { t } = useLanguage()
  const [searchParams] = useSearchParams()
  const highlightPostId = searchParams.get('post')
  const highlightRef = useRef(null)
  const { connected, publicKey } = useWallet()
  const [feedItems, setFeedItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sortBy, setSortBy] = useState('New')
  const [shareTarget, setShareTarget] = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [showCreateProfile, setShowCreateProfile] = useState(false)
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [feedError, setFeedError] = useState('')
  const autoRefreshRef = useRef(null)

  useEffect(() => {
    if (!connected || !publicKey) {
      setMyProfile(null)
      return
    }
    let cancelled = false
    async function checkProfile() {
      setProfileLoading(true)
      try {
        const res = await fetch(`${API}/profiles/me`, {
          headers: { 'x-wallet-address': publicKey.toBase58() },
        })
        const data = await res.json()
        if (!cancelled && data.ok) {
          setMyProfile(data.profile)
        }
      } catch {} finally {
        if (!cancelled) setProfileLoading(false)
      }
    }
    checkProfile()
    return () => { cancelled = true }
  }, [connected, publicKey])

  const loadFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setFeedError('')
    try {
      const res = await fetch(`${API}/feed?limit=100`)
      if (!res.ok) throw new Error('Failed to load feed')
      const data = await res.json()
      if (data.ok) {
        let items = data.items || []
        if (highlightPostId && !items.find(i => String(i.id) === String(highlightPostId))) {
          try {
            const postRes = await fetch(`${API}/posts/${highlightPostId}`)
            const postData = await postRes.json()
            if (postData.ok && postData.post) {
              const target = postData.post
              items = [{ ...target, feed_type: 'post', feed_date: target.created_at }, ...items]
            }
          } catch {}
        }
        setFeedItems(items)
      }
    } catch (err) {
      setFeedError(err.message || 'Failed to load feed')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [highlightPostId])

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  useEffect(() => {
    autoRefreshRef.current = setInterval(() => {
      loadFeed(true)
    }, 60000)
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
    }
  }, [loadFeed])

  useEffect(() => {
    if (!loading && highlightPostId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [loading, highlightPostId])

  const sortedItems = [...feedItems].sort((a, b) => {
    if (sortBy === 'Top') return ((b.votes || b.original?.votes || 0)) - ((a.votes || a.original?.votes || 0))
    if (sortBy === 'Hot') {
      const now = Date.now()
      const ageA = (now - new Date(a.feed_date).getTime()) / 3600000 + 2
      const ageB = (now - new Date(b.feed_date).getTime()) / 3600000 + 2
      const vA = a.votes || a.original?.votes || 0
      const vB = b.votes || b.original?.votes || 0
      return (vB / Math.pow(ageB, 1.5)) - (vA / Math.pow(ageA, 1.5))
    }
    return new Date(b.feed_date) - new Date(a.feed_date)
  })

  const handleShared = (repost) => {
    setFeedItems(prev => [{
      feed_type: 'repost',
      feed_date: repost.created_at,
      repost_id: repost.id,
      reposter_wallet: repost.reposter_wallet,
      commentary: repost.commentary,
      category_tags: repost.category_tags,
      reposted_at: repost.created_at,
      original: shareTarget,
    }, ...prev])
  }

  const handlePostCreated = (newPost) => {
    setFeedItems(prev => [{
      ...newPost,
      feed_type: 'post',
      feed_date: newPost.created_at,
    }, ...prev])
    setShowCreatePost(false)
  }

  const handleProfileCreated = (profile) => {
    setMyProfile(profile)
    setShowCreateProfile(false)
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('community_title')}</h1>
        <p>{t('community_desc')}</p>
      </div>

      {connected && !profileLoading && !myProfile && (
        <div className="community-create-profile-banner">
          <div className="community-banner-content">
            <UserPlus size={24} />
            <div>
              <h3>Join the Community</h3>
              <p>Create your profile to start posting, sharing, and connecting with others.</p>
            </div>
          </div>
          <button className="community-create-profile-btn" onClick={() => setShowCreateProfile(true)}>
            Create Profile
          </button>
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <h2 style={{ color: '#fff', fontSize: '20px', margin: 0 }}>Community Feed</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {connected && myProfile && (
              <button className="community-create-post-btn" onClick={() => setShowCreatePost(true)}>
                <Plus size={16} />
                Create Post
              </button>
            )}
            <button
              className="community-refresh-btn"
              onClick={() => loadFeed(true)}
              disabled={refreshing}
              title="Refresh feed"
            >
              <RefreshCw size={16} className={refreshing ? 'spinning' : ''} />
            </button>
          </div>
        </div>
        <div className="feed-sort-bar">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt}
              className={`feed-sort-btn ${sortBy === opt ? 'active' : ''}`}
              onClick={() => setSortBy(opt)}
            >
              {opt === 'Hot' && <Flame size={14} />} {opt === 'New' && <Sparkles size={14} />} {opt === 'Top' && <TrendingUp size={14} />} {opt}
            </button>
          ))}
        </div>
        <div className="feed-posts">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <div className="dash-loading-spinner" />
            </div>
          ) : feedError ? (
            <div className="prof-no-posts">
              <p style={{ color: '#ef4444' }}>{feedError}</p>
              <button className="community-refresh-btn" onClick={() => loadFeed()} style={{ marginTop: '12px' }}>
                <RefreshCw size={16} /> Try Again
              </button>
            </div>
          ) : sortedItems.length === 0 ? (
            <div className="prof-no-posts">
              <p>No community posts yet. Create a profile and start posting!</p>
            </div>
          ) : (
            sortedItems.map((item, idx) => {
              const isHighlighted = highlightPostId && String(item.id) === String(highlightPostId)
              if (item.feed_type === 'repost') {
                return <RepostCard key={`repost-${item.repost_id || idx}`} item={item} onShare={setShareTarget} />
              }
              return (
                <div key={`post-${item.id || idx}`} ref={isHighlighted ? highlightRef : null} className={isHighlighted ? 'feed-post-highlighted' : ''}>
                  <CommunityPostCard post={item} onShare={setShareTarget} />
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="community-social-strip">
        <a href="https://discord.gg/cryptonite" target="_blank" rel="noopener noreferrer" className="community-social-chip">
          <span className="community-social-icon">Discord</span>
          <span className="community-social-stat">12.4K</span>
        </a>
        <a href="https://x.com/cryptonite" target="_blank" rel="noopener noreferrer" className="community-social-chip">
          <span className="community-social-icon">X / Twitter</span>
          <span className="community-social-stat">45.8K</span>
        </a>
        <a href="https://t.me/cryptonite" target="_blank" rel="noopener noreferrer" className="community-social-chip">
          <span className="community-social-icon">Telegram</span>
          <span className="community-social-stat">8.2K</span>
        </a>
      </div>

      <div className="info-card" style={{ marginTop: '16px' }}>
        <h3>{t('community_guidelines')}</h3>
        <p style={{ marginTop: '8px', lineHeight: '1.6' }}>
          {t('community_guidelines_text')}
        </p>
      </div>

      {shareTarget && (
        <ShareModal
          post={shareTarget}
          onClose={() => setShareTarget(null)}
          onShared={handleShared}
        />
      )}

      {showCreateProfile && (
        <CreateProfileModalCommunity
          onClose={() => setShowCreateProfile(false)}
          onCreated={handleProfileCreated}
        />
      )}

      {showCreatePost && myProfile && (
        <CreatePostModalCommunity
          onClose={() => setShowCreatePost(false)}
          onCreated={handlePostCreated}
          profile={myProfile}
        />
      )}
    </div>
  )
}

export default Community
