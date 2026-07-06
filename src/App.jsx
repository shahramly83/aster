import ResumeAIPreview from './resume-ai-preview'
import AdminPortal from './admin-portal'

// The internal Admin Portal is a separate app mounted at /admin/*, fully
// isolated from the customer-facing site.
export default function App() {
  const isAdmin = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')
  return isAdmin ? <AdminPortal /> : <ResumeAIPreview />
}
