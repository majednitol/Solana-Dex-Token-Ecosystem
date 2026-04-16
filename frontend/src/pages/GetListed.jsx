import { useLanguage } from '../stores/useLanguageStore'
import { ClipboardList } from 'lucide-react'

function GetListed() {
  const { t } = useLanguage()

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('get_listed_title')}</h1>
        <p>{t('get_listed_desc')}</p>
      </div>

      <div className="api-coming-soon-banner">
        <div className="api-banner-icon"><ClipboardList size={32} /></div>
        <div className="api-banner-content">
          <h2>{t('api_coming_soon')}</h2>
          <p>{t('get_listed_banner_text')}</p>
          <div className="api-banner-actions">
            <button className="nav-btn primary">{t('get_listed_stay_tuned')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GetListed
