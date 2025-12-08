import React, { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Auth from './components/Auth'
import Documents from './pages/Documents'
import Chat from './pages/Chat'
import Quiz from './pages/Quiz'
import Team from './pages/Team'
import Admin from './pages/Admin'
import { Loader } from 'lucide-react'

function AppContent() {
  const { user, loading, isAdmin } = useAuth()
  const [currentPage, setCurrentPage] = useState('documents')

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 animate-spin text-primary-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Auth />
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'documents':
        return isAdmin ? <Documents /> : <div className="text-center py-12"><p className="text-gray-600">Access restricted to administrators</p></div>
      case 'chat':
        return <Chat />
      case 'quiz':
        return <Quiz />
      case 'team':
        return <Team />
      case 'admin':
        return <Admin />
      default:
        return isAdmin ? <Documents /> : <Chat />
    }
  }

  return (
    <Layout currentPage={currentPage} onPageChange={setCurrentPage}>
      {renderPage()}
    </Layout>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App