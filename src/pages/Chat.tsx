import React, { useState, useEffect, useRef } from 'react'
import { supabase, ChatMessage } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Send, Bot, User, Loader, FileText } from 'lucide-react'

export default function Chat() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Add welcome message
    setMessages([
      {
        id: '1',
        content: "Hello! I'm your Formula Student training assistant. I can help you with questions about the rulebook, regulations, and technical requirements. What would you like to know?",
        is_user: false,
        timestamp: new Date().toISOString(),
      }
    ])
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      content: input.trim(),
      is_user: true,
      timestamp: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const { data, error } = await supabase.functions.invoke('chat-rag', {
        body: { query: userMessage.content }
      })

      if (error) throw error

      const botMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: data.response,
        is_user: false,
        timestamp: new Date().toISOString(),
        sources: data.sources || []
      }

      setMessages(prev => [...prev, botMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: "I'm sorry, I encountered an error while processing your question. Please try again.",
        is_user: false,
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Q&A Chat</h1>
        <p className="text-gray-600 mt-1">
          Ask questions about Formula Student rules and regulations
        </p>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 card overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 sm:p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex items-start space-x-2 sm:space-x-3 ${
                message.is_user ? 'flex-row-reverse space-x-reverse' : ''
              }`}
            >
              <div className={`flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center ${
                message.is_user 
                  ? 'bg-primary-600 text-white' 
                  : 'bg-gray-200 text-gray-600'
              }`}>
                {message.is_user ? (
                  <User className="w-3 h-3 sm:w-4 sm:h-4" />
                ) : (
                  <Bot className="w-3 h-3 sm:w-4 sm:h-4" />
                )}
              </div>
              
              <div className={`flex-1 max-w-full sm:max-w-3xl ${
                message.is_user ? 'text-right' : 'text-left'
              }`}>
                <div className={`inline-block p-2 sm:p-3 rounded-lg max-w-full ${
                  message.is_user
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}>
                  <p className="whitespace-pre-wrap text-sm sm:text-base break-words">{message.content}</p>
                </div>
                
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-2 text-xs sm:text-sm text-gray-500">
                    <div className="flex items-center space-x-1 mb-1">
                      <FileText className="w-3 h-3" />
                      <span>Sources:</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 break-words">
                      {message.sources.map((source, index) => (
                        <li key={index}>{source}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                <div className="text-xs text-gray-500 mt-1 break-words">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
          
          {loading && (
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center">
                <Bot className="w-3 h-3 sm:w-4 sm:h-4" />
              </div>
              <div className="flex-1">
                <div className="inline-block p-2 sm:p-3 rounded-lg bg-gray-100">
                  <div className="flex items-center space-x-2">
                    <Loader className="w-4 h-4 animate-spin" />
                    <span className="text-gray-600 text-sm sm:text-base">Thinking...</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <div className="border-t border-gray-200 p-2 sm:p-4">
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about Formula Student..."
              className="flex-1 input-field text-sm sm:text-base"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="btn-primary px-4 sm:px-6 w-full sm:w-auto"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}