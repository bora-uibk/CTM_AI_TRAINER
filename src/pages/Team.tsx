import React, { useState, useEffect } from 'react'
import { supabase, TeamRoom, RoomParticipant, QuizQuestion } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { 
  Users, 
  Plus, 
  LogIn, 
  Crown, 
  UserCheck,
  Send,
  RotateCcw,
  Trophy,
  Loader
} from 'lucide-react'

export default function Team() {
  const { user } = useAuth()
  const [rooms, setRooms] = useState<TeamRoom[]>([])
  const [currentRoom, setCurrentRoom] = useState<TeamRoom | null>(null)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showJoinRoom, setShowJoinRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState<string | number | null>(null)

  useEffect(() => {
    fetchRooms()
  }, [])

  useEffect(() => {
    if (currentRoom) {
      fetchParticipants()
      subscribeToRoomUpdates()
    }
  }, [currentRoom])

  const fetchRooms = async () => {
    try {
      const { data, error } = await supabase
        .from('team_rooms')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      if (error) throw error
      setRooms(data || [])
    } catch (error) {
      console.error('Error fetching rooms:', error)
    }
  }

  const fetchParticipants = async () => {
    if (!currentRoom) return

    try {
      const { data, error } = await supabase
        .from('room_participants')
        .select('*')
        .eq('room_id', currentRoom.id)

      if (error) throw error
      setParticipants(data || [])
    } catch (error) {
      console.error('Error fetching participants:', error)
    }
  }

  const subscribeToRoomUpdates = () => {
    if (!currentRoom) return

    const subscription = supabase
      .channel(`room-${currentRoom.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_rooms',
        filter: `id=eq.${currentRoom.id}`
      }, (payload) => {
        if (payload.new) {
          setCurrentRoom(payload.new as TeamRoom)
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_participants',
        filter: `room_id=eq.${currentRoom.id}`
      }, () => {
        fetchParticipants()
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }

  const createRoom = async () => {
    if (!roomName.trim() || !user) return

    setLoading(true)
    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase()
      
      const { data, error } = await supabase
        .from('team_rooms')
        .insert({
          name: roomName.trim(),
          code,
          created_by: user.id,
          is_active: true,
          current_question: null,
          current_answers: {}
        })
        .select()
        .single()

      if (error) throw error

      // Join the room as creator
      await supabase
        .from('room_participants')
        .insert({
          room_id: data.id,
          user_id: user.id,
          user_email: user.email || ''
        })

      setCurrentRoom(data)
      setShowCreateRoom(false)
      setRoomName('')
      fetchRooms()
    } catch (error) {
      console.error('Error creating room:', error)
    } finally {
      setLoading(false)
    }
  }

  const joinRoom = async () => {
    if (!roomCode.trim() || !user) return

    setLoading(true)
    try {
      const { data: room, error: roomError } = await supabase
        .from('team_rooms')
        .select('*')
        .eq('code', roomCode.trim().toUpperCase())
        .eq('is_active', true)
        .single()

      if (roomError) throw new Error('Room not found')

      // Check if already joined
      const { data: existing } = await supabase
        .from('room_participants')
        .select('*')
        .eq('room_id', room.id)
        .eq('user_id', user.id)
        .single()

      if (!existing) {
        await supabase
          .from('room_participants')
          .insert({
            room_id: room.id,
            user_id: user.id,
            user_email: user.email || ''
          })
      }

      setCurrentRoom(room)
      setShowJoinRoom(false)
      setRoomCode('')
    } catch (error) {
      console.error('Error joining room:', error)
      alert('Failed to join room. Please check the room code.')
    } finally {
      setLoading(false)
    }
  }

  const leaveRoom = async () => {
    if (!currentRoom || !user) return

    try {
      await supabase
        .from('room_participants')
        .delete()
        .eq('room_id', currentRoom.id)
        .eq('user_id', user.id)

      setCurrentRoom(null)
      setParticipants([])
      setSelectedAnswer(null)
    } catch (error) {
      console.error('Error leaving room:', error)
    }
  }

  const startNewQuestion = async () => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return

    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { count: 1 }
      })

      if (error) throw error

      const question = data.questions[0]
      
      await supabase
        .from('team_rooms')
        .update({
          current_question: question,
          current_answers: {}
        })
        .eq('id', currentRoom.id)

      setSelectedAnswer(null)
    } catch (error) {
      console.error('Error starting new question:', error)
    } finally {
      setLoading(false)
    }
  }

  const submitAnswer = async () => {
    if (!currentRoom || !user || selectedAnswer === null) return

    try {
      const currentAnswers = currentRoom.current_answers || {}
      currentAnswers[user.id] = {
        answer: selectedAnswer,
        user_email: user.email
      }

      await supabase
        .from('team_rooms')
        .update({ current_answers: currentAnswers })
        .eq('id', currentRoom.id)
    } catch (error) {
      console.error('Error submitting answer:', error)
    }
  }

  const isRoomCreator = currentRoom?.created_by === user?.id
  const currentQuestion = currentRoom?.current_question as QuizQuestion | null
  const currentAnswers = currentRoom?.current_answers || {}
  const hasAnswered = user?.id && currentAnswers[user.id]

  if (currentRoom) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{currentRoom.name}</h1>
            <p className="text-gray-600">Room Code: <span className="font-mono font-bold">{currentRoom.code}</span></p>
          </div>
          <button onClick={leaveRoom} className="btn-secondary">
            Leave Room
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          {/* Question Area */}
          <div className="lg:col-span-2">
            <div className="card">
              {currentQuestion ? (
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 space-y-2 sm:space-y-0">
                    <h2 className="text-lg font-semibold text-gray-900">Current Question</h2>
                    {isRoomCreator && (
                      <button
                        onClick={startNewQuestion}
                        disabled={loading}
                        className="btn-secondary text-sm"
                      >
                        <RotateCcw className="w-4 h-4 mr-1" />
                        New Question
                      </button>
                    )}
                  </div>

                  <div className="mb-6">
                    <p className="text-base sm:text-lg text-gray-900 mb-4">{currentQuestion.question}</p>
                    
                    {currentQuestion.type === 'multiple_choice' && currentQuestion.options && (
                      <div className="space-y-3">
                        {currentQuestion.options.map((option, index) => (
                          <button
                            key={index}
                            onClick={() => setSelectedAnswer(index)}
                            disabled={hasAnswered}
                            className={`w-full text-left p-3 border-2 rounded-lg transition-all duration-200 ${
                              selectedAnswer === index
                                ? 'border-primary-500 bg-primary-50'
                                : hasAnswered
                                ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0">
                              <span className="text-sm sm:text-base">{String.fromCharCode(65 + index)}. {option}</span>
                              <div className="flex items-center space-x-1">
                                {Object.values(currentAnswers).filter(a => a.answer === index).map((answer, i) => (
                                  <div key={i} className="w-2 h-2 bg-primary-500 rounded-full" />
                                ))}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {currentQuestion.type === 'true_false' && (
                      <div className="space-y-3">
                        {[true, false].map((value) => (
                          <button
                            key={value.toString()}
                            onClick={() => setSelectedAnswer(value)}
                            disabled={hasAnswered}
                            className={`w-full text-left p-3 border-2 rounded-lg transition-all duration-200 ${
                              selectedAnswer === value
                                ? 'border-primary-500 bg-primary-50'
                                : hasAnswered
                                ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0">
                              <span className="text-sm sm:text-base">{value ? 'True' : 'False'}</span>
                              <div className="flex items-center space-x-1">
                                {Object.values(currentAnswers).filter(a => a.answer === value).map((answer, i) => (
                                  <div key={i} className="w-2 h-2 bg-primary-500 rounded-full" />
                                ))}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {!hasAnswered && selectedAnswer !== null && (
                    <button
                      onClick={submitAnswer}
                      className="btn-primary"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Submit Answer
                    </button>
                  )}

                  {hasAnswered && (
                    <div className="p-3 bg-success-50 border border-success-200 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <UserCheck className="w-5 h-5 text-success-600" />
                        <span className="text-success-700">Answer submitted! Waiting for other team members...</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Trophy className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Question</h3>
                  <p className="text-gray-600 mb-4">
                    {isRoomCreator 
                      ? 'Start a new question to begin the team challenge!'
                      : 'Waiting for the room creator to start a question...'
                    }
                  </p>
                  {isRoomCreator && (
                    <button
                      onClick={startNewQuestion}
                      disabled={loading}
                      className="btn-primary"
                    >
                      {loading ? (
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      Start Question
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Participants Panel */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Participants ({participants.length})
            </h3>
            
            <div className="space-y-3">
              {participants.map((participant) => {
                const hasAnswered = currentAnswers[participant.user_id]
                const isCreator = participant.user_id === currentRoom.created_by
                
                return (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center space-x-2">
                      {isCreator && <Crown className="w-4 h-4 text-yellow-500" />}
                      <span className="text-sm font-medium text-gray-900">
                        {participant.user_email}
                      </span>
                    </div>
                    
                    {currentQuestion && (
                      <div className="flex items-center space-x-2">
                        {hasAnswered ? (
                          <UserCheck className="w-4 h-4 text-success-600" />
                        ) : (
                          <div className="w-2 h-2 bg-gray-400 rounded-full" />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-4 sm:space-y-0">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Team Challenge</h1>
        <p className="text-gray-600">
          Collaborate with your team to answer Formula Student questions
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Create Room */}
        <div className="card">
          <div className="text-center">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Plus className="w-6 h-6 text-primary-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Create Room</h2>
            <p className="text-gray-600 mb-4">
              Start a new team challenge session
            </p>
            
            {showCreateRoom ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Enter room name"
                  className="input-field"
                />
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                  <button
                    onClick={createRoom}
                    disabled={loading || !roomName.trim()}
                    className="btn-primary w-full sm:flex-1"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Create'}
                  </button>
                  <button
                    onClick={() => setShowCreateRoom(false)}
                    className="btn-secondary w-full sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCreateRoom(true)}
                className="btn-primary"
              >
                Create Room
              </button>
            )}
          </div>
        </div>

        {/* Join Room */}
        <div className="card">
          <div className="text-center">
            <div className="w-12 h-12 bg-success-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <LogIn className="w-6 h-6 text-success-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Join Room</h2>
            <p className="text-gray-600 mb-4">
              Enter a room code to join an existing session
            </p>
            
            {showJoinRoom ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Enter room code"
                  className="input-field font-mono text-center"
                  maxLength={6}
                />
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                  <button
                    onClick={joinRoom}
                    disabled={loading || !roomCode.trim()}
                    className="btn-primary w-full sm:flex-1"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Join'}
                  </button>
                  <button
                    onClick={() => setShowJoinRoom(false)}
                    className="btn-secondary w-full sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowJoinRoom(true)}
                className="btn-primary"
              >
                Join Room
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active Rooms */}
      {rooms.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Rooms</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <div key={room.id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-900">{room.name}</h3>
                  <Users className="w-4 h-4 text-gray-400" />
                </div>
                <p className="text-xs sm:text-sm text-gray-600 mb-3">
                  Code: <span className="font-mono font-bold">{room.code}</span>
                </p>
                <button
                  onClick={() => {
                    setRoomCode(room.code)
                    joinRoom()
                  }}
                  className="btn-secondary w-full text-sm"
                >
                  Join Room
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}