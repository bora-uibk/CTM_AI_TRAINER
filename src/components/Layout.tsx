import React, { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { 
  MessageCircle, 
  Brain, 
  Users, 
  LogOut, 
  FileText,
  Trophy,
  Menu,
  ChevronLeft,
  ChevronRight,
  Crown,
  X // Added for closing the QR modal
} from 'lucide-react'

interface LayoutProps {
  children: React.ReactNode
  currentPage: string
  onPageChange: (page: string) => void
}

export default function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  const { user, signOut, isAdmin } = useAuth()
  
  // Default to true (open), we will adjust in useEffect for mobile
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // State for the QR Code Modal
  const [showQrModal, setShowQrModal] = useState(false)

  // Auto-collapse sidebar on mobile/tablet initialization
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false)
      } else {
        setSidebarOpen(true)
      }
    }

    // Set initial state based on current width
    handleResize()

    // Optional: Add event listener if you want it to auto-adjust on resize
    // window.addEventListener('resize', handleResize)
    // return () => window.removeEventListener('resize', handleResize)
  }, [])

  const baseNavigation = [
    { id: 'chat', name: 'Q&A Chat', icon: MessageCircle },
    { id: 'quiz', name: 'Self Quiz', icon: Brain },
    { id: 'team', name: 'Team Challenge', icon: Users },
  ]
  
  const adminNavigation = [
    { id: 'documents', name: 'Documents', icon: FileText },
    ...baseNavigation,
    { id: 'admin', name: 'Admin Panel', icon: Crown },
  ]
  
  const navigation = isAdmin ? adminNavigation : baseNavigation

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  const handleNavigation = (page: string) => {
    onPageChange(page)
    // Close sidebar on mobile ONLY after navigation
    if (window.innerWidth < 768) {
      setSidebarOpen(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      
      {/* --- QR CODE MODAL --- */}
      {showQrModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={() => setShowQrModal(false)}
          />
          {/* Modal Content */}
          <div className="relative bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full animate-in zoom-in duration-300">
            <button 
              onClick={() => setShowQrModal(false)}
              className="absolute -top-12 right-0 p-2 text-white hover:text-gray-300 transition-colors"
            >
              <X className="w-8 h-8" />
            </button>
            <div className="text-center">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Access QR Code</h3>
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 shadow-inner">
                <img 
                  src="https://i.postimg.cc/fTFRQ7dX/Screenshot-2026-01-14-231030.png" 
                  alt="QR Code"
                  className="w-full h-auto rounded-lg mx-auto"
                />
              </div>
              <p className="mt-4 text-sm text-gray-500">Scan to access trainer</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 z-40 sticky top-0">
        <div className="w-full px-3 sm:px-4 lg:px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Toggle Button - Visible on ALL screens now */}
              <button
                onClick={toggleSidebar}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                aria-label="Toggle navigation"
              >
                {sidebarOpen ? (
                  <div className="flex items-center">
                    <ChevronLeft className="w-6 h-6 hidden md:block" />
                    <Menu className="w-6 h-6 md:hidden" />
                  </div>
                ) : (
                  <div className="flex items-center">
                     <Menu className="w-6 h-6" />
                  </div>
                )}
              </button>
              
              <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 bg-primary-600 rounded-lg shrink-0">
                <Trophy className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
              </div>
              
              <div className={`${!sidebarOpen && 'hidden sm:block'}`}>
                 <h1 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">
                   Formula Student
                 </h1>
                 <p className="text-xs text-gray-500 hidden sm:block">Trainer Platform</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-sm font-medium text-gray-700">
                  {user?.email?.split('@')[0]}
                  {isAdmin && <Crown className="w-3 h-3 text-yellow-500 ml-1" />}
                </span>
                <span className="text-xs text-gray-500">{isAdmin ? 'Administrator' : 'Student'}</span>
              </div>
              
              <div className="h-8 w-px bg-gray-200 hidden md:block"></div>

              <button
                onClick={signOut}
                className="flex items-center gap-2 text-gray-600 hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-red-50"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
                <span className="hidden sm:inline text-sm font-medium">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile Overlay - Only visible on mobile when open */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-gray-900/50 z-20 md:hidden backdrop-blur-sm transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar Navigation */}
        <aside 
          className={`
            fixed md:relative z-30 h-full bg-white border-r border-gray-200 
            transition-all duration-300 ease-in-out flex flex-col
            ${sidebarOpen 
              ? 'translate-x-0 w-64' 
              : '-translate-x-full w-64 md:translate-x-0 md:w-20'
            }
          `}
        >
          <div className="flex-1 py-6 overflow-y-auto overflow-x-hidden">
            <nav className="space-y-1 px-3">
              {navigation.map((item) => {
                const Icon = item.icon
                const isActive = currentPage === item.id
                
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavigation(item.id)}
                    className={`
                      relative group w-full flex items-center p-3 rounded-lg transition-all duration-200
                      ${isActive 
                        ? 'bg-primary-50 text-primary-700 font-medium' 
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }
                      ${!sidebarOpen && 'md:justify-center'}
                    `}
                    title={!sidebarOpen ? item.name : ''}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-600 rounded-r-full" />
                    )}

                    <Icon 
                      className={`
                        shrink-0 w-5 h-5 transition-colors
                        ${isActive ? 'text-primary-600' : 'text-gray-500 group-hover:text-gray-700'}
                      `} 
                    />
                    
                    <span 
                      className={`
                        ml-3 whitespace-nowrap transition-all duration-300 origin-left
                        ${sidebarOpen 
                          ? 'opacity-100 translate-x-0' 
                          : 'md:opacity-0 md:w-0 md:hidden'
                        }
                      `}
                    >
                      {item.name}
                    </span>

                    {/* Desktop Hover Tooltip (Bubble) */}
                    {!sidebarOpen && (
                      <div className="
                        absolute left-full top-1/2 -translate-y-1/2 ml-4 px-2 py-1 
                        bg-gray-900 text-white text-xs rounded opacity-0 invisible 
                        group-hover:opacity-100 group-hover:visible transition-all 
                        z-50 whitespace-nowrap hidden md:block pointer-events-none
                      ">
                        {item.name}
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 -ml-1 border-4 border-transparent border-r-gray-900" />
                      </div>
                    )}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Footer of Sidebar */}
          <div className="p-4 border-t border-gray-100">
   <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs shrink-0">
        {user?.email?.charAt(0).toUpperCase()}
      </div>
      <div className={`flex-1 min-w-0 transition-all duration-300 ${!sidebarOpen && 'md:hidden'}`}>
        <p className="text-sm font-medium text-gray-700 truncate">User</p>
        <button 
          onClick={() => setShowQrModal(true)}
          className="text-xs text-primary-600 hover:text-primary-700 font-semibold transition-colors"
        >
          Show QR
        </button>
      </div>
   </div>
</div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 lg:p-8 w-full">
          <div className="max-w-6xl mx-auto animate-in fade-in duration-500">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}