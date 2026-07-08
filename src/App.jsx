import ResumeAIPreview from './resume-ai-preview'
import AdminPortal from './admin-portal'
import HelpPortal from './help-portal'

// Three surfaces share one build, chosen at runtime:
//   * help.hireaster.com        -> the public support center (HelpPortal)
//   * <any host>/admin/*        -> the internal Admin Portal
//   * everything else           -> the customer-facing site (ResumeAIPreview)
// The help subdomain is a domain alias on the same Vercel project.
export default function App() {
  if (typeof window !== 'undefined') {
    if (window.location.hostname.startsWith('help.')) return <HelpPortal />
    if (window.location.pathname.startsWith('/admin')) return <AdminPortal />
  }
  return <ResumeAIPreview />
}
