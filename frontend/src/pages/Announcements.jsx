import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useLanguage } from '../stores/useLanguageStore'
import { useAdmin } from '../hooks/useAdminHook'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  Flame, Sparkles, TrendingUp, Rocket, Camera, Video, X,
  Heart, MessageCircle, Share2, Trash2, Send, ChevronDown, ChevronUp, Upload, Edit2
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

const SORT_OPTIONS = ['Hot', 'New', 'Top', 'Rising']
const API_BASE = '/api'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function walletShort(wallet) {
  if (!wallet) return 'Unknown'
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`
}

function Avatar({ url, name, size = 32 }) {
  const letter = (name || '?')[0].toUpperCase()
  if (url) {
    return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #7b61ff, #00d18c)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.4, flexShrink: 0
    }}>
      {letter}
    </div>
  )
}

const WORD_TRUNCATE_LIMIT = 100

function truncateWords(text, limit) {
  if (!text) return { truncated: '', isTruncated: false }
  const words = text.split(/\s+/)
  if (words.length <= limit) return { truncated: text, isTruncated: false }
  return { truncated: words.slice(0, limit).join(' '), isTruncated: true }
}

function NetworkPost({ post: initialPost, viewerWallet, isAdmin, adminRole, canPost, onDelete, onRefresh, highlighted }) {
  const [post, setPost] = useState(initialPost)
  const [liked, setLiked] = useState(initialPost.liked_by_viewer || false)
  const [likesCount, setLikesCount] = useState(Number(initialPost.likes_count) || 0)
  const [commentsCount, setCommentsCount] = useState(Number(initialPost.comments_count) || 0)
  const [commentsOpen, setCommentsOpen] = useState(!!highlighted)
  const [comments, setComments] = useState([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [hasNtc, setHasNtc] = useState(null)
  const postRef = useRef(null)

  useEffect(() => {
    if (highlighted && postRef.current) {
      setTimeout(() => postRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
    }
  }, [highlighted])

  useEffect(() => {
    if (!commentsOpen || !viewerWallet || hasNtc !== null) return
    let cancelled = false
    async function checkNtcBalance() {
      try {
        const res = await fetch(`${API_BASE}/ntc-balance?wallet=${viewerWallet}`)
        if (cancelled) return
        const data = await res.json()
        setHasNtc(data.ok && data.balance > 0)
      } catch {
        if (!cancelled) setHasNtc(false)
      }
    }
    checkNtcBalance()
    return () => { cancelled = true }
  }, [commentsOpen, viewerWallet, hasNtc])

  useEffect(() => {
    setHasNtc(null)
  }, [viewerWallet])

  const authorName = post.display_name || post.username || walletShort(post.author_wallet)
  const { truncated: bodyTruncated, isTruncated: bodyIsTruncated } = truncateWords(post.body, WORD_TRUNCATE_LIMIT)

  const handleLike = async () => {
    if (!viewerWallet) return
    const nextLiked = !liked
    setLiked(nextLiked)
    setLikesCount(c => nextLiked ? c + 1 : Math.max(0, c - 1))
    try {
      const res = await fetch(`${API_BASE}/network-posts/${post.id}/like`, {
        method: 'POST',
        headers: { 'x-wallet-address': viewerWallet }
      })
      const data = await res.json()
      if (data.ok) {
        setLiked(data.liked)
        setLikesCount(data.likesCount)
      }
    } catch {}
  }

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/network-posts/${post.id}/comments`, {
        headers: viewerWallet ? { 'x-wallet-address': viewerWallet } : {}
      })
      const data = await res.json()
      if (data.ok) {
        setComments(data.comments)
        setCommentsLoaded(true)
      }
    } catch {}
  }, [post.id, viewerWallet])

  useEffect(() => {
    if (highlighted && !commentsLoaded) {
      loadComments()
    }
  }, [highlighted, commentsLoaded, loadComments])

  const handleOpenComments = async () => {
    const next = !commentsOpen
    setCommentsOpen(next)
    if (next && !commentsLoaded) {
      loadComments()
    }
  }

  const handleAddComment = async () => {
    if (!commentBody.trim() || !viewerWallet) return
    setSubmittingComment(true)
    try {
      const res = await fetch(`${API_BASE}/network-posts/${post.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': viewerWallet },
        body: JSON.stringify({ body: commentBody.trim() })
      })
      const data = await res.json()
      if (data.ok) {
        setComments(prev => [...prev, data.comment])
        setCommentsCount(c => c + 1)
        setCommentBody('')
      }
    } catch {}
    setSubmittingComment(false)
  }

  const handleDeleteComment = async (commentId) => {
    if (!viewerWallet) return
    try {
      const res = await fetch(`${API_BASE}/network-posts/${post.id}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': viewerWallet }
      })
      const data = await res.json()
      if (data.ok) {
        setComments(prev => prev.filter(c => String(c.id) !== String(commentId)))
        setCommentsCount(c => Math.max(0, c - 1))
      }
    } catch {}
  }

  const handleShare = () => {
    const url = `${window.location.origin}/networks/post/${post.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isOwnPost = viewerWallet && post.author_wallet === viewerWallet
  const canDeleteAsAdmin = isAdmin && (adminRole === 'owner' || adminRole === 'super_admin' || isOwnPost)
  const canDelete = canDeleteAsAdmin || (isOwnPost && canPost)
  const canEdit = isOwnPost && (isAdmin || canPost)

  const handleDelete = async () => {
    if (!canDelete || !viewerWallet) return
    if (!window.confirm('Delete this post?')) return
    try {
      const res = await fetch(`${API_BASE}/network-posts/${post.id}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': viewerWallet }
      })
      const data = await res.json()
      if (data.ok && onDelete) onDelete(post.id)
    } catch {}
  }

  return (
    <div
      ref={postRef}
      className={`feed-post net-feed-post${highlighted ? ' feed-post-highlighted' : ''}`}
    >
      <div className="net-post-header">
        <Avatar url={post.avatar_url} name={authorName} size={36} />
        <div className="net-post-author-info">
          <span className="net-post-author-name">{authorName}</span>
          <span className="net-post-time">{timeAgo(post.created_at)}</span>
        </div>
        {viewerWallet && (canEdit || canDelete) && (
          <div className="net-post-admin-actions">
            {canEdit && (
              <button className="net-post-edit-btn" onClick={() => setShowEditModal(true)} title="Edit post">
                <Edit2 size={14} />
              </button>
            )}
            {canDelete && (
              <button className="net-post-delete-btn" onClick={handleDelete} title="Delete post">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="net-post-body">
        {post.title && <h3 className="net-post-title">{post.title}</h3>}
        {post.category && post.category !== 'General' && (
          <span className="net-post-category">{post.category}</span>
        )}
        {post.body && (
          <p className="net-post-text">
            {expanded || !bodyIsTruncated ? post.body : `${bodyTruncated}...`}
            {bodyIsTruncated && (
              <button
                className="net-read-more-btn"
                onClick={() => setExpanded(e => !e)}
              >
                {expanded ? ' Show less' : ' Read more'}
              </button>
            )}
          </p>
        )}

        {post.media_url && post.media_type === 'image' && (
          <div className="net-post-image">
            <img src={post.media_url} alt={post.title || 'Post media'} loading="lazy" />
          </div>
        )}

        {post.media_url && post.media_type === 'video' && (
          <div className="net-post-video">
            <video
              src={post.media_url}
              controls
              preload="metadata"
              style={{ width: '100%', display: 'block' }}
            />
          </div>
        )}
      </div>

      <div className="net-post-actions">
        <button
          className={`net-action-btn net-like-btn ${liked ? 'active' : ''}`}
          onClick={handleLike}
          disabled={!viewerWallet}
          title={viewerWallet ? (liked ? 'Unlike' : 'Like') : 'Connect wallet to like'}
        >
          <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
          <span>{likesCount}</span>
        </button>

        <button className="net-action-btn" onClick={handleOpenComments}>
          <MessageCircle size={15} />
          <span>{commentsCount}</span>
          {commentsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        <button className={`net-action-btn ${copied ? 'net-copied' : ''}`} onClick={handleShare}>
          <Share2 size={15} />
          <span>{copied ? 'Copied!' : 'Share'}</span>
        </button>
      </div>

      {commentsOpen && (
        <div className="net-comments-section">
          {commentsLoaded && comments.length === 0 && (
            <p className="net-no-comments">No comments yet. Be the first!</p>
          )}
          {comments.map(c => {
            const cName = c.display_name || c.username || walletShort(c.wallet)
            return (
              <div key={c.id} className="net-comment">
                <Avatar url={c.avatar_url} name={cName} size={26} />
                <div className="net-comment-content">
                  <div className="net-comment-header">
                    <span className="net-comment-author">{cName}</span>
                    <span className="net-comment-time">{timeAgo(c.created_at)}</span>
                    {(c.wallet === viewerWallet || isAdmin) && (
                      <button className="net-comment-delete" onClick={() => handleDeleteComment(c.id)}>
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <p className="net-comment-body">{c.body}</p>
                </div>
              </div>
            )
          })}

          {viewerWallet && hasNtc && (
            <div className="net-comment-input-row">
              <input
                className="net-comment-input"
                placeholder="Write a comment..."
                value={commentBody}
                onChange={e => setCommentBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment() } }}
                disabled={submittingComment}
              />
              <button
                className="net-comment-submit"
                onClick={handleAddComment}
                disabled={!commentBody.trim() || submittingComment}
              >
                <Send size={14} />
              </button>
            </div>
          )}
          {viewerWallet && hasNtc === null && commentsOpen && (
            <p className="net-no-comments" style={{ opacity: 0.6 }}>Checking NTC balance...</p>
          )}
          {viewerWallet && hasNtc === false && (
            <p className="net-no-comments">Hold NTC tokens to comment.</p>
          )}
          {!viewerWallet && (
            <p className="net-no-comments">Connect your wallet to comment.</p>
          )}
        </div>
      )}

      {showEditModal && canEdit && viewerWallet && (
        <EditPostModal
          post={post}
          onClose={() => setShowEditModal(false)}
          onUpdated={(updatedPost) => {
            setPost(prev => ({ ...prev, ...updatedPost }))
            setShowEditModal(false)
          }}
          viewerWallet={viewerWallet}
        />
      )}
    </div>
  )
}

function EditPostModal({ post, onClose, onUpdated, viewerWallet }) {
  const [form, setForm] = useState({
    title: post.title || '',
    body: post.body || '',
    category: post.category || 'General',
  })
  const [mediaFile, setMediaFile] = useState(null)
  const [mediaPreview, setMediaPreview] = useState(post.media_url || null)
  const [mediaType, setMediaType] = useState(post.media_type || null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef()

  const handleFileChange = (e) => {
    const file = e.target.files[0]
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
    if (!form.body.trim() && !form.title.trim()) { setError('Please add a title or body.'); return }
    setSubmitting(true)
    setError('')
    try {
      let mediaUrl = mediaPreview && !mediaFile ? (post.media_url || '') : ''
      let cloudinaryPublicId = mediaPreview && !mediaFile ? (post.cloudinary_public_id || '') : ''
      let uploadedMediaType = mediaPreview && !mediaFile ? (post.media_type || '') : ''

      if (mediaFile) {
        setUploading(true)
        const formData = new FormData()
        formData.append('file', mediaFile)
        const uploadRes = await fetch(`${API_BASE}/network-posts/upload`, {
          method: 'POST',
          headers: { 'x-wallet-address': viewerWallet },
          body: formData
        })
        const uploadData = await uploadRes.json()
        setUploading(false)
        if (!uploadData.ok) { setError(uploadData.error || 'Upload failed'); setSubmitting(false); return }
        mediaUrl = uploadData.url
        cloudinaryPublicId = uploadData.publicId
        uploadedMediaType = uploadData.mediaType
      }

      const res = await fetch(`${API_BASE}/network-posts/${post.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': viewerWallet },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim(),
          category: form.category,
          mediaUrl,
          cloudinaryPublicId,
          mediaType: uploadedMediaType || mediaType || ''
        })
      })
      const data = await res.json()
      if (data.ok) {
        onUpdated(data.post)
      } else {
        setError(data.error || 'Failed to update post')
      }
    } catch (e) {
      setError(e.message || 'Something went wrong')
    }
    setSubmitting(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="ann-create-modal" onClick={e => e.stopPropagation()}>
        <div className="ann-create-modal-header">
          <h3>Edit Post</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="ann-create-modal-body">
          {error && <div className="net-create-error">{error}</div>}

          <div className="ann-create-field">
            <label>Category</label>
            <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className="ann-create-select">
              <option value="General">General</option>
              <option value="Update">Update</option>
              <option value="Launch">Launch</option>
              <option value="Partnership">Partnership</option>
              <option value="Feature">Feature</option>
              <option value="Security">Security</option>
              <option value="Community">Community</option>
            </select>
          </div>

          <div className="ann-create-field">
            <label>Title</label>
            <input
              type="text"
              placeholder="Post title (optional)..."
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              className="ann-create-input"
            />
          </div>

          <div className="ann-create-field">
            <label>Content</label>
            <textarea
              placeholder="Write your post content..."
              value={form.body}
              onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
              className="ann-create-textarea"
              rows={5}
            />
          </div>

          <div className="ann-create-field">
            <label>Media (Image or Video)</label>
            {mediaPreview ? (
              <div className="ann-create-image-preview">
                {mediaType === 'video' ? (
                  <video src={mediaPreview} controls style={{ width: '100%', borderRadius: 8, maxHeight: 200 }} />
                ) : (
                  <img src={mediaPreview} alt="Preview" />
                )}
                <button className="ann-create-image-remove" onClick={removeMedia}><X size={14} /></button>
              </div>
            ) : (
              <label className="ann-create-upload-area">
                <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleFileChange} hidden />
                <span className="ann-create-upload-icon">
                  <Camera size={20} style={{ marginRight: 6 }} />
                  <Video size={20} />
                </span>
                <span className="ann-create-upload-text">Click to upload image or video</span>
              </label>
            )}
            {uploading && (
              <div className="net-upload-progress">
                <Upload size={14} />
                <span>Uploading media...</span>
              </div>
            )}
          </div>

          <button
            className="ann-create-submit"
            onClick={handleSubmit}
            disabled={submitting || uploading || (!form.title.trim() && !form.body.trim())}
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreatePostModal({ onClose, onCreated, viewerWallet }) {
  const [form, setForm] = useState({ title: '', body: '', category: 'General' })
  const [mediaFile, setMediaFile] = useState(null)
  const [mediaPreview, setMediaPreview] = useState(null)
  const [mediaType, setMediaType] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef()

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isImage) {
      setError('Only image or video files are allowed.')
      return
    }
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
    if (!form.body.trim() && !form.title.trim()) {
      setError('Please add a title or body.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      let mediaUrl = ''
      let cloudinaryPublicId = ''
      let uploadedMediaType = ''

      if (mediaFile) {
        setUploading(true)
        setUploadProgress('Uploading media...')
        const formData = new FormData()
        formData.append('file', mediaFile)
        const uploadRes = await fetch(`${API_BASE}/network-posts/upload`, {
          method: 'POST',
          headers: { 'x-wallet-address': viewerWallet },
          body: formData
        })
        const uploadData = await uploadRes.json()
        setUploading(false)
        setUploadProgress('')
        if (!uploadData.ok) {
          setError(uploadData.error || 'Upload failed')
          setSubmitting(false)
          return
        }
        mediaUrl = uploadData.url
        cloudinaryPublicId = uploadData.publicId
        uploadedMediaType = uploadData.mediaType
      }

      const res = await fetch(`${API_BASE}/network-posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': viewerWallet
        },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim(),
          category: form.category,
          mediaUrl,
          cloudinaryPublicId,
          mediaType: uploadedMediaType || mediaType || ''
        })
      })
      const data = await res.json()
      if (data.ok) {
        onCreated(data.post)
        onClose()
      } else {
        setError(data.error || 'Failed to create post')
      }
    } catch (e) {
      setError(e.message || 'Something went wrong')
    }
    setSubmitting(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="ann-create-modal" onClick={e => e.stopPropagation()}>
        <div className="ann-create-modal-header">
          <h3>Create New Post</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="ann-create-modal-body">
          {error && <div className="net-create-error">{error}</div>}

          <div className="ann-create-field">
            <label>Category</label>
            <select
              value={form.category}
              onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              className="ann-create-select"
            >
              <option value="General">General</option>
              <option value="Update">Update</option>
              <option value="Launch">Launch</option>
              <option value="Partnership">Partnership</option>
              <option value="Feature">Feature</option>
              <option value="Security">Security</option>
              <option value="Community">Community</option>
            </select>
          </div>

          <div className="ann-create-field">
            <label>Title</label>
            <input
              type="text"
              placeholder="Post title (optional)..."
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              className="ann-create-input"
            />
          </div>

          <div className="ann-create-field">
            <label>Content</label>
            <textarea
              placeholder="Write your post content..."
              value={form.body}
              onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
              className="ann-create-textarea"
              rows={5}
            />
          </div>

          <div className="ann-create-field">
            <label>Media (Image or Video)</label>
            {mediaPreview ? (
              <div className="ann-create-image-preview">
                {mediaType === 'video' ? (
                  <video src={mediaPreview} controls style={{ width: '100%', borderRadius: 8, maxHeight: 200 }} />
                ) : (
                  <img src={mediaPreview} alt="Preview" />
                )}
                <button className="ann-create-image-remove" onClick={removeMedia}><X size={14} /></button>
              </div>
            ) : (
              <label className="ann-create-upload-area">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                  hidden
                />
                <span className="ann-create-upload-icon">
                  <Camera size={20} style={{ marginRight: 6 }} />
                  <Video size={20} />
                </span>
                <span className="ann-create-upload-text">Click to upload image or video</span>
              </label>
            )}
            {uploading && (
              <div className="net-upload-progress">
                <Upload size={14} />
                <span>{uploadProgress}</span>
              </div>
            )}
          </div>

          <button
            className="ann-create-submit"
            onClick={handleSubmit}
            disabled={submitting || uploading || (!form.title.trim() && !form.body.trim())}
          >
            {submitting ? 'Publishing...' : 'Publish Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BlogSidebar({ activeTab, setActiveTab, onCreatePost, canPost }) {
  const navigate = useNavigate()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const sort = activeTab === 'top' ? 'top' : 'latest'
    fetch(`${API_BASE}/network-posts?limit=5&sort=${sort}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && Array.isArray(data.posts)) setPosts(data.posts)
        else setPosts([])
        setLoading(false)
      })
      .catch(() => { setPosts([]); setLoading(false) })
  }, [activeTab])

  return (
    <div className="ann-sidebar-wrapper">
      {canPost && (
        <button className="ann-create-post-btn" onClick={onCreatePost}>
          + New Post
        </button>
      )}
      <div className="ann-sidebar">
        <div className="ann-sidebar-header">Blog Posts</div>
        <div className="ann-tabs">
          <button className={`ann-tab ${activeTab === 'top' ? 'active' : ''}`} onClick={() => setActiveTab('top')}>Top</button>
          <button className={`ann-tab ${activeTab === 'latest' ? 'active' : ''}`} onClick={() => setActiveTab('latest')}>Latest</button>
        </div>
        <div className="ann-posts">
          {loading && <p className="ann-sidebar-loading">Loading...</p>}
          {!loading && posts.length === 0 && <p className="ann-sidebar-empty">No posts yet.</p>}
          {posts.map(post => {
            const authorName = post.display_name || post.username || walletShort(post.author_wallet)
            const summary = post.body ? post.body.split(/\s+/).slice(0, 20).join(' ') + (post.body.split(/\s+/).length > 20 ? '...' : '') : ''
            return (
              <div
                key={post.id}
                className="ann-post"
                onClick={() => navigate(`/post/${post.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <div className="ann-blog-tag-row">
                  {post.category && post.category !== 'General' && (
                    <span className="ann-blog-tag">{post.category}</span>
                  )}
                  <span className="ann-post-time">{timeAgo(post.created_at)}</span>
                </div>
                {post.title && <h4 className="ann-blog-title">{post.title}</h4>}
                {summary && <p className="ann-post-text">{summary}</p>}
                <div className="ann-blog-footer">
                  <span className="ann-blog-reads">{Number(post.likes_count) || 0} likes</span>
                  <span className="ann-blog-reads">{authorName}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Announcements() {
  const { t } = useLanguage()
  const { connected, publicKey } = useWallet()
  const { isAdmin, adminRole } = useAdmin()
  const { postId } = useParams()
  const viewerWallet = connected && publicKey ? publicKey.toBase58() : null

  const [sortBy, setSortBy] = useState('New')
  const [activeTab, setActiveTab] = useState('top')
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [canPost, setCanPost] = useState(false)

  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!viewerWallet) { setCanPost(false); return }
    if (isAdmin) { setCanPost(true); return }
    setCanPost(false)
    fetch(`${API_BASE}/network-post-permissions/check`, { headers: { 'x-wallet-address': viewerWallet } })
      .then(r => r.json())
      .then(data => { if (data.ok) setCanPost(!!data.permitted); else setCanPost(false) })
      .catch(() => { setCanPost(false) })
  }, [viewerWallet, isAdmin])

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const headers = {}
      if (viewerWallet) headers['x-wallet-address'] = viewerWallet
      const res = await fetch(`${API_BASE}/network-posts?limit=100`, { headers })
      const data = await res.json()
      if (data.ok && Array.isArray(data.posts)) {
        setPosts(data.posts)
      } else {
        setError(data.error || 'Failed to load posts')
      }
    } catch (e) {
      setError('Could not connect to the server')
    }
    setLoading(false)
  }, [viewerWallet])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  // If a postId deep-link is present and the post isn't in the fetched page,
  // fetch it individually and inject it so the highlight/scroll still works
  useEffect(() => {
    if (!postId || loading) return
    const alreadyInFeed = posts.some(p => String(p.id) === String(postId))
    if (alreadyInFeed) return
    const headers = {}
    if (viewerWallet) headers['x-wallet-address'] = viewerWallet
    fetch(`${API_BASE}/network-posts/${postId}`, { headers })
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.post) {
          setPosts(prev => {
            const alreadyThere = prev.some(p => String(p.id) === String(data.post.id))
            if (alreadyThere) return prev
            return [data.post, ...prev]
          })
        }
      })
      .catch(() => {})
  }, [postId, loading, posts, viewerWallet])

  const handlePostCreated = (newPost) => {
    setPosts(prev => [{ ...newPost, liked_by_viewer: false }, ...prev])
  }

  const handlePostDeleted = (postId) => {
    setPosts(prev => prev.filter(p => String(p.id) !== String(postId)))
  }

  const sortedPosts = useMemo(() => {
    const all = [...posts]
    switch (sortBy) {
      case 'New':
        return all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      case 'Top':
        return all.sort((a, b) => Number(b.likes_count) - Number(a.likes_count))
      case 'Rising': {
        const now = Date.now()
        return all.sort((a, b) => {
          const hoursA = Math.max(1, (now - new Date(a.created_at).getTime()) / 3600000)
          const hoursB = Math.max(1, (now - new Date(b.created_at).getTime()) / 3600000)
          return (Number(b.likes_count) / hoursB) - (Number(a.likes_count) / hoursA)
        })
      }
      case 'Hot':
      default: {
        const now = Date.now()
        return all.sort((a, b) => {
          const hoursA = Math.max(2, (now - new Date(a.created_at).getTime()) / 3600000)
          const hoursB = Math.max(2, (now - new Date(b.created_at).getTime()) / 3600000)
          const scoreA = Number(a.likes_count) / Math.pow(hoursA + 2, 1.5)
          const scoreB = Number(b.likes_count) / Math.pow(hoursB + 2, 1.5)
          return scoreB - scoreA
        })
      }
    }
  }, [posts, sortBy])

  return (
    <div className="page-container">
      <div className="feed-container">
        <div className="feed-main">
          <div className="feed-sort-bar">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt}
                className={`feed-sort-btn ${sortBy === opt ? 'active' : ''}`}
                onClick={() => setSortBy(opt)}
              >
                {opt === 'Hot' && <Flame size={14} />}
                {opt === 'New' && <Sparkles size={14} />}
                {opt === 'Top' && <TrendingUp size={14} />}
                {opt === 'Rising' && <Rocket size={14} />}
                {' '}{opt}
              </button>
            ))}
          </div>

          <div className="feed-posts">
            {loading && (
              <div className="net-loading">Loading posts...</div>
            )}
            {!loading && error && (
              <div className="net-error">{error}</div>
            )}
            {!loading && !error && sortedPosts.length === 0 && (
              <div className="net-empty">
                <p>No posts yet.</p>
                {canPost && (
                  <button className="ann-create-post-btn" onClick={() => setShowCreatePost(true)}>
                    Create the first post
                  </button>
                )}
              </div>
            )}
            {sortedPosts.map(post => (
              <NetworkPost
                key={post.id}
                post={post}
                viewerWallet={viewerWallet}
                isAdmin={isAdmin}
                adminRole={adminRole}
                canPost={canPost}
                onDelete={handlePostDeleted}
                onRefresh={fetchPosts}
                highlighted={postId && String(post.id) === String(postId)}
              />
            ))}
          </div>
        </div>

        <BlogSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onCreatePost={() => setShowCreatePost(true)}
          canPost={canPost}
        />
      </div>

      {showCreatePost && viewerWallet && canPost && (
        <CreatePostModal
          onClose={() => setShowCreatePost(false)}
          onCreated={handlePostCreated}
          viewerWallet={viewerWallet}
        />
      )}
    </div>
  )
}

export default Announcements
