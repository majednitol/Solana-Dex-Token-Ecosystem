import { useState, useEffect, useRef } from 'react'

function IntroSplash({ onComplete }) {
  const [fading, setFading] = useState(false)
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 0.6
      videoRef.current.play().catch(() => {})
    }

    const fadeTimer = setTimeout(() => {
      setFading(true)
    }, 2500)

    const removeTimer = setTimeout(() => {
      onComplete()
    }, 3300)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(removeTimer)
    }
  }, [onComplete])

  return (
    <div className={`intro-splash ${fading ? 'fade-out' : ''}`}>
      <video
        ref={videoRef}
        src="/intro.mp4"
        autoPlay
        muted
        playsInline
        className="intro-video"
      />
    </div>
  )
}

export default IntroSplash
