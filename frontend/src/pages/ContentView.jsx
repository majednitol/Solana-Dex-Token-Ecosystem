import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, Heart, MessageCircle, Share2 } from 'lucide-react'

const API_BASE = '/api'

function timeAgo(dateStr) {
  if (!dateStr) return ''
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

function extractYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

function isVideoUrl(url) {
  if (!url) return false
  return /\.(mp4|webm|ogg)(\?|$)/i.test(url)
}

function VideoEmbed({ url }) {
  const youtubeId = extractYouTubeId(url)

  if (youtubeId) {
    return (
      <div className="cv-video-embed">
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}`}
          title="Video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  if (isVideoUrl(url)) {
    return (
      <div className="cv-video-embed cv-video-native">
        <video controls preload="metadata" style={{ width: '100%', height: '100%' }}>
          <source src={url} />
        </video>
      </div>
    )
  }

  return (
    <div className="cv-external-video">
      <a href={url} target="_blank" rel="noopener noreferrer" className="cv-external-link">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span>Watch Video</span>
      </a>
    </div>
  )
}

function ContentView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/announcements')
    }
  }, [navigate])

  useEffect(() => {
    if (!id) { setNotFound(true); setLoading(false); return }

    setLoading(true)
    setNotFound(false)

    const postId = id.startsWith('network-') ? id.replace('network-', '') : id

    fetch(`${API_BASE}/network-posts/${postId}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.post) {
          setPost(data.post)
        } else {
          setNotFound(true)
        }
        setLoading(false)
      })
      .catch(() => {
        setNotFound(true)
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return (
      <div className="page-container">
        <div className="cv-wrapper">
          <button className="cv-back-btn" onClick={goBack}>
            <ArrowLeft size={18} />
            <span>Back to Feed</span>
          </button>
          <div className="cv-loading">Loading post...</div>
        </div>
      </div>
    )
  }

  if (notFound || !post) {
    return (
      <div className="page-container">
        <div className="cv-wrapper">
          <button className="cv-back-btn" onClick={goBack}>
            <ArrowLeft size={18} />
            <span>Back to Feed</span>
          </button>
          <div className="cv-not-found">
            <h2>Post not found</h2>
            <p>The content you're looking for doesn't exist or has been removed.</p>
          </div>
        </div>
      </div>
    )
  }

  const authorName = post.display_name || post.username || walletShort(post.author_wallet)

  return (
    <div className="page-container">
      <div className="cv-wrapper">
        <button className="cv-back-btn" onClick={goBack}>
          <ArrowLeft size={18} />
          <span>Back to Feed</span>
        </button>

        <article className="cv-article">
          <div className="cv-meta-bar">
            {post.category && post.category !== 'General' && (
              <span className="cv-tag">{post.category}</span>
            )}
            {post.category && post.category !== 'General' && (
              <span className="cv-meta-sep">·</span>
            )}
            <span className="cv-author">{authorName}</span>
            <span className="cv-meta-sep">·</span>
            <span className="cv-time"><Clock size={12} /> {timeAgo(post.created_at)}</span>
          </div>

          {post.title && <h1 className="cv-title">{post.title}</h1>}

          {post.media_url && post.media_type === 'video' && (
            <VideoEmbed url={post.media_url} />
          )}

          {post.media_url && post.media_type === 'image' && (
            <div className="cv-hero-image">
              <img src={post.media_url} alt={post.title || 'Post image'} />
            </div>
          )}

          {post.body && (
            <div className="cv-body">
              {post.body.split('\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          )}

          <div className="cv-stats-bar">
            <span className="cv-stat"><Heart size={14} /> {Number(post.likes_count) || 0} likes</span>
            <span className="cv-stat"><MessageCircle size={14} /> {Number(post.comments_count) || 0} comments</span>
          </div>

          <div className="cv-action-bar">
            <button className="cv-action-btn" onClick={() => {
              const url = `${window.location.origin}/networks/post/${post.id}`
              navigator.clipboard.writeText(url)
            }}>
              <Share2 size={16} /> Share
            </button>
          </div>
        </article>
      </div>
    </div>
  )
}

export default ContentView
