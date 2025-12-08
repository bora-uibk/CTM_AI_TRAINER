import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { 
  Users, 
  Shield, 
  ShieldOff, 
  Trash2, 
  Key, 
  Loader, 
  AlertCircle, 
  CheckCircle, 
  Crown,
  Mail,
  Calendar,
  Search,
  UserCheck,
  UserX
} from 'lucide-react'
import type { User } from '../lib/supabase'

interface Message {
  type: 'success' | 'error'
  text: string
}

export default function Admin() {
  const { user, isAdmin } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showPasswordModal, setShowPasswordModal] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    if (isAdmin) {
      fetchUsers()
    }
  }, [isAdmin])

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setUsers(data || [])
    } catch (error) {
      console.error('Error fetching users:', error)
      showMessage('error', 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const toggleAdminRole = async (userId: string, currentIsAdmin: boolean) => {
    if (userId === user?.id) {
      showMessage('error', 'You cannot change your own admin status')
      return
    }

    setActionLoading(userId)
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_admin: !currentIsAdmin })
        .eq('id', userId)

      if (error) throw error

      await fetchUsers()
      showMessage('success', `User ${!currentIsAdmin ? 'granted' : 'removed'} admin privileges`)
    } catch (error) {
      console.error('Error updating admin role:', error)
      showMessage('error', 'Failed to update admin role')
    } finally {
      setActionLoading(null)
    }
  }

  const deleteUser = async (userId: string, userEmail: string) => {
    if (userId === user?.id) {
      showMessage('error', 'You cannot delete your own account')
      return
    }

    if (!confirm(`Are you sure you want to delete user "${userEmail}"? This action cannot be undone.`)) {
      return
    }

    setActionLoading(userId)
    try {
      // Delete from auth.users (this will cascade to our users table)
      const { error } = await supabase.auth.admin.deleteUser(userId)

      if (error) throw error

      await fetchUsers()
      showMessage('success', 'User deleted successfully')
    } catch (error) {
      console.error('Error deleting user:', error)
      showMessage('error', 'Failed to delete user')
    } finally {
      setActionLoading(null)
    }
  }

  const changePassword = async (userId: string) => {
    if (!newPassword || newPassword.length < 6) {
      showMessage('error', 'Password must be at least 6 characters long')
      return
    }

    setActionLoading(userId)
    try {
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        password: newPassword
      })

      if (error) throw error

      setShowPasswordModal(null)
      setNewPassword('')
      showMessage('success', 'Password updated successfully')
    } catch (error) {
      console.error('Error changing password:', error)
      showMessage('error', 'Failed to change password')
    } finally {
      setActionLoading(null)
    }
  }

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You don't have permission to access this page.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Crown className="w-8 h-8 text-yellow-500 mr-3" />
            Admin Panel
          </h1>
          <p className="text-gray-600 mt-1">Manage users and system settings</p>
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-lg flex items-start space-x-2 ${
          message.type === 'success' 
            ? 'bg-success-50 border border-success-200' 
            : 'bg-danger-50 border border-danger-200'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-success-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-danger-600 flex-shrink-0 mt-0.5" />
          )}
          <span className={`text-sm ${message.type === 'success' ? 'text-success-700' : 'text-danger-700'}`}>
            {message.text}
          </span>
        </div>
      )}

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <Key className="w-5 h-5 mr-2" />
              Change Password
            </h3>
            <p className="text-gray-600 mb-4">
              Enter a new password for this user:
            </p>
            
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 6 characters)"
              className="input-field mb-4"
              minLength={6}
            />
            
            <div className="flex space-x-3">
              <button
                onClick={() => changePassword(showPasswordModal)}
                disabled={actionLoading === showPasswordModal || !newPassword}
                className="btn-primary flex-1"
              >
                {actionLoading === showPasswordModal ? (
                  <Loader className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  'Update Password'
                )}
              </button>
              <button
                onClick={() => {
                  setShowPasswordModal(null)
                  setNewPassword('')
                }}
                className="btn-secondary"
                disabled={actionLoading === showPasswordModal}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Management */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <Users className="w-5 h-5 mr-2" />
            User Management ({users.length})
          </h2>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field pl-10 w-64"
            />
          </div>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">User</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Role</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Joined</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                          <span className="text-primary-700 font-medium text-sm">
                            {u.email.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 flex items-center">
                            {u.email}
                            {u.id === user?.id && (
                              <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 flex items-center">
                            <Mail className="w-3 h-3 mr-1" />
                            {u.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center">
                        {u.is_admin ? (
                          <div className="flex items-center text-yellow-600">
                            <Crown className="w-4 h-4 mr-1" />
                            <span className="font-medium">Admin</span>
                          </div>
                        ) : (
                          <div className="flex items-center text-gray-600">
                            <UserCheck className="w-4 h-4 mr-1" />
                            <span>User</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center text-sm text-gray-500">
                        <Calendar className="w-3 h-3 mr-1" />
                        {new Date(u.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => toggleAdminRole(u.id, u.is_admin)}
                          disabled={actionLoading === u.id || u.id === user?.id}
                          className={`p-2 rounded-lg transition-colors ${
                            u.is_admin 
                              ? 'text-yellow-600 hover:bg-yellow-50' 
                              : 'text-gray-600 hover:bg-gray-100'
                          }`}
                          title={u.is_admin ? 'Remove admin role' : 'Grant admin role'}
                        >
                          {actionLoading === u.id ? (
                            <Loader className="w-4 h-4 animate-spin" />
                          ) : u.is_admin ? (
                            <ShieldOff className="w-4 h-4" />
                          ) : (
                            <Shield className="w-4 h-4" />
                          )}
                        </button>
                        
                        <button
                          onClick={() => setShowPasswordModal(u.id)}
                          disabled={actionLoading === u.id}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Change password"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        
                        <button
                          onClick={() => deleteUser(u.id, u.email)}
                          disabled={actionLoading === u.id || u.id === user?.id}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete user"
                        >
                          {actionLoading === u.id ? (
                            <Loader className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}