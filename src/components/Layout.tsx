import React from 'react'
import { useAuth } from '../contexts/AuthContext'
import { 
  BookOpen, 
  MessageCircle, 
  Brain, 
  Users, 
  LogOut, 
  FileText,
  Trophy,
  Menu,
  X
} from 'lucide-react'

interface LayoutProps {
  children: React.ReactNode
  currentPage: string
  onPageChange: (page: string) => void
}

export default function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  const { user, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = React.useState(false)

  const navigation = [
    { id: 'documents', name: 'Documents', icon: FileText },
    { id: 'chat', name: 'Q&A Chat', icon: MessageCircle },
    { id: 'quiz', name: 'Self Quiz', icon: Brain },
    { id: 'team', name: 'Team Challenge', icon: Users },
  ]

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  const handleNavigation = (page: string) => {
    onPageChange(page)
    // Close sidebar on mobile after navigation
    if (window.innerWidth < 768) {
      setSidebarOpen(false)
    }
  }
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              {/* Mobile menu button */}
              <button
                onClick={toggleSidebar}
                className="md:hidden p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                aria-label="Toggle navigation"
              >
                {sidebarOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
              
              <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 bg-primary-600 rounded-lg">
                <Trophy className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg sm:text-xl font-bold text-gray-900">Formula Student Trainer</h1>
                <p className="text-xs sm:text-sm text-gray-500">CTM Quiz Training Platform</p>
              </div>
              <div className="sm:hidden">
                <h1 className="text-lg font-bold text-gray-900">FS Trainer</h1>
              </div>
            </div>
            
            <div className="flex items-center space-x-2 sm:space-x-4">
              <span className="text-xs sm:text-sm text-gray-600 hidden md:inline truncate max-w-32 sm:max-w-none">
                Welcome, {user?.email}
              </span>
              <button
                onClick={signOut}
                className="flex items-center space-x-1 sm:space-x-2 text-gray-600 hover:text-gray-900 transition-colors p-2 rounded-lg hover:bg-gray-100"
              >
                <LogOut className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="text-xs sm:text-sm">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <nav className={`
          fixed md:relative inset-y-0 left-0 z-30 
          w-64 bg-white shadow-sm border-r border-gray-200 
          transform transition-transform duration-300 ease-in-out
          md:translate-x-0 md:w-16 lg:w-64
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="p-2 sm:p-4 h-full">
            {/* Mobile close button */}
            <div className="flex justify-end mb-4 md:hidden">
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-2">
              {navigation.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavigation(item.id)}
                    className={`nav-link w-full text-left justify-center md:justify-center lg:justify-start ${
                      currentPage === item.id ? 'active' : ''
                    }`}
                    title={item.name}
                  >
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="md:hidden lg:inline">{item.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-auto md:ml-0">
          <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}