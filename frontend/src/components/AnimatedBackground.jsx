import { useEffect, useRef } from 'react'

function AnimatedBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animationId
    let mouseX = 0
    let mouseY = 0
    let particles = []
    let orbs = []

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    resize()
    window.addEventListener('resize', resize)

    const w = () => canvas.offsetWidth
    const h = () => canvas.offsetHeight

    class Particle {
      constructor() {
        this.reset()
      }
      reset() {
        this.x = Math.random() * w()
        this.y = Math.random() * h()
        this.size = Math.random() * 2 + 0.5
        this.speedX = (Math.random() - 0.5) * 0.4
        this.speedY = (Math.random() - 0.5) * 0.4
        this.opacity = Math.random() * 0.5 + 0.1
        const colors = ['168,85,247', '0,214,143', '99,102,241']
        this.color = colors[Math.floor(Math.random() * colors.length)]
      }
      update() {
        const dx = mouseX - this.x
        const dy = mouseY - this.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 150) {
          const force = (150 - dist) / 150
          this.x -= dx * force * 0.01
          this.y -= dy * force * 0.01
        }
        this.x += this.speedX
        this.y += this.speedY
        if (this.x < 0 || this.x > w()) this.speedX *= -1
        if (this.y < 0 || this.y > h()) this.speedY *= -1
      }
      draw() {
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${this.color},${this.opacity})`
        ctx.fill()
      }
    }

    class Orb {
      constructor(x, y, radius, color, speed) {
        this.baseX = x
        this.baseY = y
        this.x = x
        this.y = y
        this.radius = radius
        this.color = color
        this.speed = speed
        this.angle = Math.random() * Math.PI * 2
        this.drift = Math.random() * 40 + 20
      }
      update() {
        this.angle += this.speed
        this.x = this.baseX + Math.cos(this.angle) * this.drift
        this.y = this.baseY + Math.sin(this.angle * 0.7) * this.drift

        const dx = mouseX - this.x
        const dy = mouseY - this.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 200) {
          const force = (200 - dist) / 200
          this.x += dx * force * 0.02
          this.y += dy * force * 0.02
        }
      }
      draw() {
        const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius)
        gradient.addColorStop(0, this.color.replace(')', ',0.15)').replace('rgb', 'rgba'))
        gradient.addColorStop(0.5, this.color.replace(')', ',0.05)').replace('rgb', 'rgba'))
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2)
        ctx.fillStyle = gradient
        ctx.fill()
      }
    }

    const initParticles = () => {
      particles = []
      for (let i = 0; i < 80; i++) {
        particles.push(new Particle())
      }
    }

    const initOrbs = () => {
      orbs = [
        new Orb(w() * 0.3, h() * 0.3, 180, 'rgb(168,85,247)', 0.008),
        new Orb(w() * 0.7, h() * 0.6, 200, 'rgb(0,214,143)', 0.006),
        new Orb(w() * 0.5, h() * 0.5, 150, 'rgb(99,102,241)', 0.01),
        new Orb(w() * 0.2, h() * 0.7, 120, 'rgb(168,85,247)', 0.007),
        new Orb(w() * 0.8, h() * 0.3, 130, 'rgb(0,214,143)', 0.009),
      ]
    }

    const drawConnections = () => {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            const opacity = (1 - dist / 120) * 0.15
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(168,85,247,${opacity})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }
    }

    const animate = () => {
      ctx.clearRect(0, 0, w(), h())

      orbs.forEach(orb => {
        orb.update()
        orb.draw()
      })

      particles.forEach(p => {
        p.update()
        p.draw()
      })

      drawConnections()

      animationId = requestAnimationFrame(animate)
    }

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      mouseX = e.clientX - rect.left
      mouseY = e.clientY - rect.top
    }

    canvas.addEventListener('mousemove', handleMouseMove)

    initParticles()
    initOrbs()
    animate()

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="animated-bg-canvas"
    />
  )
}

export default AnimatedBackground
