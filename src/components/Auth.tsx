import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Trophy, Mail, Lock, CircleAlert as AlertCircle, ArrowLeft } from 'lucide-react'

export default function Auth() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [isResetPassword, setIsResetPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetMessage, setResetMessage] = useState('')

  const { signIn, signUp, resetPassword } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResetMessage('')

    try {
      let result
      if (isResetPassword) {
        result = await resetPassword(email)
        if (!result.error) {
          setResetMessage('Password reset email sent! Check your inbox.')
          setIsResetPassword(false)
          setEmail('')
        }
      } else {
        result = isSignUp 
          ? await signUp(email, password)
          : await signIn(email, password)
      }

      if (result.error) {
        setError(result.error.message)
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-3 sm:p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center w-16 h-16 bg-primary-600 rounded-2xl mx-auto mb-4">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            Formula Student Trainer
          </h1>
          <p className="text-sm sm:text-base text-gray-600">
            CTM Quiz Training Platform
          </p>
        </div>

        <div className="card">
          <div className="mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
              {isResetPassword ? 'Reset Password' : isSignUp ? 'Create Account' : 'Welcome Back'}
            </h2>
            <p className="text-sm sm:text-base text-gray-600">
              {isResetPassword
                ? 'Enter your email to receive a password reset link'
                : isSignUp 
                  ? 'Join your team and start training' 
                  : 'Sign in to continue your training'
              }
            </p>
          </div>

          {resetMessage && (
            <div className="mb-4 p-3 bg-success-50 border border-success-200 rounded-lg flex items-start space-x-2">
              <div className="w-5 h-5 text-success-600 flex-shrink-0 mt-0.5">✓</div>
              <span className="text-success-700 text-sm">{resetMessage}</span>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-danger-50 border border-danger-200 rounded-lg flex items-start space-x-2">
              <AlertCircle className="w-5 h-5 text-danger-600" />
              <span className="text-danger-700 text-sm">{error}</span>
            </div>
          )}

          {isResetPassword && (
            <button
              type="button"
              onClick={() => {
                setIsResetPassword(false)
                setError('')
                setResetMessage('')
              }}
              className="mb-4 flex items-center space-x-2 text-primary-600 hover:text-primary-700 text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Sign In</span>
            </button>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field pl-10"
                  placeholder="Enter your email"
                  required
                />
              </div>
            </div>

            {!isResetPassword && (
              <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-10"
                  placeholder="Enter your password"
                  required
                  minLength={6}
                />
              </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? (
                <span className="loading-dots">
                  {isResetPassword ? 'Sending Reset Email' : isSignUp ? 'Creating Account' : 'Signing In'}
                </span>
              ) : (
                isResetPassword ? 'Send Reset Email' : isSignUp ? 'Create Account' : 'Sign In'
              )}
            </button>
          </form>

          <div className="mt-6 text-center space-y-2">
            {!isResetPassword && (
              <button
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-primary-600 hover:text-primary-700 text-sm font-medium block w-full"
              >
                {isSignUp 
                  ? 'Already have an account? Sign in' 
                  : "Don't have an account? Sign up"
                }
              </button>
            )}
            
            {!isSignUp && !isResetPassword && (
              <button
                onClick={() => {
                  setIsResetPassword(true)
                  setError('')
                  setPassword('')
                }}
                className="text-gray-600 hover:text-primary-600 text-sm"
              >
                Forgot your password?
              </button>
            )}
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Powered by AI • Secure • Real-time Collaboration</p>
        </div>
      </div>
    </div>
  )
}