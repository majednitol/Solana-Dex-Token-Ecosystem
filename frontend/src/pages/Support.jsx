import { useState } from 'react'
import { useLanguage } from '../stores/useLanguageStore'

function Support() {
  const { t } = useLanguage()
  const [showContactForm, setShowContactForm] = useState(false)
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' })
  const [formStatus, setFormStatus] = useState(null)

  function handleChange(e) {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!formData.name || !formData.email || !formData.message) return
    setFormStatus('sending')
    try {
      const res = await fetch('/api/support/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Failed to send message')
      setFormStatus('sent')
      setTimeout(() => {
        setShowContactForm(false)
        setFormStatus(null)
        setFormData({ name: '', email: '', subject: '', message: '' })
      }, 2000)
    } catch {
      setFormStatus(null)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('support_title')}</h1>
        <p>{t('support_desc')}</p>
      </div>

      <div className="info-card">
        <h3>{t('support_contact')}</h3>
        <p style={{ marginTop: '8px', lineHeight: '1.6' }}>
          {t('support_contact_desc')}
        </p>
        <div style={{ marginTop: '12px' }}>
          <button className="nav-btn primary" onClick={() => setShowContactForm(true)}>{t('support_email')}</button>
        </div>
      </div>

      <div className="info-card" style={{ marginTop: '16px' }}>
        <h3>{t('support_faq')}</h3>
        <div style={{ marginTop: '16px' }}>
          {[
            { q: t('support_faq_q1'), a: t('support_faq_a1') },
            { q: t('support_faq_q2'), a: t('support_faq_a2') },
            { q: t('support_faq_q3'), a: t('support_faq_a3') },
            { q: t('support_faq_q4'), a: t('support_faq_a4') },
            { q: t('support_faq_q5'), a: t('support_faq_a5') },
          ].map((faq, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--border-color)', padding: '12px 0' }}>
              <div style={{ fontWeight: '500', fontSize: '14px', marginBottom: '6px' }}>{faq.q}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>{faq.a}</div>
            </div>
          ))}
        </div>
      </div>

      {showContactForm && (
        <div className="modal-overlay" onClick={() => { if (formStatus !== 'sending') { setShowContactForm(false); setFormStatus(null) } }}>
          <div className="support-form-modal" onClick={e => e.stopPropagation()}>
            {formStatus === 'sent' ? (
              <div className="support-form-success">
                <div className="support-success-icon">✓</div>
                <h3>{t('support_form_sent')}</h3>
                <p>{t('support_form_reply')}</p>
              </div>
            ) : (
              <>
                <div className="support-form-header">
                  <div>
                    <h3>{t('support_form_title')}</h3>
                    <p>Fill in the form below and we'll respond as soon as possible.</p>
                  </div>
                  <button className="modal-close" onClick={() => setShowContactForm(false)}>✕</button>
                </div>
                <form className="support-form" onSubmit={handleSubmit}>
                  <div className="support-form-row">
                    <div className="support-form-field">
                      <label>{t('support_form_name')} *</label>
                      <input
                        type="text"
                        name="name"
                        placeholder="Your full name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                      />
                    </div>
                    <div className="support-form-field">
                      <label>{t('support_form_email')} *</label>
                      <input
                        type="email"
                        name="email"
                        placeholder="your@email.com"
                        value={formData.email}
                        onChange={handleChange}
                        required
                      />
                    </div>
                  </div>
                  <div className="support-form-field">
                    <label>{t('support_form_subject')}</label>
                    <select name="subject" value={formData.subject} onChange={handleChange}>
                      <option value="">Select a topic</option>
                      <option value="account">Account Issue</option>
                      <option value="transaction">Transaction Problem</option>
                      <option value="swap">Swap Issue</option>
                      <option value="wallet">Wallet Connection</option>
                      <option value="staking">Staking Question</option>
                      <option value="bug">Bug Report</option>
                      <option value="feature">Feature Request</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="support-form-field">
                    <label>{t('support_form_message')} *</label>
                    <textarea
                      name="message"
                      placeholder="Describe your issue or question in detail..."
                      rows={5}
                      value={formData.message}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="support-form-submit"
                    disabled={formStatus === 'sending'}
                  >
                    {formStatus === 'sending' ? (
                      <span className="support-sending">
                        <span className="dash-loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                        {t('support_form_sending')}
                      </span>
                    ) : t('support_form_send')}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Support
